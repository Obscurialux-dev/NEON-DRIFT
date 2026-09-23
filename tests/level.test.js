import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, PAD, PLAYER, SPAWN } from '../src/config.js';
import { difficultyAt, maxSpanFor, pitMaxFor, reactionFor } from '../src/game/spawner.js';
import { createGameState, drainEvents, stepGame } from '../src/game/state.js';
import { autopilotInput, createAutopilot } from '../src/game/autopilot.js';
import { FOOT_HALF } from '../src/game/collision.js';
import { recordLevel, singleJumpClears } from './helpers/probe.js';

const DT = CONFIG.fixedStep;

const SLIDE_LEAD = 0.34;

test('generated levels satisfy every spacing rule (several seeds)', () => {
  for (const seed of [4242, 7, 99, 12345, 31337, 815]) {
    const { groups, placed } = recordLevel(seed, 2200);

    assert.ok(groups.length > 25, `seed ${seed}: too few groups (${groups.length})`);
    assert.ok(
      groups.length <= placed,
      `seed ${seed}: captured ${groups.length} groups but only ${placed} patterns were placed`,
    );

    // The run must open with room to breathe.
    assert.ok(
      groups[0].minX > 900,
      `seed ${seed}: first hazard at ${Math.round(groups[0].minX)} is too early`,
    );

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const speed = g.speed;

      if (i > 0) {
        const prev = groups[i - 1];
        const gap = g.minX - prev.maxX2;
        const needsGround = g.avoid.has('slide') || g.avoid.has('gap');
        const base = Math.max(SPAWN.minGap, speed * reactionFor(g.diff));
        const required = needsGround ? Math.max(base, speed) : base;
        assert.ok(
          gap >= required - 1,
          `seed ${seed}: group ${i} (${[...g.kinds].join('+')}) gap ${Math.round(gap)} < ${Math.round(required)} (speed ${Math.round(speed)}, diff ${g.diff.toFixed(2)})`,
        );
      }

      const span = g.maxX2 - g.minX;
      if (g.avoid.has('gap')) {
        for (const pit of g.hazards.filter((h) => h.kind === 'pit')) {
          assert.ok(
            pit.w <= pitMaxFor(speed) + 1,
            `seed ${seed}: pit width ${Math.round(pit.w)} exceeds ${Math.round(pitMaxFor(speed))}`,
          );
          assert.ok(singleJumpClears(pit.w, 0, speed, 30), 'pit must be jumpable');
        }
      } else if (g.avoid.has('jump')) {
        assert.ok(
          span <= maxSpanFor(speed) + 1,
          `seed ${seed}: jump span ${Math.round(span)} > limit ${Math.round(maxSpanFor(speed))}`,
        );
        assert.ok(
          singleJumpClears(span, g.maxTop, speed, 6),
          `seed ${seed}: span ${Math.round(span)} at height ${g.maxTop} needs more than one jump (speed ${Math.round(speed)})`,
        );
      } else {
        assert.ok(
          speed * SLIDE_LEAD < gapAfter(g, groups[i + 1], speed),
          'slide groups need a reaction runway after them',
        );
      }
    }
  }
});

/** Distance from this group's end to the next group's start (or infinity). */
function gapAfter(group, next, speed) {
  return next ? next.minX - group.maxX2 : speed;
}

test('charge pads only appear where cashing in is a free choice', () => {
  for (const seed of [4242, 7, 99, 12345, 31337, 815]) {
    const { groups, pads } = recordLevel(seed, 2200);
    assert.ok(pads.length > 2, `seed ${seed}: expected pads to be generated, got ${pads.length}`);

    const byGroup = new Map(groups.map((g) => [g.group, g]));
    // A slide can be held indefinitely, so a pad must sit far enough past the
    // previous group that no slide could still be running when it arrives.
    const slideClear = (speed) => speed * (PLAYER.slideDuration + PLAYER.slideCooldown);

    for (const pad of pads) {
      const lead = byGroup.get(pad.group);
      assert.ok(lead, `seed ${seed}: pad ${pad.id} has no group ${pad.group}`);
      const speed = lead.speed;

      // Pads only lead into jump patterns: nothing forces the player to hold
      // "down" near them, so buying is always deliberate.
      assert.ok(
        !lead.avoid.has('slide') && !lead.avoid.has('gap'),
        `seed ${seed}: pad ${pad.id} leads into a ${[...lead.avoid].join('+')} group`,
      );

      // Clear of the previous group (slide recovery) ...
      const prev = byGroup.get(pad.group - 1);
      if (prev) {
        const clear = pad.x - prev.maxX2;
        assert.ok(
          clear >= slideClear(speed) - 1,
          `seed ${seed}: pad ${pad.id} starts ${Math.round(clear)}px after the previous group (needs ${Math.round(slideClear(speed))})`,
        );
      }

      // ... and clear of the next one, so the read stays clean.
      const leadClear = lead.minX - pad.x2;
      assert.ok(
        leadClear >= speed * PAD.leadOut - 1,
        `seed ${seed}: pad ${pad.id} ends ${Math.round(leadClear)}px before its group (needs ${Math.round(speed * PAD.leadOut)})`,
      );

      // A pad must fit inside the runway the generator reserved.
      assert.ok(
        pad.w >= PAD.widthMin - 1 && pad.w <= PAD.widthMax + 1,
        `seed ${seed}: pad ${pad.id} width ${Math.round(pad.w)} is outside [${PAD.widthMin}, ${PAD.widthMax}]`,
      );

      // Pads are ground furniture, never an obstacle: no hazard may overlap one.
      for (const h of lead.hazards) {
        assert.ok(
          h.x2 <= pad.x || h.x >= pad.x2,
          `seed ${seed}: pad ${pad.id} overlaps a ${h.kind} hazard`,
        );
      }

      assert.equal(
        pad.cost,
        PAD.prices[pad.kind],
        `seed ${seed}: pad ${pad.id} (${pad.kind}) costs ${pad.cost}`,
      );
    }

    // Pads stay an event, not a habit.
    for (let i = 1; i < pads.length; i++) {
      const gap = pads[i].x - pads[i - 1].x;
      const lead = byGroup.get(pads[i].group);
      assert.ok(
        gap >= lead.speed * PAD.spacing - 1,
        `seed ${seed}: pads ${i - 1}/${i} are only ${Math.round(gap)}px apart`,
      );
    }
  }
});

test('charge pad layout is deterministic per seed', () => {
  const signature = (seed) =>
    recordLevel(seed, 1600).pads.map((p) => `${p.kind}@${Math.round(p.x)}:${p.cost}`);
  const a = signature(2468);
  assert.ok(a.length > 0, 'expected pads in the signature');
  assert.deepEqual(a, signature(2468));
  assert.notDeepEqual(a, signature(13579));
});

test('the autopilot survives several thousand metres on many seeds', () => {
  for (const seed of [4242, 7, 99, 12345, 555, 2024]) {
    const { state } = recordLevel(seed, 3000);
    assert.equal(
      state.dead,
      false,
      `seed ${seed}: autopilot died (${state.deathCause}) at ${Math.round(state.metres)} m`,
    );
  }
});

test('difficulty ramps with distance and drives the spacing rules', () => {
  assert.equal(difficultyAt(0), 0);
  assert.ok(difficultyAt(400) > 0);
  assert.ok(difficultyAt(1200) > difficultyAt(400));
  assert.equal(difficultyAt(10_000), 1);

  assert.ok(reactionFor(0) > reactionFor(1), 'the reaction window tightens with difficulty');
  assert.ok(reactionFor(0) > 0.7 && reactionFor(1) > 0.5);

  const slow = maxSpanFor(400);
  const fast = maxSpanFor(800);
  assert.ok(Math.abs(fast / slow - 2) < 0.001, 'jump reach must scale with speed');
});

test('the generator produces a varied mix of hazards', () => {
  const { groups } = recordLevel(555, 3000);
  const counts = new Map();
  for (const g of groups) {
    for (const kind of g.kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const kind of ['spike', 'crate', 'saw', 'drone', 'overhang', 'pit']) {
    assert.ok((counts.get(kind) ?? 0) > 0, `no ${kind} hazards were generated`);
  }
  for (const [, count] of counts) {
    assert.ok(count / groups.length < 0.75, 'one hazard type dominates the mix');
  }
  assert.ok(groups.some((g) => g.kinds.has('drone') && g.hazards.length > 1), 'no drone pairs');
  assert.ok(groups.some((g) => g.avoid.has('slide')), 'no slide groups');
  assert.ok(groups.some((g) => g.avoid.has('gap')), 'no pits');
});

test('the same seed always generates the same level', () => {
  const signature = (seed) =>
    recordLevel(seed, 1200).groups.map(
      (g) => `${Math.round(g.minX)}:${[...g.kinds].join('+')}:${g.hazards.length}`,
    );
  assert.deepEqual(signature(31415), signature(31415));
  assert.notDeepEqual(signature(31415), signature(27182));
});

/**
 * Play a seed like the autopilot, optionally buying every pad the runner can
 * afford while planted on it (i.e. what a competent player does).
 *
 * Buying is a *slide*: getting it wrong would show up here as deaths, which is
 * exactly the regression this guards against. The greedy bot is deliberately
 * conservative — it only holds "down" while grounded, since a mid-air hold is
 * the pre-existing fast-fall and not part of the pad affordance.
 */
function playWithPurchases(seed, targetMetres, buy) {
  const state = createGameState({ seed });
  const bot = createAutopilot();
  while (!state.dead && state.metres < targetMetres) {
    const input = autopilotInput(bot, state, DT);
    if (buy) {
      const p = state.player;
      for (const pad of state.pads) {
        if (pad.used || state.chain < pad.cost) continue;
        if (p.x + FOOT_HALF < pad.x || p.x - FOOT_HALF > pad.x2) continue;
        if (!p.onGround) continue;
        input.down = true;
        break;
      }
    }
    stepGame(state, DT, input);
    drainEvents(state);
  }
  return state;
}

test('spending chain on pads never kills the runner', () => {
  let bought = 0;
  let cashed = 0;
  for (const seed of [1013 + 7, 2026 + 7, 3039 + 7, 4052 + 7, 5065 + 7, 6078 + 7]) {
    const state = playWithPurchases(seed, 2500, true);
    assert.equal(
      state.dead,
      false,
      `seed ${seed}: buying pads killed the runner (${state.deathCause}) at ${Math.round(state.metres)} m`,
    );
    bought += state.padsBought;
    cashed += state.cashed;
  }
  assert.ok(bought >= 4, `expected the buyer to actually buy pads, bought ${bought}`);
  assert.ok(cashed > 0, 'expected chain to be spent');
});
