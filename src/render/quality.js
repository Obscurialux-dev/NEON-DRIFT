/**
 * Render quality: device tiering, render resolution and the adaptive controller.
 *
 * The game renders a fixed *virtual* view (1280x720 units) into a backing store
 * whose device-pixel size is chosen here. Three things decide that size:
 *
 *   1. the preset     — a hard cap (`maxDpr`) and a budget in device pixels
 *   2. the CSS size   — a bigger window gets proportionally fewer pixels/unit
 *   3. the adaptive   — a live multiplier that trades sharpness for frame time
 *
 * Nothing here touches the DOM or the canvas: it only does arithmetic, so the
 * unit tests can drive it in Node.
 */
import { clamp } from '../core/math.js';

/**
 * Quality presets. `pixelBudget` is the important number: it is the ceiling on
 * `canvas.width * canvas.height`, and it is what stops a DPR-3 phone from
 * rasterising 2.6 Mpx of neon every frame.
 */
export const PRESETS = {
  high: {
    label: 'high',
    /** Never render above this device pixel ratio. */
    maxDpr: 2,
    /** Ceiling for the backing store, in device pixels. */
    pixelBudget: 2.3e6,
    /** Resolution multiplier for the cached parallax layers. */
    bgScale: 0.6,
    /** Resolution multiplier for the baked sky. */
    skyScale: 0.8,
    /** Keep the animated scan bands on the sun disc. */
    sunBands: true,
    /** Hard cap on simultaneously live particles. */
    particleCap: 900,
    /** Multiplier for decorative-only particles (dust, streaks). */
    decorativeScale: 1,
    starTwinkle: true,
    /** Blur haloes (text glow layer / backdrop effects). */
    glow: true,
    /** Cache the static parts of the HUD into offscreen canvases. */
    hudCache: true,
  },
  medium: {
    label: 'medium',
    maxDpr: 1.5,
    pixelBudget: 1.35e6,
    bgScale: 0.5,
    skyScale: 0.65,
    sunBands: true,
    particleCap: 520,
    decorativeScale: 0.6,
    starTwinkle: true,
    glow: true,
    hudCache: true,
  },
  low: {
    label: 'low',
    maxDpr: 1.25,
    pixelBudget: 0.75e6,
    bgScale: 0.4,
    skyScale: 0.5,
    sunBands: false,
    particleCap: 260,
    decorativeScale: 0.35,
    starTwinkle: false,
    glow: true,
    hudCache: true,
  },
};

/** Smallest adaptive multiplier — below this the picture visibly falls apart. */
const MIN_BIAS = 0.55;

/** A frame this slow (ms) means we are missing 60 fps and should shed pixels. */
const SLOW_FRAME = 21;
/**
 * ...and this fast means we have headroom. It sits just above the 16.7 ms vsync
 * period on purpose: a machine holding 60 fps measures ~16.7 ms every frame, and
 * a lower threshold would leave the controller stuck at a reduced scale forever.
 */
const FAST_FRAME = 19.5;
/** Down-steps are bigger than up-steps, so the controller converges downwards
 * instead of oscillating when a device sits right on the edge. */
const DOWN_STEP = 0.88;
const UP_STEP = 1.04;
/**
 * Mean frame time that counts as "over budget" / "comfortably inside budget".
 * The gap between them is the hysteresis band: a device that can only just hold
 * 60 fps keeps the resolution it has instead of flapping.
 */
const SLOW_MEAN = 18.0;
const FAST_MEAN = 17.0;
/** Frames per evaluation window, and how much of it must be slow to step down. */
const WINDOW = 60;
const SLOW_RATIO = 0.3;
/** Milliseconds of sustained fast frames before scaling back up. */
const UP_HOLD_MS = 4000;
/** Minimum gap between two scale changes (ms). */
const SETTLE_MS = 900;


/**
 * Best guess at how much a device can take, before any measurement.
 * Deliberately conservative: a wrong guess costs a few quiet frames of adaptive
 * re-scaling, while an optimistic one shows up as stutter on a cheap phone.
 */
export function detectTier(win = globalThis) {
  const nav = win.navigator ?? {};
  const ua = nav.userAgent ?? '';
  const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  const touchPoints = nav.maxTouchPoints ?? 0;
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua);

  if (mobileUA || (coarse && touchPoints > 1)) return 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

/**
 * @param {object} options
 * @param {URLSearchParams} [options.params] `location.search`, for the
 *   `?quality=` / `?scale=` / `?adaptive=0` overrides.
 * @param {Window} [options.win]
 */
export function createQuality({ params = null, win = globalThis } = {}) {
  const forced = params?.get('quality');
  const requested = forced && PRESETS[forced] ? forced : null;
  let name = requested ?? detectTier(win);
  let preset = PRESETS[name];

  /** User-pinned resolution multiplier (`?scale=`), disables the adaptive loop. */
  const pinned = params?.has('scale') ? clamp(Number(params.get('scale')) || 1, 0.25, 2) : null;
  /** Adaptive multiplier, 1 = the preset's full resolution. */
  let bias = 1;
  let settled = 0;
  let fastMs = 0;
  let windowFrames = 0;
  let slowFrames = 0;
  let windowStart = 0;
  const adaptive = params?.get('adaptive') === '0' ? false : pinned === null;

  /** Last computed geometry, kept so the caller can tell what actually changed. */
  let geometry = { dpr: 1, scale: 1, width: 1, height: 1, bias: 1 };
  let clock = 0;

  /**
   * Work out the backing store for a CSS size. `dpr` is the *effective* device
   * pixel ratio: the device's, capped by the preset and the pixel budget.
   */
  function choose(cssW, cssH, deviceDpr) {
    const scale = Math.max(0.05, cssW / 1280);
    const dprCap = Math.min(deviceDpr || 1, preset.maxDpr);
    const area = Math.max(1, cssW * cssH);
    // Pixels allowed by the budget, expressed as a DPR, then trimmed by the
    // adaptive multiplier.
    const budgetDpr = Math.sqrt(preset.pixelBudget / area);
    const factor = Math.min(1, budgetDpr / dprCap);
    const dpr = dprCap * clamp(factor * bias * (pinned ?? 1), 0.35, 1.5);
    return {
      dpr,
      scale,
      width: Math.max(1, Math.round(cssW * dpr)),
      height: Math.max(1, Math.round(cssH * dpr)),
      bias,
    };
  }

  /** Recompute and remember the geometry; `changed` flags a new backing store. */
  function resize(cssW, cssH, deviceDpr) {
    const next = choose(cssW, cssH, deviceDpr);
    const changed = Math.abs(next.dpr - geometry.dpr) > 0.01;
    geometry = next;
    return { ...next, changed };
  }

  /**
   * Feed one frame's duration (ms) in. Returns `true` when the adaptive
   * controller wants a different render scale (the caller re-runs `resize`).
   *
   * Decisions are made per window of 60 frames rather than per frame, so a
   * single hitch (GC, a spawn burst, the window regaining focus) cannot ratchet
   * the resolution down.
   */
  function observe(frameMs) {
    if (!adaptive || !Number.isFinite(frameMs) || frameMs <= 0) return false;
    clock += frameMs;
    windowFrames++;
    if (frameMs > SLOW_FRAME) slowFrames++;
    else if (frameMs < FAST_FRAME) fastMs += frameMs;
    if (windowFrames < WINDOW) return false;

    const ratio = slowFrames / windowFrames;
    const mean = (clock - windowStart) / windowFrames;
    const frames = windowFrames;
    windowStart = clock;
    windowFrames = 0;
    slowFrames = 0;
    if (clock - settled < SETTLE_MS) return false;

    if ((ratio > SLOW_RATIO || mean > SLOW_MEAN) && bias > MIN_BIAS) {
      bias = Math.max(MIN_BIAS, bias * DOWN_STEP);
      settled = clock;
      fastMs = 0;
      return true;
    }
    if (mean < FAST_MEAN && bias < 1) {
      // `fastMs` is roughly "milliseconds spent comfortably inside budget".
      fastMs += mean * frames;
      if (fastMs >= UP_HOLD_MS) {
        bias = Math.min(1, bias * UP_STEP);
        settled = clock;
        fastMs = 0;
        return true;
      }
    } else {
      fastMs = 0;
    }
    return false;
  }

  function setPreset(next) {
    if (!PRESETS[next]) return false;
    name = next;
    preset = PRESETS[next];
    return true;
  }

  return {
    get name() {
      return name;
    },
    get preset() {
      return preset;
    },
    get bias() {
      return bias;
    },
    get adaptive() {
      return adaptive;
    },
    get pinned() {
      return pinned;
    },
    get geometry() {
      return geometry;
    },
    resize,
    observe,
    setPreset,
    /** One-line summary for the `?debug=1` overlay. */
    describe() {
      return `${name}${adaptive ? `·a${bias.toFixed(2)}` : ''}${pinned ? `·p${pinned}` : ''}`;
    },
    /** Plain snapshot for the perf harness / tests. */
    snapshot() {
      return {
        name,
        bias: round(bias),
        adaptive,
        pinned,
        preset: { ...preset },
        dpr: round(geometry.dpr),
        backing: { width: geometry.width, height: geometry.height },
      };
    },
  };
}

const round = (v) => Math.round(v * 1000) / 1000;
