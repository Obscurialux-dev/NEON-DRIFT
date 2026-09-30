/**
 * Tiny zero-dependency frame profiler.
 *
 * Two jobs:
 *   1. Feed the `?debug=1` overlay (frame time, per-stage cost, workload counters).
 *   2. Give the browser perf harness (`npm run perf`) something to read.
 *
 * It is deliberately *off* unless asked for: with `enabled === false` the call
 * sites in `main.js` skip their `performance.now()` reads entirely, so shipping
 * builds pay nothing but a boolean branch.
 *
 * Cost when enabled: two `performance.now()` calls per instrumented stage
 * (~14 per frame). `performance.now()` is cheap and monotonic — no allocation,
 * no DOM touch, so it is safe inside the render loop.
 */

/** Exponentially-weighted smoothing factor for the averages. */
const SMOOTHING = 0.1;

/**
 * @param {{ enabled?: boolean }} options
 */
export function createProfiler({ enabled = false } = {}) {
  /** @type {Map<string, { last: number, ema: number, peak: number, calls: number }>} */
  const sections = new Map();
  let t0 = 0;

  const bucket = (name) => {
    let s = sections.get(name);
    if (!s) {
      s = { last: 0, ema: 0, peak: 0, calls: 0 };
      sections.set(name, s);
    }
    return s;
  };

  return {
    enabled: !!enabled,
    sections,

    /** Frame delta of the most recent frame, and smoothed/peak values (ms). */
    frameMs: 0,
    frameEma: 0,
    framePeak: 0,
    fps: 60,

    /** Cheap workload counters, refreshed once per frame by the app. */
    metrics: {
      particles: 0,
      particlesCap: 0,
      entities: 0,
      steps: 0,
      simMs: 0,
      quality: 'high',
    },

    /* ------------------------------------------------------------ sampling */

    /** Start timing a stage. */
    begin() {
      t0 = performance.now();
    },

    /** Stop timing a stage and fold it into that stage's stats. */
    end(name) {
      const dt = performance.now() - t0;
      const s = bucket(name);
      s.last = dt;
      s.ema += (dt - s.ema) * SMOOTHING;
      s.calls += 1;
      if (dt > s.peak) s.peak = dt;
    },

    /** Called once per rendered frame with the raw frame delta in milliseconds. */
    tick(dtMs) {
      this.frameMs = dtMs;
      this.frameEma += (dtMs - this.frameEma) * SMOOTHING;
      if (dtMs > this.framePeak) this.framePeak = dtMs;
      if (dtMs > 0) this.fps = 1000 / dtMs;
    },

    reset() {
      sections.clear();
      this.framePeak = 0;
      this.frameEma = this.frameMs;
    },

    /** Smoothed milliseconds spent in one stage (0 when it never ran). */
    ms(name) {
      const s = sections.get(name);
      return s ? s.ema : 0;
    },

    /** Total smoothed render cost of every instrumented stage, in ms. */
    total() {
      let sum = 0;
      for (const s of sections.values()) sum += s.ema;
      return sum;
    },

    /** Plain, JSON-safe copy — used by the debug overlay and the smoke tests. */
    snapshot() {
      const out = {
        frameMs: round(this.frameEma),
        framePeak: round(this.framePeak),
        fps: round(this.fps),
        total: round(this.total()),
        metrics: { ...this.metrics },
        sections: {},
      };
      for (const [name, s] of sections) {
        out.sections[name] = { ms: round(s.ema), peak: round(s.peak), calls: s.calls };
      }
      return out;
    },
  };
}

const round = (v) => Math.round(v * 1000) / 1000;
