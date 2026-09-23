import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, GROUND_Y, PLAYER } from '../src/config.js';
import { createPlayer, updatePlayer } from '../src/game/player.js';
import { groundSurfaceAt, playerRect } from '../src/game/collision.js';

/** Bare-bones simulation state: enough for the player module. */
const makeState = (extra = {}) => ({ speed: 420, gaps: [], events: [], ...extra });

const HOLD = { jump: true, down: false };
const NONE = { jump: false, down: false };
const DUCK = { jump: false, down: true };

/** Run the player for `seconds`, returning a summary of the arc. */
function simulate(player, state, seconds, input) {
  const dt = CONFIG.fixedStep;
  let apex = player.y;
  let landedAt = null;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    updatePlayer(player, state, dt, input);
    apex = Math.min(apex, player.y);
    if (player.onGround && landedAt === null && apex < GROUND_Y - 1) landedAt = i * dt;
  }
  return { height: GROUND_Y - apex, landedAt };
}

test('player starts grounded at the origin', () => {
  const player = createPlayer();
  assert.equal(player.y, GROUND_Y);
  assert.equal(player.onGround, true);
  assert.equal(player.jumpsLeft, PLAYER.doubleJumps);
});

test('a full jump reaches the configured apex and air time', () => {
  const player = createPlayer();
  const state = makeState();
  const expectedApex = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * PLAYER.gravity);
  const expectedAirtime = (2 * PLAYER.jumpVelocity) / PLAYER.gravity;
  const { height, landedAt } = simulate(player, state, 1.4, HOLD);
  assert.ok(Math.abs(height - expectedApex) < 12, `apex ${height} vs ${expectedApex}`);
  assert.ok(Math.abs(landedAt - expectedAirtime) < 0.03, `airtime ${landedAt} vs ${expectedAirtime}`);
  assert.equal(player.onGround, true);
});

test('releasing jump early shortens the arc (variable jump height)', () => {
  const full = simulate(createPlayer(), makeState(), 1.2, HOLD);
  const cut = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  for (let i = 0; i < 6; i++) updatePlayer(cut, state, dt, HOLD);
  const short = simulate(cut, state, 1.2, NONE);
  assert.ok(short.height < full.height - 20, `cut ${short.height} vs full ${full.height}`);
});

test('double jump adds height once and only while airborne', () => {
  const single = simulate(createPlayer(), makeState(), 1.4, HOLD).height;
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  let apex = GROUND_Y;
  for (let i = 0; i < 30; i++) {
    updatePlayer(player, state, dt, HOLD);
    apex = Math.min(apex, player.y);
  }
  // Release, then press again in mid-air: that edge is the double jump.
  updatePlayer(player, state, dt, NONE);
  const jumpsBefore = player.jumpsLeft;
  for (let i = 0; i < 16; i++) {
    updatePlayer(player, state, dt, HOLD);
    apex = Math.min(apex, player.y);
  }
  const jumpsAfter = player.jumpsLeft;
  for (let i = 0; i < 260; i++) {
    updatePlayer(player, state, dt, HOLD);
    apex = Math.min(apex, player.y);
  }
  assert.equal(jumpsBefore, 1, 'a single jump leaves one air jump');
  assert.equal(jumpsAfter, 0, 'pressing again in the air must spend the double jump');
  assert.ok(GROUND_Y - apex > single + 40, `double apex ${GROUND_Y - apex} vs single ${single}`);
});

test('a third jump press in the same flight does nothing', () => {
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  for (let i = 0; i < 30; i++) updatePlayer(player, state, dt, HOLD);
  updatePlayer(player, state, dt, NONE);
  for (let i = 0; i < 20; i++) updatePlayer(player, state, dt, HOLD);
  const vyAfterDouble = player.vy;
  updatePlayer(player, state, dt, NONE);
  for (let i = 0; i < 20; i++) updatePlayer(player, state, dt, HOLD);
  assert.equal(player.jumpsLeft, 0);
  // The second press must not re-launch from the double jump's velocity.
  assert.ok(player.vy > vyAfterDouble, 'no extra upward impulse should be applied');
});

test('holding down while grounded keeps the player sliding', () => {
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  updatePlayer(player, state, dt, DUCK);
  assert.equal(player.sliding, true);
  assert.equal(player.h, PLAYER.slideH);
  for (let i = 0; i < 220; i++) updatePlayer(player, state, dt, DUCK);
  assert.equal(player.sliding, true, 'a held slide must not expire');
  assert.equal(player.h, PLAYER.slideH);
  for (let i = 0; i < 40; i++) updatePlayer(player, state, dt, NONE);
  assert.equal(player.sliding, false);
  assert.equal(player.h, PLAYER.standH);
});

test('a held slide can be jumped out of', () => {
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  updatePlayer(player, state, dt, DUCK);
  assert.equal(player.sliding, true);
  updatePlayer(player, state, dt, HOLD);
  assert.equal(player.sliding, false);
  assert.ok(player.vy < 0);
});

test('slide hitbox fits under an overhang while standing does not', () => {
  // Game geometry: the underside of an overhang sits 46px above the floor.
  const OVERHANG_CLEARANCE = 46;
  const sliding = createPlayer();
  const state = makeState();
  updatePlayer(sliding, state, CONFIG.fixedStep, DUCK);
  const slideTop = playerRect(sliding, PLAYER.forgiveness).y;
  assert.ok(
    GROUND_Y - slideTop < OVERHANG_CLEARANCE,
    `sliding clearance ${GROUND_Y - slideTop} must fit under ${OVERHANG_CLEARANCE}`,
  );

  const standing = createPlayer();
  const standTop = playerRect(standing, PLAYER.forgiveness).y;
  assert.ok(GROUND_Y - standTop > OVERHANG_CLEARANCE, 'a standing player must clip the barrier');
});

test('coyote time allows a jump just after leaving a ledge', () => {
  const player = createPlayer();
  const state = makeState({ gaps: [{ x: 100, x2: 400 }] });
  const dt = CONFIG.fixedStep;
  let guard = 0;
  while (player.onGround && guard++ < 4000) updatePlayer(player, state, dt, NONE);
  assert.equal(player.onGround, false);
  assert.ok(player.coyote > 0, 'coyote window should be open right after leaving the ground');
  updatePlayer(player, state, dt, { jump: true, down: false });
  assert.ok(player.vy < 0, 'the coyote jump should fire');
});

test('jump buffering fires a jump pressed just before landing', () => {
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  for (let i = 0; i < 24; i++) updatePlayer(player, state, dt, HOLD);
  updatePlayer(player, state, dt, NONE);
  updatePlayer(player, state, dt, { jump: true, down: false });
  let relaunched = false;
  for (let i = 0; i < 200; i++) {
    updatePlayer(player, state, dt, { jump: true, down: false });
    if (player.vy < -PLAYER.jumpVelocity * 0.5) relaunched = true;
  }
  assert.ok(relaunched, 'the buffered jump should launch the player on landing');
});

test('fast fall accelerates the descent while down is held in the air', () => {
  const normal = createPlayer();
  const fast = createPlayer();
  const dt = CONFIG.fixedStep;
  const s1 = makeState();
  const s2 = makeState();
  for (let i = 0; i < 30; i++) {
    updatePlayer(normal, s1, dt, HOLD);
    updatePlayer(fast, s2, dt, HOLD);
  }
  for (let i = 0; i < 20; i++) {
    updatePlayer(normal, s1, dt, NONE);
    updatePlayer(fast, s2, dt, { jump: false, down: true });
  }
  assert.ok(fast.y > normal.y, `fast fall should be lower (${fast.y} vs ${normal.y})`);
});

test('ground support disappears over a pit', () => {
  const gaps = [{ x: 100, x2: 200 }];
  assert.equal(groundSurfaceAt(gaps, 150), Infinity);
  assert.equal(groundSurfaceAt(gaps, 50), GROUND_Y);
  assert.equal(groundSurfaceAt(gaps, 260), GROUND_Y);
});

test('a pit that opens under the player makes them fall', () => {
  const player = createPlayer();
  const state = makeState({ gaps: [{ x: 60, x2: 900 }] });
  const dt = CONFIG.fixedStep;
  let guard = 0;
  while (player.y <= GROUND_Y && guard++ < 8000) updatePlayer(player, state, dt, NONE);
  assert.ok(player.y > GROUND_Y, 'the player must fall into the hole');
  assert.equal(player.onGround, false);
});

test('a landing frame with down held starts a slide immediately', () => {
  const player = createPlayer();
  const state = makeState();
  const dt = CONFIG.fixedStep;
  for (let i = 0; i < 40; i++) updatePlayer(player, state, dt, HOLD);
  let guard = 0;
  while (!player.onGround && guard++ < 400) updatePlayer(player, state, dt, DUCK);
  assert.equal(player.onGround, true);
  assert.equal(player.sliding, true, 'held down must slide on the landing frame');
});

