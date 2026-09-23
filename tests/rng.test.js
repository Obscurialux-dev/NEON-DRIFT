import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashSeed } from '../src/core/rng.js';

test('rng: identical seeds produce identical streams', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 200; i++) assert.equal(a.next(), b.next());
});

test('rng: different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  let same = 0;
  for (let i = 0; i < 50; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 3, `expected diverging streams, saw ${same} collisions`);
});

test('rng: next() stays inside [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 5000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('rng: range and int bounds are respected', () => {
  const rng = createRng(99);
  for (let i = 0; i < 2000; i++) {
    const v = rng.range(-5, 12);
    assert.ok(v >= -5 && v < 12);
    const n = rng.int(3, 6);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6);
  }
});

test('rng: int covers both endpoints', () => {
  const rng = createRng(4);
  const seen = new Set();
  for (let i = 0; i < 800; i++) seen.add(rng.int(0, 2));
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('rng: weighted selection honours weights', () => {
  const rng = createRng(2024);
  const pool = [
    { id: 'never', weight: 0 },
    { id: 'heavy', weight: 9 },
    { id: 'light', weight: 1 },
  ];
  const counts = { heavy: 0, light: 0, never: 0 };
  for (let i = 0; i < 4000; i++) counts[rng.weighted(pool).id]++;
  assert.equal(counts.never, 0);
  assert.ok(counts.heavy > counts.light * 4, `heavy=${counts.heavy} light=${counts.light}`);
});

test('rng: weighted tolerates an all-zero pool', () => {
  const rng = createRng(1);
  const item = rng.weighted([{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }]);
  assert.equal(item.id, 'a');
});

test('rng: shuffle keeps every element exactly once', () => {
  const rng = createRng(11);
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = rng.shuffle(list);
  assert.equal(out.length, list.length);
  assert.deepEqual([...out].sort((a, b) => a - b), list);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8], 'shuffle must not mutate the input');
});

test('rng: chance(0) never fires and chance(1) always does', () => {
  const rng = createRng(5);
  for (let i = 0; i < 500; i++) {
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  }
});

test('hashSeed: stable and order sensitive', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('acb'));
  assert.ok(hashSeed('run-42') > 0);
});
