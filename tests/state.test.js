import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, GROUND_Y, PAD, PLAYER, PX_PER_METRE, SCORE } from '../src/config.js';
import {
  activatePowerup,
  createGameState,
  drainEvents,
  resetGame,
  stepGame,
} from '../src/game/state.js';
import { createAutopilot, autopilotInput } from '../src/game/autopilot.js';

const DT = CONFIG.fixedStep;
const NONE = { jump: false, down: false };

const coinAt = (x, y = GROUND_Y - 40) => ({
  kind: 'coin',
  x,
  y,
  r: 13,
  taken: false,
  pulled: false,
  vx: 0,
  vy: 0,
  phase: 0,
});

const hazardAt = (x, kind = 'spike') => ({
  id: 100000 + Math.round(x) + kind.length,
  kind,
  x,
  x2: x + 44,
  y: GROUND_Y - 30,
  w: 44,
  h: 30,
  avoid: 'jump',
  passed: false,
  dead: false,
  minDist: Infinity,
  group: 9999,
  speed: 400,
  diff: 0,
});

/** A charge pad, positioned relative to the runner. */
const padAt = (state, kind = 'shield', offset = 160, w = 200) => {
  const x = state.player.x + offset;
  const pad = {
    id: 50000 + Math.round(offset) + kind.length,
    kind,
    cost: PAD.prices[kind],
    x,
    x2: x + w,
    w,
    y: GROUND_Y,
    used: false,
    charge: 0,
    grace: 0,
    flash: 0,
    denied: 0,
    group: 9000,
    phase: 0,
  };
  state.pads.push(pad);
  return pad;
};

/** Step the sim for `seconds` with a fixed input, collecting events. */
const runTicks = (state, input, seconds) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepGame(state, DT, input);
    events.push(...drainEvents(state));
  }
  return events;
};

test('a fresh run starts alive, on the floor, with a clear runway', () => {
  const state = createGameState({ seed: 1 });
  assert.equal(state.dead, false);
  assert.equal(state.running, true);
  assert.equal(state.player.y, GROUND_Y);
  assert.equal(state.score, 0);
  assert.ok(state.hazards.length > 0, 'the world should be pre-populated ahead');
  const firstHazard = Math.min(...state.hazards.map((h) => h.x));
  assert.ok(firstHazard > 900, `first hazard too close: ${firstHazard}`);
});

test('distance and score increase every step', () => {
  const state = createGameState({ seed: 2 });
  const before = { score: state.score, metres: state.metres };
  for (let i = 0; i < 240; i++) stepGame(state, DT, NONE);
  assert.ok(state.metres > before.metres);
  assert.ok(state.score > before.score);
  assert.ok(state.score >= Math.floor(state.metres * 0.8));
});

test('collecting a coin scores, counts and extends the chain', () => {
  const state = createGameState({ seed: 3 });
  const startScore = state.scoreFloat;
  state.pickups.length = 0;
  state.pickups.push(coinAt(state.player.x, state.player.y - 30));
  stepGame(state, DT, NONE);
  assert.equal(state.coins, 1);
  assert.equal(state.chain, 1);
  assert.ok(state.scoreFloat >= startScore + SCORE.coin - 2);
  assert.equal(state.pickups.filter((p) => !p.taken).length, 0);
});

test('the chain multiplier grows with coins and caps out', () => {
  const state = createGameState({ seed: 4 });
  state.pickups.length = 0;
  for (let i = 0; i < SCORE.chainStep * (SCORE.chainMax + 2); i++) {
    state.pickups.push(coinAt(state.player.x + 1, state.player.y - 30));
    stepGame(state, DT, NONE);
  }
  assert.ok(state.chain >= SCORE.chainStep * SCORE.chainMax);
  assert.equal(state.multiplier, 1 + SCORE.chainMax);
});

test('the chain decays when no coins are collected', () => {
  const state = createGameState({ seed: 5 });
  state.chain = 10;
  state.chainTimer = SCORE.chainTimeout;
  const before = state.chain;
  const ticks = Math.round((SCORE.chainTimeout * 3) / DT);
  for (let i = 0; i < ticks; i++) {
    state.pickups.length = 0; // no coins for you
    stepGame(state, DT, NONE);
  }
  assert.ok(state.chain < before, `chain should decay (${before} -> ${state.chain})`);
  assert.equal(state.coins, 0);
});

test('an x2 power-up doubles the multiplier', () => {
  const state = createGameState({ seed: 6 });
  assert.equal(state.multiplier, 1);
  activatePowerup(state, 'multiplier');
  stepGame(state, DT, NONE);
  assert.equal(state.powerups.multiplier.active, true);
  assert.equal(state.multiplier, 2);
});

test('power-ups expire after their duration', () => {
  const state = createGameState({ seed: 7 });
  activatePowerup(state, 'magnet');
  const seconds = state.powerups.magnet.duration;
  const ticks = Math.round((seconds + 0.2) / DT);
  for (let i = 0; i < ticks; i++) {
    // Keep the runner alive so the power-up timers keep ticking.
    state.hazards.length = 0;
    state.gaps.length = 0;
    stepGame(state, DT, NONE);
  }
  assert.equal(state.dead, false);
  assert.equal(state.powerups.magnet.active, false);
  assert.equal(state.powerups.magnet.timer, 0);
});

test('a shield absorbs exactly one hit', () => {
  const state = createGameState({ seed: 8 });
  activatePowerup(state, 'shield');
  stepGame(state, DT, NONE);
  state.hazards.length = 0;
  state.hazards.push(hazardAt(state.player.x - 10, 'spike'));
  stepGame(state, DT, NONE);
  assert.equal(state.dead, false, 'the shield must save the run');
  assert.equal(state.powerups.shield.active, false);
  assert.ok(state.player.invuln > 0, 'the player should be briefly invulnerable');
  assert.ok(state.shake > 0);

  // A second hit, after invulnerability lapses, is fatal.
  state.hazards.length = 0;
  for (let i = 0; i < 40; i++) stepGame(state, DT, NONE);
  state.player.invuln = 0;
  state.hazards.push(hazardAt(state.player.x - 10, 'crate'));
  stepGame(state, DT, NONE);
  assert.equal(state.dead, true);
  assert.equal(state.deathCause, 'hit');
});

test('overdrive smashes hazards instead of dying', () => {
  const state = createGameState({ seed: 9 });
  activatePowerup(state, 'overdrive');
  state.hazards.length = 0;
  state.hazards.push(hazardAt(state.player.x - 10, 'crate'));
  stepGame(state, DT, NONE);
  assert.equal(state.dead, false);
  assert.equal(state.smashed, 1);
  assert.equal(state.hazards.length, 0, 'the smashed hazard should be removed');
});

test('touching a hazard without protection ends the run', () => {
  const state = createGameState({ seed: 10 });
  state.hazards.length = 0;
  state.hazards.push(hazardAt(state.player.x - 10, 'spike'));
  stepGame(state, DT, NONE);
  assert.equal(state.dead, true);
  assert.equal(state.deathCause, 'hit');
  const events = drainEvents(state);
  assert.ok(events.some((e) => e.type === 'death'));
});

test('falling into a chasm ends the run', () => {
  const state = createGameState({ seed: 11 });
  state.hazards.length = 0;
  state.gaps.length = 0;
  state.gaps.push({ x: state.player.x - 40, x2: state.player.x + 4000, group: 1 });
  let guard = 0;
  while (!state.dead && guard++ < 2000) stepGame(state, DT, NONE);
  assert.equal(state.dead, true);
  assert.equal(state.deathCause, 'fall');
});

test('after death the world coasts to a stop and stays dead', () => {
  const state = createGameState({ seed: 12 });
  state.hazards.length = 0;
  state.hazards.push(hazardAt(state.player.x - 10, 'spike'));
  stepGame(state, DT, NONE);
  const speedAtDeath = state.speed;
  for (let i = 0; i < 240; i++) stepGame(state, DT, NONE);
  assert.ok(state.speed < speedAtDeath * 0.5, 'the world should slow down');
  assert.equal(state.dead, true);
  assert.ok(state.deathTimer > 1.5);
});

test('magnet pulls coins in from a distance', () => {
  const state = createGameState({ seed: 13 });
  activatePowerup(state, 'magnet');
  state.pickups.length = 0;
  state.pickups.push(coinAt(state.player.x + 240, GROUND_Y - 200));
  let guard = 0;
  while (state.coins === 0 && guard++ < 600) stepGame(state, DT, NONE);
  assert.equal(state.coins, 1, 'the magnet should reel the coin in');
});

test('near misses are detected and rewarded', () => {
  const state = createGameState({ seed: 14 });
  state.hazards.length = 0;
  const hazard = hazardAt(state.player.x + 160, 'spike');
  // Float the spike just above the player's head: a near miss, not a hit.
  hazard.y = GROUND_Y - 30 - PLAYER.standH - 10;
  hazard.h = 30;
  state.hazards.push(hazard);
  let guard = 0;
  while (!hazard.passed && guard++ < 800 && !state.dead) stepGame(state, DT, NONE);
  assert.equal(state.dead, false, 'a near miss must not be fatal');
  assert.equal(state.nearMisses, 1);
  assert.ok(state.score > 0);
});

test('the world stays bounded (culling works)', () => {
  const state = createGameState({ seed: 15 });
  const bot = createAutopilot();
  for (let i = 0; i < 20000; i++) {
    stepGame(state, DT, autopilotInput(bot, state, DT));
    drainEvents(state);
  }
  assert.ok(state.hazards.length < 40, `too many hazards alive: ${state.hazards.length}`);
  assert.ok(state.pickups.length < 140, `too many pickups alive: ${state.pickups.length}`);
  assert.ok(state.gaps.length < 20, `too many gaps alive: ${state.gaps.length}`);
});

test('identical seeds and inputs produce identical runs', () => {
  const run = (seed, metres = 1500) => {
    const state = createGameState({ seed });
    const bot = createAutopilot();
    while (!state.dead && state.metres < metres) {
      stepGame(state, DT, autopilotInput(bot, state, DT));
      drainEvents(state);
    }
    const level = state.hazards
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((h) => `${h.kind}@${Math.round(h.x)}:${Math.round(h.w)}`)
      .join('|');
    return { state, level };
  };

  const a = run(777);
  const b = run(777);
  assert.equal(a.state.dead, false);
  assert.equal(Math.round(a.state.metres), Math.round(b.state.metres));
  assert.equal(a.state.score, b.state.score);
  assert.equal(a.state.coins, b.state.coins);
  assert.equal(a.state.hazardsCleared, b.state.hazardsCleared);
  assert.equal(Math.round(a.state.player.x), Math.round(b.state.player.x));
  assert.equal(a.level, b.level, 'the same seed must generate the same remaining world');

  const c = run(778);
  assert.notEqual(
    `${Math.round(a.state.player.x)}:${a.state.score}:${a.level.length}`,
    `${Math.round(c.state.player.x)}:${c.state.score}:${c.level.length}`,
  );
});

test('resetGame produces a fresh, playable run', () => {
  const state = createGameState({ seed: 16 });
  const bot = createAutopilot();
  for (let i = 0; i < 3600; i++) {
    stepGame(state, DT, autopilotInput(bot, state, DT));
    drainEvents(state);
  }
  assert.ok(state.metres > 100, `precondition: ${state.metres} m`);

  resetGame(state, 17);
  assert.equal(state.dead, false);
  assert.equal(state.score, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.metres, 0);
  assert.equal(state.multiplier, 1);
  assert.equal(state.player.y, GROUND_Y);
  assert.equal(state.hazards.every((h) => h.x > 900), true);
  assert.equal(state.gaps.length, 0);
  assert.equal(state.pickups.length > 0, true, 'the opening coin trail should exist');
});

test('the simulation is comfortably fast enough for 120 Hz', () => {
  const state = createGameState({ seed: 18 });
  const bot = createAutopilot();
  const started = process.hrtime.bigint();
  const steps = 120 * 60; // one simulated minute
  for (let i = 0; i < steps; i++) {
    stepGame(state, DT, autopilotInput(bot, state, DT));
    if (state.dead) resetGame(state, 19);
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const budget = (steps / 120) * 1000;
  assert.ok(ms < budget * 0.35, `sim used ${ms.toFixed(0)}ms of a ${budget.toFixed(0)}ms budget`);
  assert.ok(PX_PER_METRE > 0);
});


/* ------------------------------------------------------------ charge pads */

test('a charge pad trades chain for its power-up', () => {
  const state = createGameState({ seed: 11 });
  state.pickups.length = 0; // no stray coins, so the chain arithmetic is exact
  state.chain = 26;
  state.chainTimer = SCORE.chainTimeout;
  stepGame(state, DT, NONE); // let the sim recompute the multiplier
  state.chainTimer = SCORE.chainTimeout;
  const pad = padAt(state, 'shield', 160);
  const before = { chain: state.chain, multiplier: state.multiplier };
  assert.equal(before.chain, 26);
  assert.equal(before.multiplier, 4, 'chain 26 should be x4 to start with');

  const events = runTicks(state, { jump: false, down: true }, 0.5);

  assert.ok(pad.used, 'holding down on the pad should buy it');
  assert.equal(state.padsBought, 1);
  assert.equal(state.cashed, PAD.prices.shield);
  assert.equal(state.chain, before.chain - PAD.prices.shield, 'the price comes out of the chain');
  assert.ok(state.powerups.shield.active, 'the payload is the power-up the pad sells');
  assert.equal(state.powerups.shield.charges, 1);
  assert.ok(
    state.multiplier < before.multiplier,
    `paying chain must cost multiplier steps (${before.multiplier} -> ${state.multiplier})`,
  );

  const cash = events.find((e) => e.type === 'cashIn');
  assert.ok(cash, 'a cashIn event drives the purchase feedback');
  assert.equal(cash.kind, 'shield');
  assert.equal(cash.cost, PAD.prices.shield);
  assert.equal(
    events.some((e) => e.type === 'powerup'),
    false,
    'a purchase must not also fire the generic pickup event',
  );
});

test('a pad the player cannot afford refuses loudly and takes nothing', () => {
  const state = createGameState({ seed: 12 });
  state.pickups.length = 0;
  state.chain = 5;
  state.chainTimer = SCORE.chainTimeout;
  const pad = padAt(state, 'overdrive', 160);

  const events = runTicks(state, { jump: false, down: true }, 0.5);

  assert.equal(pad.used, false);
  assert.equal(state.padsBought, 0);
  assert.equal(state.cashed, 0);
  assert.equal(state.chain, 5, 'nothing may be taken when the price is too high');
  assert.equal(state.powerups.overdrive.active, false);
  assert.equal(state.padsRefused, 1);

  const denied = events.find((e) => e.type === 'padDenied');
  assert.ok(denied, 'the refusal is what teaches the price');
  assert.equal(denied.need, PAD.prices.overdrive);
  assert.equal(denied.have, 5);
});

test('a pad needs the runner planted: holding down mid-air spends nothing', () => {
  const state = createGameState({ seed: 13 });
  state.chain = 40;
  state.chainTimer = SCORE.chainTimeout;
  const pad = padAt(state, 'magnet', -100, 460);

  runTicks(state, { jump: true, down: true }, 0.18);
  assert.equal(state.player.onGround, false, 'the jump should still be airborne');
  assert.equal(pad.used, false, 'an airborne hold must not spend');
  assert.equal(state.padsBought, 0);

  runTicks(state, { jump: false, down: true }, 0.9);
  assert.ok(pad.used, 'holding through the landing completes the purchase');
});

test('a stray tap never reaches the dwell, and progress decays', () => {
  const state = createGameState({ seed: 14 });
  state.chain = 40;
  state.chainTimer = SCORE.chainTimeout;
  const pad = padAt(state, 'shield', -100, 400);

  runTicks(state, { jump: false, down: true }, DT * 3);
  assert.equal(pad.used, false);
  assert.ok(pad.charge > 0 && pad.charge < PAD.dwell, `charge ${pad.charge} should be partial`);

  const peaked = pad.charge;
  runTicks(state, NONE, 0.3);
  assert.ok(pad.charge < peaked, 'released progress bleeds away instead of banking');
  assert.equal(state.padsBought, 0);
});

test('a pad can only be bought once', () => {
  const state = createGameState({ seed: 15 });
  state.chain = 80;
  state.chainTimer = SCORE.chainTimeout;
  const pad = padAt(state, 'magnet', -100, 600);

  runTicks(state, { jump: false, down: true }, 1.1);
  assert.ok(pad.used);
  const spent = state.cashed;

  runTicks(state, { jump: false, down: true }, 1.1);
  assert.equal(state.padsBought, 1, 'the same pad must not charge twice');
  assert.equal(state.cashed, spent);
});

test('a paid activation is silent so the purchase feedback wins', () => {
  const state = createGameState({ seed: 16 });
  activatePowerup(state, 'shield', { silent: true });
  const events = drainEvents(state);
  assert.equal(events.some((e) => e.type === 'powerup'), false);
  assert.ok(state.powerups.shield.active);
});

test('a new run clears the pads and the cash ledger', () => {
  const state = createGameState({ seed: 17 });
  state.chain = 40;
  state.chainTimer = SCORE.chainTimeout;
  padAt(state, 'shield', -100, 400);
  runTicks(state, { jump: false, down: true }, 0.5);
  assert.equal(state.padsBought, 1);

  resetGame(state, 18);
  assert.equal(state.padsBought, 0);
  assert.equal(state.cashed, 0);
  assert.equal(state.padsRefused, 0);
  assert.equal(state.pads.filter((p) => p.used).length, 0);
});

/* --------------------------------------------------- airborne arc contract */

/**
 * `player.x` advances at `state.speed`, so a jump's reach is `speed x airtime`
 * and the generator sizes gaps against it. That only holds if the speed cannot
 * change while the runner is in the air.
 */
test('an airborne arc keeps its take-off speed', () => {
  const state = createGameState({ seed: 21 });
  state.pickups.length = 0;
  activatePowerup(state, 'overdrive');
  stepGame(state, DT, NONE);
  const takeoff = state.speed;
  assert.ok(takeoff > state.baseSpeed, 'overdrive should be boosting the take-off speed');

  runTicks(state, { jump: true, down: false }, 0.1);
  assert.equal(state.player.onGround, false, 'the runner should be airborne');
  assert.equal(state.speed, takeoff, 'the arc starts at the take-off speed');

  // Pull the bonus out from under the arc.
  state.powerups.overdrive.active = false;
  state.powerups.overdrive.timer = 0;
  runTicks(state, { jump: true, down: false }, 0.3);
  assert.equal(state.player.onGround, false, 'still airborne');
  assert.equal(state.speed, takeoff, 'the arc speed is latched for the whole flight');

  // Landing releases the latch, so the bonus is gone for the next arc.
  runTicks(state, NONE, 0.8);
  assert.equal(state.player.onGround, true, 'the runner should have landed');
  assert.ok(state.speed < takeoff, 'without overdrive the speed drops after landing');
});

test('a bonus expiring mid-jump does not move where the arc lands', () => {
  // `player.x` advances at `state.speed`, so the generator sizes every gap
  // against `takeoffSpeed x airtime`. This is that contract, measured: the same
  // jump must land in the same place whether or not a bonus survives the flight.
  const airtime = (2 * PLAYER.jumpVelocity) / PLAYER.gravity;

  /** Jump with overdrive and return where the runner touched down. */
  const jumpAndMeasure = (dropBoosterMidFlight) => {
    const state = createGameState({ seed: 22 });
    state.pickups.length = 0;
    state.hazards.length = 0;
    state.gaps.length = 0;
    activatePowerup(state, 'overdrive');
    runTicks(state, NONE, 0.05);

    const takeoffX = state.player.x;
    const takeoffSpeed = state.speed;
    assert.ok(takeoffSpeed > state.baseSpeed, 'overdrive should boost the take-off');

    runTicks(state, { jump: true, down: false }, 0.1);
    assert.equal(state.player.onGround, false, 'the runner should be airborne');
    if (dropBoosterMidFlight) {
      state.powerups.overdrive.active = false;
      state.powerups.overdrive.timer = 0;
    }

    // Fly out the rest of the arc with nothing in the way.
    let guard = 0;
    while (!state.player.onGround && guard++ < 600) {
      stepGame(state, DT, { jump: true, down: false });
      drainEvents(state);
    }
    assert.equal(state.player.onGround, true, 'the runner should land');
    return {
      reach: state.player.x - takeoffX,
      plainReach: state.baseSpeed * airtime,
    };
  };

  const kept = jumpAndMeasure(false);
  const dropped = jumpAndMeasure(true);

  assert.ok(
    Math.abs(kept.reach - dropped.reach) < 4,
    `losing the bonus mid-air moved the landing by ${Math.abs(kept.reach - dropped.reach).toFixed(1)}px ` +
      `(kept ${kept.reach.toFixed(1)}, dropped ${dropped.reach.toFixed(1)})`,
  );
  // ...and the boost genuinely does work, so the assertion above is not
  // trivially satisfied by a short arc.
  assert.ok(
    dropped.reach > dropped.plainReach * 1.2,
    `the boosted arc should reach much further than an unboosted one ` +
      `(${dropped.reach.toFixed(0)} vs ${dropped.plainReach.toFixed(0)})`,
  );
});
