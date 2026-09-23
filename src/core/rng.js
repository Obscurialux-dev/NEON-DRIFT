/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * Determinism matters here: the level generator, the particle jitter and the
 * decorative background all draw from seeded streams, which makes a run
 * reproducible from its seed — and makes the level generator testable.
 */

export function createRng(seed = 1) {
  let a = seed >>> 0;

  const rng = {
    seed: seed >>> 0,
    /** Uniform float in [0, 1). */
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Uniform float in [min, max). */
    range(min, max) {
      return min + rng.next() * (max - min);
    },
    /** Uniform integer in [min, max] (inclusive). */
    int(min, max) {
      return Math.floor(rng.range(min, max + 1));
    },
    chance(probability) {
      return rng.next() < probability;
    },
    /** Uniformly pick one element. */
    pick(list) {
      return list[Math.floor(rng.next() * list.length)];
    },
    /** Pick from `[{ weight, ... }]` (weight may be a number or a function(i)). */
    weighted(list, weightOf = (item) => item.weight ?? 1) {
      let total = 0;
      for (let i = 0; i < list.length; i++) total += Math.max(0, weightOf(list[i], i));
      if (total <= 0) return list[0];
      let roll = rng.next() * total;
      for (let i = 0; i < list.length; i++) {
        roll -= Math.max(0, weightOf(list[i], i));
        if (roll <= 0) return list[i];
      }
      return list[list.length - 1];
    },
    /** Fisher-Yates copy. */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** Random sign: -1 or 1. */
    sign() {
      return rng.next() < 0.5 ? -1 : 1;
    },
  };

  return rng;
}

/** Cheap, stable 32-bit string hash — used to derive seeds from run counters. */
export function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
