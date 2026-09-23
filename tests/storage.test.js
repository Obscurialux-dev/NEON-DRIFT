import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSave, recordRun, writeSave } from '../src/core/storage.js';
import { CONFIG } from '../src/config.js';

/** In-memory localStorage so the module can be exercised without a browser. */
const makeStorage = ({ throwOnGet = false, throwOnSet = false, seed = null } = {}) => {
  const map = new Map();
  if (seed !== null) map.set(CONFIG.storageKey, seed);
  return {
    map,
    getItem(key) {
      if (throwOnGet) throw new Error('blocked');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet) throw new Error('quota');
      map.set(key, String(value));
    },
  };
};

const withStorage = (storage, fn) => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
};

test('a missing save loads the defaults', () => {
  const save = withStorage(makeStorage(), loadSave);
  assert.equal(save.bestScore, 0);
  assert.equal(save.runs, 0);
  assert.equal(save.muted, false);
  assert.equal(save.totalCashed, 0, 'the lifetime cash line starts at zero');
  assert.equal(save.totalPads, 0);
});

test('corrupt or unreadable storage still yields usable defaults', () => {
  const corrupt = withStorage(makeStorage({ seed: '{not json' }), loadSave);
  assert.equal(corrupt.bestScore, 0, 'bad JSON should not throw');

  const blocked = withStorage(makeStorage({ throwOnGet: true }), loadSave);
  assert.equal(blocked.bestScore, 0, 'a throwing getItem should not break boot');
});

test('partial saves are filled in from the defaults', () => {
  const save = withStorage(makeStorage({ seed: JSON.stringify({ bestScore: 4210 }) }), loadSave);
  assert.equal(save.bestScore, 4210);
  assert.equal(save.bestMetres, 0, 'missing fields are defaulted');
  assert.equal(save.runs, 0);
});

test('a record run updates the bests and counts the attempt', () => {
  const storage = makeStorage();
  withStorage(storage, () => {
    const save = loadSave();
    const first = recordRun(save, {
      score: 900,
      metres: 120.7,
      coins: 5,
      bestChain: 3,
      cashed: 32,
      padsBought: 2,
    });
    assert.deepEqual(first.records.sort(), ['chain', 'coins', 'distance', 'score']);
    assert.equal(first.save.bestScore, 900);
    assert.equal(first.save.bestMetres, 120);
    assert.equal(first.save.runs, 1);
    assert.equal(first.save.totalMetres, 120);
    assert.equal(first.save.totalCashed, 32, 'chain spent accumulates across runs');
    assert.equal(first.save.totalPads, 2);

    // A worse run counts towards runs/totalMetres but beats no records.
    const second = recordRun(first.save, {
      score: 10,
      metres: 8,
      coins: 0,
      bestChain: 0,
      cashed: 12,
      padsBought: 1,
    });
    assert.deepEqual(second.records, []);
    assert.equal(second.save.bestScore, 900);
    assert.equal(second.save.runs, 2);
    assert.equal(second.save.totalMetres, 128);
    assert.equal(second.save.totalCashed, 44);
    assert.equal(second.save.totalPads, 3);

    const reloaded = loadSave();
    assert.equal(reloaded.bestScore, 900, 'the run should have been persisted');
    assert.equal(reloaded.runs, 2);
    assert.equal(reloaded.totalCashed, 44, 'the lifetime line survives a reload');
  });
});

test('writeSave reports failure instead of throwing when storage is blocked', () => {
  const ok = withStorage(makeStorage(), () => writeSave({ ...loadSave() }));
  assert.equal(ok, true);

  const failed = withStorage(makeStorage({ throwOnSet: true }), () => writeSave({ bestScore: 1 }));
  assert.equal(failed, false, 'a full/blocked localStorage must not crash a run');
});

test('a run from an older save still accumulates safely', () => {
  const storage = makeStorage();
  withStorage(storage, () => {
    // Simulates a save written before the pad economy existed.
    const legacy = { bestScore: 10, runs: 3, totalMetres: 500 };
    writeSave(legacy);
    const loaded = loadSave();
    assert.equal(loaded.totalCashed, 0, 'missing fields fall back to defaults');
    const { save } = recordRun(loaded, { score: 1, metres: 1, cashed: 8, padsBought: 1 });
    assert.equal(save.totalCashed, 8);
    assert.equal(save.totalPads, 1);
  });
});
