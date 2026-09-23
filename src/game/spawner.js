/**
 * Procedural level generation.
 *
 * Design rules (all enforced, not just hoped for):
 *   1. Every hazard group requires exactly one reflex: jump, slide, or clearing
 *      a gap.
 *   2. The span of any single group must fit inside ~66% of a full jump arc at
 *      the *current* speed, so one jump always clears it.
 *   3. Between two groups there is always `reactionFor(difficulty) * speed` of
 *      travel. When the upcoming group needs the player grounded (slide / pit)
 *      the gap widens to at least one full jump arc, so a jump started over the
 *      previous hazard has always landed in time.
 *   4. Coins telegraph the correct action (arcs over jumps, low lines through
 *      slides), which doubles as a readable tutorial.
 *   5. Charge pads (the chain sink) only ever land on runways in front of a
 *      *jump* pattern, far enough after the previous group that no slide is
 *      still being held. Spending chain is therefore always voluntary.
 */
import {
  GROUND_Y,
  PAD,
  PLAYER,
  PLAYER_ANCHOR_X,
  PICKUP_KIND,
  POWERUP_SPAWN,
  SPAWN,
  VIEW_W,
} from '../config.js';
import { clamp } from '../core/math.js';

/* ------------------------------------------------------------- geometry */

export const GEOM = {
  spikeW: 34,
  spikeH: 30,
  crate: 50,
  /** Bottom edge of anything the player must slide under. */
  duckBottom: GROUND_Y - 46,
  ceilTop: GROUND_Y - 320,
  droneTop: GROUND_Y - 108,
  droneH: 54,
  sawR: 30,
  pitDepth: 420,
};

const arcAirtime = (2 * PLAYER.jumpVelocity) / PLAYER.gravity; // ≈ 0.72 s

/** How far the player travels during one full-speed jump. */
export const jumpDistanceFor = (speed) => speed * arcAirtime;

/** Largest hazard span a single jump clears with margin. */
export const maxSpanFor = (speed) => jumpDistanceFor(speed) * SPAWN.jumpFit;

/** Largest pit width we are willing to generate (leaves landing room). */
export const pitMaxFor = (speed) => maxSpanFor(speed) * 0.88;

/** 0 at the start of a run, 1 once the run is fully ramped up. */
export const difficultyAt = (metres) => clamp(metres / SPAWN.rampMetres, 0, 1);

/** Seconds of travel guaranteed between two hazard groups. */
export const reactionFor = (difficulty) => 0.92 - 0.14 * clamp(difficulty, 0, 1);

/* -------------------------------------------------------------- helpers */

let hazardId = 0;
let padId = 0;

/** Width of a ground saw's hitbox (also used for pattern spans). */
const SAW_W = 44;

const spike = (x) => ({
  kind: 'spike',
  x,
  y: GROUND_Y - GEOM.spikeH,
  w: GEOM.spikeW,
  h: GEOM.spikeH,
  avoid: 'jump',
});

const crate = (x, height = GEOM.crate) => ({
  kind: 'crate',
  x,
  y: GROUND_Y - height,
  w: GEOM.crate,
  h: height,
  avoid: 'jump',
});

const saw = (cx) => ({
  kind: 'saw',
  x: cx - SAW_W / 2,
  y: GROUND_Y - 40,
  w: SAW_W,
  h: 40,
  cx,
  avoid: 'jump',
});

const overhang = (x, width) => ({
  kind: 'overhang',
  x,
  y: GEOM.ceilTop,
  w: width,
  h: GEOM.duckBottom - GEOM.ceilTop,
  avoid: 'slide',
});

const drone = (x, width = 92) => ({
  kind: 'drone',
  x,
  y: GEOM.droneTop,
  w: width,
  h: GEOM.droneH,
  avoid: 'slide',
  bobPhase: 0,
});

const pit = (x, width) => ({
  kind: 'pit',
  x,
  x2: x + width,
  w: width,
  y: GROUND_Y,
  h: GEOM.pitDepth,
  avoid: 'gap',
  requiresGround: true,
});

const coin = (x, y, phase = 0) => ({
  kind: PICKUP_KIND.COIN,
  x,
  y,
  r: 13,
  taken: false,
  pulled: false,
  vx: 0,
  vy: 0,
  phase,
});

/**
 * A charge pad: a strip on the runway that sells one power-up for chain.
 * The price is fixed per tier so a player can learn (and plan around) it.
 */
const createPad = (kind, x, width, group, cost) => ({
  id: padId++,
  kind,
  cost,
  x,
  x2: x + width,
  w: width,
  y: GROUND_Y,
  used: false,
  charge: 0,
  grace: 0,
  flash: 0,
  denied: 0,
  group,
  phase: x * 0.013,
});

/** A parabola of coins that mirrors a real jump arc. */
function coinArc(pickups, startX, count, spanX, height) {
  const step = spanX / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    pickups.push(coin(startX + i * step, GROUND_Y - height * Math.sin(Math.PI * t) - 30, startX * 0.01 + i));
  }
}

/** Flat row of coins; optionally caps the run with a gem. */
function coinLine(pickups, startX, count, height = 60, spacing = 48, withGem = false) {
  for (let i = 0; i < count; i++) {
    pickups.push(coin(startX + i * spacing, GROUND_Y - height, startX * 0.01 + i));
  }
  if (withGem) {
    pickups.push({
      kind: PICKUP_KIND.GEM,
      x: startX + count * spacing,
      y: GROUND_Y - height - 12,
      r: 17,
      taken: false,
      pulled: false,
      vx: 0,
      vy: 0,
      phase: startX * 0.013,
    });
  }
}

export const powerupPickup = (kind, x, y = GROUND_Y - 150) => ({
  kind,
  x,
  y,
  r: 26,
  taken: false,
  pulled: false,
  vx: 0,
  vy: 0,
  phase: x * 0.01,
});

/* ------------------------------------------------------------- patterns */

/**
 * A pattern is `{ id, minDiff, kind, weight(d), build(x, ctx) }`.
 * `build` returns `{ hazards, pickups, span }` where `span` is the total width
 * covered by hazards. `kind` is the reflex the group demands overall.
 */
export const PATTERNS = [
  {
    id: 'spike1',
    minDiff: 0,
    kind: 'jump',
    weight: () => 2.4,
    build(x) {
      const pickups = [];
      coinArc(pickups, x - 40, 3, 200, 96);
      return { hazards: [spike(x)], pickups, span: GEOM.spikeW };
    },
  },
  {
    id: 'spike2',
    minDiff: 0.1,
    kind: 'jump',
    weight: () => 2.2,
    build(x, c) {
      // Span must cover the *far edge* of the last spike, otherwise the spacing
      // reserved for the next pattern would be eaten into.
      const span = GEOM.spikeW * 2 + 42;
      const pickups = [];
      coinArc(pickups, x - 30, 4, span + 90, 104 + c.rng.range(0, 24));
      return {
        hazards: [spike(x), spike(x + GEOM.spikeW + 42)],
        pickups,
        span,
      };
    },
  },
  {
    id: 'spikeRow',
    minDiff: 0.3,
    kind: 'jump',
    weight: (d) => 1.3 + d,
    build(x, c) {
      const n = c.diff > 0.75 ? 4 : 3;
      const step = GEOM.spikeW + 34;
      const span = (n - 1) * step + GEOM.spikeW;
      const hazards = [];
      for (let i = 0; i < n; i++) hazards.push(spike(x + i * step));
      const pickups = [];
      coinArc(pickups, x - 30, 5, span + 110, 116);
      return { hazards, pickups, span };
    },
  },
  {
    id: 'crate1',
    minDiff: 0,
    kind: 'jump',
    weight: () => 2.2,
    build(x) {
      const pickups = [];
      coinArc(pickups, x - 40, 3, 210, 104);
      return { hazards: [crate(x)], pickups, span: GEOM.crate };
    },
  },
  {
    id: 'crateTall',
    minDiff: 0.22,
    kind: 'jump',
    weight: (d) => 1.1 + d * 0.8,
    build(x) {
      const pickups = [];
      coinArc(pickups, x - 46, 3, 230, 152);
      return { hazards: [crate(x, GEOM.crate * 2)], pickups, span: GEOM.crate };
    },
  },
  {
    id: 'cratePair',
    minDiff: 0.5,
    kind: 'jump',
    weight: (d) => 0.6 + d,
    build(x) {
      const gap = 54;
      const span = GEOM.crate * 2 + gap;
      const pickups = [];
      coinArc(pickups, x - 40, 4, span + 110, 134);
      return {
        hazards: [crate(x), crate(x + GEOM.crate + gap)],
        pickups,
        span,
      };
    },
  },
  {
    id: 'overhang',
    minDiff: 0.06,
    kind: 'slide',
    weight: () => 2.3,
    build(x, c) {
      const width = clamp(c.speed * c.rng.range(0.2, 0.32), 130, 250);
      const pickups = [];
      coinLine(pickups, x + 12, Math.max(2, Math.floor(width / 62)), 44, 54);
      return { hazards: [overhang(x, width)], pickups, span: width };
    },
  },
  {
    id: 'overhangLong',
    minDiff: 0.42,
    kind: 'slide',
    weight: (d) => 0.7 + d,
    build(x, c) {
      const width = clamp(c.speed * c.rng.range(0.3, 0.42), 180, 340);
      const pickups = [];
      coinLine(pickups, x + 12, Math.max(3, Math.floor(width / 58)), 44, 54);
      return { hazards: [overhang(x, width)], pickups, span: width };
    },
  },
  {
    id: 'drone',
    minDiff: 0.18,
    kind: 'slide',
    weight: () => 2.0,
    build(x) {
      const pickups = [];
      coinLine(pickups, x + 6, 3, 46, 46);
      return { hazards: [drone(x, 92)], pickups, span: 92 };
    },
  },
  {
    id: 'droneDuo',
    minDiff: 0.6,
    kind: 'slide',
    weight: (d) => 0.5 + d,
    build(x, c) {
      const gap = 60;
      const hazards = [drone(x, 92), drone(x + 92 + gap, 92)];
      for (const h of hazards) h.bobPhase = c.rng.range(0, Math.PI * 2);
      const pickups = [];
      coinLine(pickups, x + 12, 5, 46, 54);
      return { hazards, pickups, span: 92 * 2 + gap };
    },
  },
  {
    id: 'saw',
    minDiff: 0.28,
    kind: 'jump',
    weight: (d) => 1.3 + d * 0.6,
    build(x) {
      const pickups = [];
      coinArc(pickups, x - 40, 3, 200, 106);
      return { hazards: [saw(x + 22)], pickups, span: 44 };
    },
  },
  {
    id: 'sawPair',
    minDiff: 0.62,
    kind: 'jump',
    weight: (d) => 0.4 + d * 1.2,
    build(x, c) {
      const gap = clamp(c.speed * 0.3, 130, 250);
      const span = SAW_W * 2 + gap;
      const pickups = [];
      coinArc(pickups, x - 40, 4, span + 100, 130);
      return { hazards: [saw(x + 22), saw(x + SAW_W + gap + 22)], pickups, span };
    },
  },
  {
    id: 'pit',
    minDiff: 0.12,
    kind: 'pit',
    weight: () => 2.0,
    build(x, c) {
      const width = clamp(c.speed * c.rng.range(0.26, 0.4), 110, c.pitMax);
      const pickups = [];
      coinArc(pickups, x - 10, 4, width + 60, 98);
      return { hazards: [pit(x, width)], pickups, span: width };
    },
  },
  {
    id: 'pitWide',
    minDiff: 0.4,
    kind: 'pit',
    weight: (d) => 0.8 + d,
    build(x, c) {
      const width = clamp(c.speed * c.rng.range(0.42, 0.55), 190, c.pitMax);
      const pickups = [];
      coinArc(pickups, x + 10, 5, width, 124);
      return { hazards: [pit(x, width)], pickups, span: width };
    },
  },
  {
    id: 'pitDouble',
    minDiff: 0.72,
    kind: 'pit',
    weight: (d) => 0.3 + d * 1.4,
    build(x, c) {
      const w1 = clamp(c.speed * 0.3, 120, c.pitMax * 0.72);
      const pad = clamp(c.speed * 0.74, 250, 560);
      const w2 = clamp(c.speed * 0.3, 120, c.pitMax * 0.72);
      const pickups = [];
      coinArc(pickups, x - 10, 4, w1 + 50, 98);
      coinLine(pickups, x + w1 + 26, Math.max(2, Math.round(pad / 130)), 120, 72);
      coinArc(pickups, x + w1 + pad - 10, 4, w2 + 50, 98);
      return {
        hazards: [pit(x, w1), pit(x + w1 + pad, w2)],
        pickups,
        span: w1 + pad + w2,
      };
    },
  },
];

/* -------------------------------------------------------------- spawner */

/**
 * `gapBefore` guard: a group that needs the player grounded is never closer
 * than one second of travel. That leaves room for the worst-case jump arc
 * (0.72 s) plus the reaction window a slide or a pit take-off needs.
 */
const GROUND_GUARD = 1.0;

export function createSpawner(playerX) {
  return {
    cursor: playerX + VIEW_W * 0.9 + 280,
    group: 0,
    lastPattern: null,
    nextPowerupAt: POWERUP_SPAWN.firstAt,
    pendingPowerup: null,
    placed: 0,
    firstSpeed: 0,
    /** Charge pads: the first one is guaranteed, so the mechanic is taught. */
    padReadyAt: PAD.firstAt,
    padsPlaced: 0,
    lastPadX: -Infinity,
  };
}

const powerupPool = (diff) => [
  { kind: PICKUP_KIND.SHIELD, weight: 1.15 },
  { kind: PICKUP_KIND.MAGNET, weight: 1.1 },
  { kind: PICKUP_KIND.MULTIPLIER, weight: 0.85 + diff * 0.5 },
  { kind: PICKUP_KIND.OVERDRIVE, weight: 0.45 + diff * 0.8 },
];

/** Tiers unlocked at this difficulty; the cheap pad is the common one. */
const padPool = (diff) =>
  Object.keys(PAD.prices)
    .filter((kind) => PAD.minDiff[kind] <= diff)
    .map((kind) => ({ kind, weight: PAD.weights[kind] }));

/**
 * Decide whether this runway gets a charge pad, and where.
 *
 * A pad is only offered on a runway leading into a *jump* pattern, and the
 * runway is then widened by exactly the space the pad needs (`room`), so these
 * rules hold by construction rather than by luck:
 *   - the pad starts `leadIn` seconds after the previous group, so a slide held
 *     for the last overhang has long ended: cashing in is always deliberate,
 *   - it ends `leadOut` seconds before the next group, keeping the read clean,
 *   - pads are spaced apart, so cashing in stays an event and not a habit.
 *
 * @returns `null` or a plan `{ kind, width, x, room, cost }`.
 */
function planPad(state, rng, pattern, speed, diff, gapStart, baseRunway) {
  const spawner = state.spawner;
  if (pattern.kind !== 'jump') return null;
  if (state.time < spawner.padReadyAt) return null;

  const width = clamp(speed * PAD.window, PAD.widthMin, PAD.widthMax);
  const room = width + speed * (PAD.leadIn + PAD.leadOut + PAD.slack);
  if (gapStart - spawner.lastPadX < speed * PAD.spacing) return null;

  const first = spawner.padsPlaced === 0;
  if (!first && !rng.chance(PAD.chance)) return null;

  const kind = rng.weighted(padPool(diff), (o) => o.weight).kind;
  const x = gapStart + baseRunway + speed * PAD.leadIn + rng.range(0, speed * PAD.slack);
  return { kind, width, x, room, cost: PAD.prices[kind] };
}

/** Commit a planned pad now that the runway's group id exists. */
function pushPad(state, plan, group) {
  const spawner = state.spawner;
  state.pads.push(createPad(plan.kind, plan.x, plan.width, group, plan.cost));
  spawner.lastPadX = plan.x;
  spawner.padsPlaced += 1;
  spawner.padReadyAt = state.time;
}

/** Shift a pattern that was measured at x = 0 into its final world position. */
function placeAt(built, dx) {
  for (const h of built.hazards) {
    h.x += dx;
    if (h.x2 !== undefined) h.x2 += dx;
    if (h.cx !== undefined) h.cx += dx;
  }
  for (const p of built.pickups) p.x += dx;
  return built;
}

/**
 * Pick and build the next pattern. Patterns are measured at the origin first so
 * an over-wide pattern can be rejected before it consumes the level's RNG.
 */
function buildNextPattern(diff, speed, rng, lastPattern) {
  const maxSpan = maxSpanFor(speed);
  const pool = PATTERNS.filter((p) => p.minDiff <= diff);
  const ctx = { rng, speed, diff, pitMax: pitMaxFor(speed) };
  let fallback = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = rng.weighted(pool, (p) =>
      p.weight(diff) * (p.id === lastPattern ? 0.12 : 1),
    );
    const built = candidate.build(0, ctx);
    if (built.span <= maxSpan) return { pattern: candidate, built };
    if (!fallback) fallback = { pattern: candidate, built };
  }
  return fallback ?? { pattern: PATTERNS[0], built: PATTERNS[0].build(0, ctx) };
}

/** Required clear runway before a pattern, in world px. */
function gapBefore(pattern, speed, diff) {
  const reaction = reactionFor(diff);
  const base = Math.max(SPAWN.minGap, speed * reaction);
  const needsGround = pattern.kind === 'slide' || pattern.kind === 'pit';
  return needsGround ? Math.max(base, speed * GROUND_GUARD) : base;
}

/** Grow the world until generation is far enough ahead of the camera. */
export function refillWorld(state) {
  const spawner = state.spawner;
  const rng = state.rng;
  const camX = state.player.x - VIEW_W * PLAYER_ANCHOR_X;
  const frontier = camX + VIEW_W + SPAWN.lookAhead;

  const speed = Math.max(state.speed, state.baseSpeed);
  const diff = state.difficulty;

  let guard = 0;
  while (spawner.cursor < frontier && guard++ < 40) {
    const { pattern, built } = buildNextPattern(diff, speed, rng, spawner.lastPattern);
    const baseRunway = gapBefore(pattern, speed, diff);
    const gapStart = spawner.cursor;
    // A pad reserves its own room, so the runway grows instead of the pad
    // having to fit into whatever space happened to be left.
    const pad = planPad(state, rng, pattern, speed, diff, gapStart, baseRunway);
    spawner.cursor += baseRunway + (pad ? pad.room : 0);
    placeAt(built, spawner.cursor);

    const group = spawner.group++;

    // --- runway coins: the empty stretch invites the player to gather ------
    const runwayFrom = gapStart + 90;
    const runwayTo = spawner.cursor - 150;
    const runwayRoom = runwayTo - runwayFrom;
    if (runwayRoom > 90) {
      const count = clamp(Math.round(runwayRoom / 150), 1, 4);
      const lead = state.pickups.length;
      coinLine(
        state.pickups,
        runwayFrom,
        count,
        60 + rng.range(-8, 10),
        58,
        rng.chance(0.16),
      );
      for (let i = lead; i < state.pickups.length; i++) state.pickups[i].group = group;
    }

    // --- charge pad: the chain sink, offered on this runway ---------------
    if (pad) pushPad(state, pad, group);

    for (const h of built.hazards) {
      state.hazards.push({
        id: hazardId++,
        passed: false,
        dead: false,
        minDist: Infinity,
        group,
        speed,
        diff,
        ...h,
        x2: h.x2 ?? h.x + h.w,
      });
      if (h.kind === 'pit') state.gaps.push({ x: h.x, x2: h.x2, group });
    }
    for (const p of built.pickups) {
      p.group = group;
      state.pickups.push(p);
    }

    spawner.cursor = spawner.cursor + built.span;
    spawner.lastPattern = pattern.id;
    spawner.placed++;

    // --- power-up: dropped into the gap that follows this pattern ----------
    if (spawner.pendingPowerup || state.time >= spawner.nextPowerupAt) {
      const kind =
        spawner.pendingPowerup ?? rng.weighted(powerupPool(diff), (o) => o.weight).kind;
      const room = clamp(speed * 0.95, 340, 640);
      const px = spawner.cursor + room * 0.55;
      state.pickups.push(powerupPickup(kind, px));
      const lead = state.pickups.length;
      coinLine(state.pickups, px - 156, 3, 152, 54);
      for (let i = lead; i < state.pickups.length; i++) state.pickups[i].group = group;
      spawner.cursor = Math.max(spawner.cursor, px + room * 0.5);
      spawner.pendingPowerup = null;
      spawner.nextPowerupAt = state.time + rng.range(POWERUP_SPAWN.min, POWERUP_SPAWN.max);
    }
  }
  return state;
}

/** Friendly opening straight: coins, no hazards. */
export function seedOpening(state) {
  coinLine(state.pickups, state.player.x + 430, 6, 72, 54);
  return state;
}
