import test from 'node:test';
import assert from 'node:assert/strict';

import { installStubs } from './helpers/browser-stub.js';

/**
 * Boots the real `main.js` against the DOM/WebAudio stubs and drives its frame
 * loop by hand. This covers the parts unit tests cannot reach: the scene
 * machine, camera maths, renderer, particle dispatch and the audio scheduler.
 */
const env = installStubs();
await import('../src/main.js');
const app = globalThis.__neonDrift;

const runFrames = (count, dtMs = 16.6) => {
  for (let i = 0; i < count; i++) env.tick(dtMs);
};

test('the game boots into the title screen and starts rendering', () => {
  assert.ok(app, 'main.js should expose its debug surface');
  assert.equal(app.scene, 'title');
  assert.ok(env.hasFrame(), 'the loop should have queued the next frame');

  const before = { ...env.counts };
  runFrames(30);
  assert.ok(env.counts.fillRect > before.fillRect, 'the renderer must draw rectangles');
  assert.ok(env.counts.fill > before.fill, 'the renderer must fill paths');
  assert.ok(env.counts.gradients > 0, 'gradients should be created');
});

test('the attract mode demo advances behind the title screen', () => {
  const demo = app.demo;
  const startMetres = demo.metres;
  runFrames(240);
  assert.ok(demo.metres > startMetres, 'the demo runner should be moving');

  // The demo is played by the autopilot, so it should clear hazards.
  runFrames(600);
  assert.ok(demo.hazardsCleared > 0 || demo.dead, 'the demo should be interacting with hazards');
});

test('starting a run switches scene, plays audio and keeps scoring', () => {
  const oscillatorsBefore = env.counts.oscillators;
  app.start();
  assert.equal(app.scene, 'playing');
  assert.equal(app.state.dead, false);
  assert.equal(app.state.score, 0);

  // ~2s of play: enough to score, short enough that the untouched runner has
  // not reached the first hazard yet.
  runFrames(120);
  assert.ok(app.state.metres > 20, `expected distance, got ${app.state.metres}`);
  assert.ok(app.state.score > 0, 'score should grow with distance');
  assert.ok(env.counts.oscillators > oscillatorsBefore, 'music/sfx should schedule oscillators');
  assert.ok(app.fps > 30, `fps should be sane, got ${app.fps}`);

  // Score is monotonic while nothing is hit.
  const before = app.state.score;
  runFrames(30);
  assert.ok(app.state.score >= before);
});

test('an untouched runner eventually hits a hazard and dies', () => {
  app.start();
  runFrames(600);
  assert.equal(app.state.dead, true, 'the game should be beatable only by playing');
  assert.ok(app.state.metres > 20);
});

test('jumping and sliding from the input pipeline work in the live loop', () => {
  app.start();
  runFrames(30);
  assert.equal(app.state.player.onGround, true);

  app.setInput(true, false);
  runFrames(6);
  app.setInput(false, false);
  assert.equal(app.state.player.onGround, false, 'input should launch the player');

  runFrames(90);
  app.setInput(false, true);
  runFrames(10);
  assert.equal(app.state.player.sliding, true, 'holding down should slide');
  app.setInput(false, false);
});

test('pausing freezes the simulation and resuming continues it', () => {
  app.start();
  runFrames(120);
  app.pause();
  assert.equal(app.scene, 'paused');
  const frozen = { metres: app.state.metres, score: app.state.score };
  runFrames(120);
  assert.equal(Math.round(app.state.metres), Math.round(frozen.metres));
  assert.equal(app.state.score, frozen.score);

  app.resume();
  assert.equal(app.scene, 'playing');
  runFrames(120);
  assert.ok(app.state.metres > frozen.metres);
});

test('dying shows the game-over screen with populated stats', () => {
  app.start();
  runFrames(300);
  const score = app.state.score;

  // Force a fatal collision from the test side.
  app.state.hazards.length = 0;
  const player = app.state.player;
  app.state.hazards.push({
    id: 123456,
    kind: 'spike',
    x: player.x - 12,
    x2: player.x + 32,
    y: 560 - 30,
    w: 44,
    h: 30,
    avoid: 'jump',
    passed: false,
    dead: false,
    minDist: Infinity,
    group: 4242,
    speed: 400,
    diff: 0,
  });

  runFrames(200);
  assert.equal(app.state.dead, true, 'the forced hit should be fatal');
  assert.equal(app.scene, 'over', 'the game-over screen should be shown');
  assert.ok(
    Number(env.elements.get('over-score').textContent.replace(/,/g, '')) >= score,
    'the game-over screen should show the score',
  );
  assert.equal(env.elements.get('over-title').textContent.length > 0, true);
  assert.notEqual(env.elements.get('over-cashed').textContent, '', 'the panel reports chain cashed');
  assert.notEqual(env.elements.get('over-pads').textContent, '', 'the panel reports pads bought');
  assert.notEqual(env.elements.get('over-total-cashed').textContent, '', 'the panel reports lifetime cashed');
  assert.ok(env.store.has('neon-drift.save.v1'), 'the run should be persisted');
});

test('a new run can be started after dying', () => {
  app.start();
  assert.equal(app.scene, 'playing');
  assert.equal(app.state.dead, false);
  assert.equal(app.state.score, 0);
  runFrames(120);
  assert.ok(app.state.metres > 10);
});

test('cashing in a pad works end to end in the live loop', () => {
  app.start();
  runFrames(60);

  const state = app.state;
  // A clean stage: no hazards to die on, no coins to muddy the arithmetic.
  state.hazards.length = 0;
  state.gaps.length = 0;
  state.pickups.length = 0;
  state.chain = 40;
  state.chainTimer = 999;

  const x = state.player.x + 40;
  state.pads.push({
    id: 4242,
    kind: 'shield',
    cost: 20,
    x,
    x2: x + 320,
    w: 320,
    y: 560,
    used: false,
    charge: 0,
    grace: 0,
    flash: 0,
    denied: 0,
    group: 1,
    phase: 0,
  });

  const chainBefore = state.chain;
  const drawsBefore = env.counts.fill + env.counts.fillRect;
  const tonesBefore = env.counts.oscillators;

  app.setInput(false, true); // hold down, as a player would on the pad
  runFrames(45);
  app.setInput(false, false);

  assert.equal(state.padsBought, 1, 'the pad should have been bought');
  assert.equal(state.cashed, 20);
  assert.equal(state.chain, chainBefore - 20);
  assert.ok(state.powerups.shield.active, 'the payload is live');
  assert.ok(
    env.counts.fill + env.counts.fillRect > drawsBefore,
    'the pad must render (and keep rendering) without throwing',
  );
  assert.ok(
    env.counts.oscillators > tonesBefore,
    'the purchase sting must schedule audio',
  );

  // And the run keeps going afterwards.
  const metres = state.metres;
  runFrames(60);
  assert.ok(state.metres > metres, 'play continues after a purchase');
  assert.equal(state.dead, false, 'a purchase must not end the run');
});
