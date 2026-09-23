/**
 * The game simulation. 100% DOM-free — this is what the tests and the
 * attract-mode autopilot drive, and the renderer only ever *reads* it.
 *
 * `stepGame(state, dt, input)` is deterministic: same state + dt + input always
 * produces the same result (the only entropy is the seeded level RNG).
 */
import {
  GROUND_Y,
  MAGNET,
  PAD,
  PICKUP_KIND,
  PLAYER,
  PLAYER_ANCHOR_X,
  POWERUPS,
  PX_PER_METRE,
  SCORE,
  SPAWN,
  SPEED,
  VIEW_W,
} from '../config.js';
import { clamp, damp } from '../core/math.js';
import { createRng } from '../core/rng.js';
import { FOOT_HALF, playerRect } from './collision.js';
import { createPlayer, updatePlayer } from './player.js';
import { createSpawner, difficultyAt, refillWorld, seedOpening } from './spawner.js';

const POWERUP_KINDS = Object.keys(POWERUPS);
/** Falling this far below the floor line counts as death. */
const HOLE_DEPTH = 90;
const GROUND_FALL_LIMIT = GROUND_Y + HOLE_DEPTH;

function createPowerups() {
  const out = {};
  for (const kind of POWERUP_KINDS) {
    out[kind] = { active: false, timer: 0, duration: POWERUPS[kind].duration, charges: 0 };
  }
  return out;
}

export function createGameState({ seed = 1337 } = {}) {
  const state = {
    seed: seed >>> 0,
    rng: createRng(seed),
    time: 0,
    running: true,
    dead: false,
    deathTimer: 0,
    deathCause: null,

    baseSpeed: SPEED.start,
    speed: SPEED.start,
    difficulty: 0,

    distance: 0,
    metres: 0,
    score: 0,
    scoreFloat: 0,
    coins: 0,
    gems: 0,
    chain: 0,
    chainTimer: 0,
    bestChain: 0,
    multiplier: 1,
    nearMisses: 0,
    hazardsCleared: 0,
    smashed: 0,
    powerupsUsed: 0,
    padsBought: 0,
    cashed: 0,
    padsRefused: 0,

    player: createPlayer(),
    hazards: [],
    pickups: [],
    gaps: [],
    pads: [],
    powerups: createPowerups(),
    spawner: createSpawner(0),
    events: [],

    /** Presentation-only values, written by the sim so the renderer stays read-only. */
    shake: 0,
    flash: 0,
  };
  resetGame(state, state.seed);
  return state;
}

/** Full reset for a new run. Keeps object identity, which the renderer relies on. */
export function resetGame(state, seed = state.seed) {
  state.seed = seed >>> 0;
  state.rng = createRng(state.seed);
  state.time = 0;
  state.running = true;
  state.dead = false;
  state.deathTimer = 0;
  state.deathCause = null;
  state.baseSpeed = SPEED.start;
  state.speed = SPEED.start;
  state.difficulty = 0;
  state.distance = 0;
  state.metres = 0;
  state.score = 0;
  state.scoreFloat = 0;
  state.coins = 0;
  state.gems = 0;
  state.chain = 0;
  state.chainTimer = 0;
  state.bestChain = 0;
  state.multiplier = 1;
  state.nearMisses = 0;
  state.hazardsCleared = 0;
  state.smashed = 0;
  state.powerupsUsed = 0;
  state.padsBought = 0;
  state.cashed = 0;
  state.padsRefused = 0;
  state.hazards.length = 0;
  state.pickups.length = 0;
  state.gaps.length = 0;
  state.pads.length = 0;
  state.events.length = 0;
  state.shake = 0;
  state.flash = 0;

  for (const kind of POWERUP_KINDS) {
    Object.assign(state.powerups[kind], { active: false, timer: 0, charges: 0 });
  }

  Object.assign(state.player, createPlayer());
  state.spawner = createSpawner(state.player.x);

  refillWorld(state);
  seedOpening(state);
  return state;
}

/* ------------------------------------------------------------- power-ups */

export const powerupActive = (state, kind) => state.powerups[kind].active;

export function powerupFraction(state, kind) {
  const p = state.powerups[kind];
  return p.duration > 0 ? clamp(p.timer / p.duration, 0, 1) : 0;
}

export function activatePowerup(state, kind, { silent = false } = {}) {
  if (!POWERUPS[kind]) return;
  const p = state.powerups[kind];
  p.active = true;
  p.timer = POWERUPS[kind].duration;
  p.duration = POWERUPS[kind].duration;
  if (kind === 'shield') p.charges = 1;
  state.powerupsUsed++;
  // A paid activation plays its own, distinct feedback, so it opts out of the
  // generic "picked up an orb" event.
  if (!silent) state.events.push({ type: 'powerup', kind, x: state.player.x, y: state.player.y });
  state.flash = Math.max(state.flash, 0.3);
}

function updatePowerups(state, dt) {
  for (const kind of POWERUP_KINDS) {
    const p = state.powerups[kind];
    if (!p.active) continue;
    p.timer -= dt;
    if (p.timer <= 0) {
      p.active = false;
      p.timer = 0;
      p.charges = 0;
      state.events.push({ type: 'powerupEnd', kind, x: state.player.x, y: state.player.y });
    }
  }
}

/* -------------------------------------------------------------- helpers */

/** Per-axis gap between two rects (0 on an axis means they overlap on it). */
function rectGaps(a, b) {
  return {
    dx: Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0),
    dy: Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0),
  };
}

function addScore(state, amount) {
  state.scoreFloat += amount * state.multiplier;
}

function killPlayer(state, cause) {
  if (state.dead) return;
  state.dead = true;
  state.deathTimer = 0;
  state.deathCause = cause;
  state.player.alive = false;
  state.player.vy = -520;
  state.player.sliding = false;
  state.shake = Math.max(state.shake, 26);
  state.flash = 1;
  state.events.push({
    type: 'death',
    cause,
    x: state.player.x,
    y: state.player.y - 30,
    speed: state.speed,
  });
}

function collectPickup(state, p) {
  p.taken = true;
  if (p.kind === PICKUP_KIND.COIN) {
    state.coins += 1;
    state.chain += 1;
    state.bestChain = Math.max(state.bestChain, state.chain);
    state.chainTimer = SCORE.chainTimeout;
    addScore(state, SCORE.coin);
    state.events.push({ type: 'coin', x: p.x, y: p.y });
    return;
  }
  if (p.kind === PICKUP_KIND.GEM) {
    state.gems += 1;
    state.chain += 3;
    state.bestChain = Math.max(state.bestChain, state.chain);
    state.chainTimer = SCORE.chainTimeout;
    addScore(state, SCORE.gem);
    state.events.push({ type: 'gem', x: p.x, y: p.y });
    return;
  }
  activatePowerup(state, p.kind);
  state.events.push({ type: 'powerupOrb', kind: p.kind, x: state.player.x, y: state.player.y });
}

/* ------------------------------------------------------------ charge pads */

/**
 * Charge pads are the chain sink. Holding "down" while grounded on a pad buys
 * the power-up that pad advertises; the price is paid in chain, so a purchase
 * can cost multiplier steps. That trade — score rate against safety or tempo —
 * is the whole decision, and the pad (never a menu) is where it is made.
 */
function updatePads(state, dt, input) {
  const player = state.player;
  const holding = !!input.down && !state.dead;
  const grounded = player.onGround;
  const footL = player.x - FOOT_HALF;
  const footR = player.x + FOOT_HALF;
  const camX = player.x - VIEW_W * PLAYER_ANCHOR_X;
  let write = 0;

  for (let i = 0; i < state.pads.length; i++) {
    const pad = state.pads[i];
    if (pad.flash > 0) pad.flash = Math.max(0, pad.flash - dt * 2.2);
    if (pad.denied > 0) pad.denied = Math.max(0, pad.denied - dt);

    if (!pad.used) {
      const onPad = footR >= pad.x && footL <= pad.x2;
      // A hold that began on the pad keeps charging briefly after it ends, so
      // reacting a frame late still counts.
      pad.grace = onPad ? PAD.grace : Math.max(0, pad.grace - dt);

      if (holding && grounded && (onPad || pad.grace > 0)) {
        pad.charge += dt;
        if (pad.charge >= PAD.dwell) usePad(state, pad);
      } else {
        pad.charge = Math.max(0, pad.charge - dt * PAD.decay);
      }
    }

    if (pad.x2 > camX - SPAWN.cullBehind) state.pads[write++] = pad;
  }
  state.pads.length = write;
}

/** Complete a purchase — or refuse it loudly enough to teach the price. */
function usePad(state, pad) {
  pad.charge = 0;

  if (state.chain < pad.cost) {
    if (pad.denied <= 0) {
      pad.denied = 1.4;
      state.padsRefused += 1;
      state.events.push({
        type: 'padDenied',
        need: pad.cost,
        have: state.chain,
        x: pad.x + pad.w * 0.5,
        y: GROUND_Y,
      });
    }
    return;
  }

  state.chain -= pad.cost;
  state.cashed += pad.cost;
  state.padsBought += 1;
  pad.used = true;
  pad.flash = 1;
  activatePowerup(state, pad.kind, { silent: true });
  state.events.push({
    type: 'cashIn',
    kind: pad.kind,
    cost: pad.cost,
    x: pad.x + pad.w * 0.5,
    y: GROUND_Y,
  });
  state.flash = Math.max(state.flash, 0.32);
  state.shake = Math.max(state.shake, 6);
}

/* ---------------------------------------------------------------- update */

/**
 * Advance the simulation by `dt` seconds.
 * `input` = `{ jump: boolean, down: boolean }` — buttons held, not edges.
 */
export function stepGame(state, dt, input) {
  const player = state.player;

  // --- death sequence: the world coasts to a stop, the body tumbles --------
  if (state.dead) {
    state.deathTimer += dt;
    state.speed = damp(state.speed, 0, 5.5, dt);
    player.hitStop = 0;
    player.vy += PLAYER.gravity * 0.55 * dt;
    player.y += player.vy * dt;
    player.x += state.speed * dt;
    player.spin = Math.min(player.spin + dt * 6, 6);
    state.shake = Math.max(0, state.shake - dt * 90);
    state.flash = Math.max(0, state.flash - dt * 3.4);
    state.distance = player.x;
    state.metres = Math.max(0, player.x / PX_PER_METRE);
    return state;
  }

  state.time += dt;

  // --- world speed & difficulty ------------------------------------------
  const rampTime = Math.max(0, state.time - SPEED.rampDelay);
  state.baseSpeed = Math.min(SPEED.max, SPEED.start + SPEED.ramp * rampTime);

  // --- one arc, one speed -------------------------------------------------
  // The player advances at `state.speed`, so a jump's reach is exactly
  // `speed x airtime` — the quantity the generator sizes gaps against. If a
  // slide bonus or an Overdrive were allowed to start or end mid-flight, the
  // reach would change silently and a take-off that looked right would land in
  // a pit. So the speed of an airborne arc is latched at take-off: what you see
  // is what you get. (Overdrive and the slide bonus are the two things that can
  // move the speed by a visible amount; the base ramp only creeps.)
  if (player.onGround) {
    const slideBonus = player.sliding ? 1 + PLAYER.slideSpeedBonus : 1;
    const overBonus = powerupActive(state, 'overdrive') ? 1 + SPEED.overdriveBonus : 1;
    state.speed = state.baseSpeed * slideBonus * overBonus;
    player.arcSpeed = state.speed;
  } else {
    state.speed = player.arcSpeed > 0 ? player.arcSpeed : state.baseSpeed;
  }

  // --- multiplier & chain decay ------------------------------------------
  const chainSteps = Math.min(Math.floor(state.chain / SCORE.chainStep), SCORE.chainMax);
  state.multiplier = (1 + chainSteps) * (powerupActive(state, 'multiplier') ? 2 : 1);

  if (state.chain > 0) {
    state.chainTimer -= dt;
    if (state.chainTimer <= 0) {
      state.chain = Math.max(0, state.chain - 1);
      state.chainTimer = SCORE.chainTimeout * 0.5;
    }
  }

  // --- player ------------------------------------------------------------
  updatePlayer(player, state, dt, input);

  state.distance = player.x;
  state.metres = Math.max(0, player.x / PX_PER_METRE);
  state.difficulty = difficultyAt(state.metres);
  state.scoreFloat += (state.speed * dt) / PX_PER_METRE;

  updatePowerups(state, dt);

  const overOn = powerupActive(state, 'overdrive');
  const pRect = playerRect(player, PLAYER.forgiveness);
  const camX = player.x - VIEW_W * PLAYER_ANCHOR_X;

  // --- hazards: collisions, near-misses, culling -------------------------
  let write = 0;
  for (let i = 0; i < state.hazards.length; i++) {
    const h = state.hazards[i];
    if (h.kind === 'drone') {
      if (h.baseY === undefined) h.baseY = h.y;
      h.bobPhase += dt * 2.1;
      h.y = h.baseY + Math.sin(h.bobPhase) * 8;
    }

    if (h.kind !== 'pit') {
      const gaps = rectGaps(pRect, h);
      if (gaps.dx === 0 && gaps.dy === 0) {
        if (overOn && !h.dead) {
          h.dead = true;
          state.smashed += 1;
          addScore(state, 15);
          state.shake = Math.max(state.shake, 9);
          state.events.push({
            type: 'smash',
            hazard: h.kind,
            x: h.x + h.w * 0.5,
            y: h.y + h.h * 0.5,
          });
        } else if (player.invuln <= 0 && !h.dead) {
          const shield = state.powerups.shield;
          if (shield.active && shield.charges > 0) {
            shield.active = false;
            shield.timer = 0;
            shield.charges = 0;
            player.invuln = PLAYER.invulnAfterShield;
            player.hitStop = PLAYER.hitStop * 0.7;
            h.dead = true;
            state.shake = Math.max(state.shake, 20);
            state.flash = 0.55;
            state.events.push({
              type: 'shieldBreak',
              x: h.x + h.w * 0.5,
              y: h.y + h.h * 0.5,
            });
          } else {
            state.events.push({
              type: 'hazardHit',
              hazard: h.kind,
              x: h.x + h.w * 0.5,
              y: h.y + h.h * 0.5,
            });
            killPlayer(state, h.kind === 'saw' ? 'saw' : 'hit');
          }
        }
      } else if (!h.passed && gaps.dx < 120) {
        h.minDist = Math.min(h.minDist, Math.hypot(gaps.dx, gaps.dy));
      }
    }

    if (!h.passed && h.x2 < player.x - 24) {
      h.passed = true;
      if (h.kind !== 'pit') {
        state.hazardsCleared += 1;
        if (h.minDist <= 26) {
          state.nearMisses += 1;
          addScore(state, SCORE.nearMiss);
          state.events.push({ type: 'nearMiss', x: player.x + 46, y: player.y - 46 });
        }
      }
    }

    if (!h.dead && h.x2 > camX - SPAWN.cullBehind) state.hazards[write++] = h;
  }
  state.hazards.length = write;

  // --- gaps (the renderer draws the floor from these, the sim uses them for support)
  let gWrite = 0;
  for (let i = 0; i < state.gaps.length; i++) {
    const g = state.gaps[i];
    if (g.x2 > camX - SPAWN.cullBehind) state.gaps[gWrite++] = g;
  }
  state.gaps.length = gWrite;

  // --- fell into a pit ----------------------------------------------------
  if (player.y > GROUND_FALL_LIMIT) killPlayer(state, 'fall');

  // --- pickups: magnet pull, collection, culling --------------------------
  const magnetOn = powerupActive(state, 'magnet');
  const pCentre = { x: player.x, y: player.y - player.h * 0.5 };

  write = 0;
  for (let i = 0; i < state.pickups.length; i++) {
    const p = state.pickups[i];
    if (p.taken) continue;

    if (magnetOn && p.kind !== PICKUP_KIND.GEM) {
      const dx = pCentre.x - p.x;
      const dy = pCentre.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < MAGNET.radius && dist > 1) {
        const pull = MAGNET.pull * (1 - (dist / MAGNET.radius) * MAGNET.attractionFalloff) + 280;
        p.pulled = true;
        p.x += (dx / dist) * pull * dt;
        p.y += (dy / dist) * pull * dt;
      }
    }

    const dx = pCentre.x - p.x;
    const dy = pCentre.y - p.y;
    const reach = MAGNET.collectRadius + p.r;
    if (dx * dx + dy * dy <= reach * reach) {
      collectPickup(state, p);
      continue;
    }

    if (!p.taken && p.x > camX - 200 && p.x < player.x + VIEW_W * 2.2) {
      state.pickups[write++] = p;
    }
  }
  state.pickups.length = write;

  // --- charge pads: trade chain for a power-up ----------------------------
  updatePads(state, dt, input);

  // --- presentation decay -------------------------------------------------
  state.shake = Math.max(0, state.shake - dt * 60);
  state.flash = Math.max(0, state.flash - dt * 3.4);

  // --- keep the world populated ------------------------------------------
  refillWorld(state);

  state.score = Math.floor(state.scoreFloat);
  return state;
}

/** Push the world forward without any player interaction (attract mode). */
export function stepIdle(state, dt) {
  return stepGame(state, dt, { jump: false, down: false });
}

/** Drain queued events — the presentation layer calls this once per frame. */
const NO_EVENTS = [];
export function drainEvents(state) {
  if (state.events.length === 0) return NO_EVENTS;
  const list = state.events;
  state.events = [];
  return list;
}
