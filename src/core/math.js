/** Small math helpers shared by simulation, rendering and tests. */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const clamp01 = (v) => clamp(v, 0, 1);

/** Frame-rate independent exponential smoothing (`lambda` = "speed"). */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Move `current` towards `target` by at most `maxDelta`. */
export const approach = (current, target, maxDelta) => {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
};

export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutQuad = (t) => 1 - (1 - clamp01(t)) * (1 - clamp01(t));
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export const TAU = Math.PI * 2;

/* ------------------------------------------------------------- collision */

/** Axis-aligned rect overlap. Rects are `{x, y, w, h}` (x/y = top-left). */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Overlap test with an inflation applied to `b` (positive = more forgiving). */
export function rectsOverlapInflated(a, b, inflate) {
  return (
    a.x < b.x + b.w + inflate &&
    a.x + a.w > b.x - inflate &&
    a.y < b.y + b.h + inflate &&
    a.y + a.h > b.y - inflate
  );
}

/** Circle (centre + radius) vs. rect overlap. */
export function circleRectOverlap(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** Shortest distance from a point to a rect (0 when inside). */
export function pointRectDistance(px, py, rect) {
  const nx = clamp(px, rect.x, rect.x + rect.w);
  const ny = clamp(py, rect.y, rect.y + rect.h);
  return Math.hypot(px - nx, py - ny);
}

/** Gap between two rects on the x axis (negative when they overlap). */
export const rectGapX = (a, b) => Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
