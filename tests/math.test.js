import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  clamp01,
  lerp,
  invLerp,
  approach,
  damp,
  smoothstep,
  rectsOverlap,
  rectsOverlapInflated,
  circleRectOverlap,
  pointRectDistance,
  rectGapX,
} from '../src/core/math.js';

test('clamp / clamp01', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-0.5), 0);
});

test('lerp / invLerp / smoothstep', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(invLerp(0, 10, 2.5), 0.25);
  assert.equal(invLerp(3, 3, 9), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-9);
});

test('approach moves towards the target without overshooting', () => {
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(9, 10, 3), 10);
  assert.equal(approach(10, 0, 4), 6);
});

test('damp converges and is frame-rate independent', () => {
  let a = 0;
  for (let i = 0; i < 100; i++) a = damp(a, 1, 8, 1 / 60);
  assert.ok(Math.abs(a - 1) < 0.01);
  const oneStep = damp(0, 1, 8, 0.1);
  let many = 0;
  for (let i = 0; i < 10; i++) many = damp(many, 1, 8, 0.01);
  assert.ok(Math.abs(oneStep - many) < 0.01);
});

test('rect overlap helpers', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 5, y: 5, w: 10, h: 10 };
  const c = { x: 20, y: 0, w: 5, h: 5 };
  assert.equal(rectsOverlap(a, b), true);
  assert.equal(rectsOverlap(a, c), false);
  // Touching edges do not count as overlap.
  assert.equal(rectsOverlap(a, { x: 10, y: 0, w: 5, h: 5 }), false);
  // Inflating by 6 is not enough to close a 10px gap; 12 is.
  assert.equal(rectsOverlapInflated(a, c, 6), false);
  assert.equal(rectsOverlapInflated(a, c, 12), true);
  assert.equal(rectGapX(a, c), 10);
});

test('circleRectOverlap and distance', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(circleRectOverlap(5, 5, 1, rect), true);
  assert.equal(circleRectOverlap(20, 5, 3, rect), false);
  assert.equal(circleRectOverlap(20, 5, 11, rect), true);
  assert.equal(pointRectDistance(5, 5, rect), 0);
  assert.equal(pointRectDistance(-3, 5, rect), 3);
});
