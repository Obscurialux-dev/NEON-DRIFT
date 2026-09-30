/**
 * Cached glow sprites — the cheap half of the neon look.
 *
 * `shadowBlur` and per-frame `createRadialGradient` calls are the two most
 * expensive things a 2D canvas can be asked to do: each one makes the rasteriser
 * build a temporary layer and run a filter over it, every frame, for every
 * entity. A sprite is the same picture baked *once* into a small offscreen
 * canvas, after which drawing it is a plain textured blit.
 *
 * Every helper here caches by colour (and geometry) in a bounded map, so a long
 * run cannot leak canvases. Sprites are tinted through an alpha mask, which
 * means any CSS colour works — including the `hsl()` hues the gems cycle
 * through.
 */
const MASK_SIZE = 96;
const CACHE_LIMIT = 160;

const cache = new Map();
let mask = null;

function remember(key, canvas) {
  if (cache.size >= CACHE_LIMIT) {
    // Oldest-first eviction is fine: the working set is a handful of palette
    // colours plus whatever hues the gems are currently cycling through.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, canvas);
  return canvas;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** White radial falloff used as the tint source for every round glow. */
function radialMask() {
  if (mask) return mask;
  const canvas = makeCanvas(MASK_SIZE, MASK_SIZE);
  const g = canvas.getContext('2d');
  const r = MASK_SIZE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  // Falloff tuned to match the original `shadowBlur` haloes: a bright core, a
  // steep shoulder and a fast tail. (Stops measured against the radial
  // gradients the pre-optimisation build used for its sun, coins and orbs.)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.1)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  mask = canvas;
  return canvas;
}

/** A soft round glow in `color`. */
export function radialSprite(color) {
  const key = `r|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(MASK_SIZE, MASK_SIZE);
  const g = canvas.getContext('2d');
  g.drawImage(radialMask(), 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  return remember(key, canvas);
}

/**
 * A one-dimensional gradient (used for light shafts, fog bands, floor depth and
 * pit rims). `stops` is `[[offset, cssColor], ...]`; the sprite is 64px thick
 * along the gradient axis and stretched by the caller.
 */
export function gradientSprite(stops, { axis = 'y', thickness = 64 } = {}) {
  const key = `${axis}|${thickness}|${stops.map(([o, c]) => `${o}:${c}`).join(';')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = axis === 'x' ? makeCanvas(thickness, 1) : makeCanvas(1, thickness);
  const g = canvas.getContext('2d');
  const grad =
    axis === 'x'
      ? g.createLinearGradient(0, 0, thickness, 0)
      : g.createLinearGradient(0, 0, 0, thickness);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, axis === 'x' ? thickness : 1, axis === 'x' ? 1 : thickness);
  return remember(key, canvas);
}


/** Vertical light shaft that fades out towards the top (orbs, charge pads). */
export function beamSprite(color, alphaBottom = 0.35, alphaTop = 0) {
  return gradientSprite(
    [
      [0, withAlpha(color, alphaTop)],
      [0.72, withAlpha(color, alphaBottom * 0.45)],
      [1, withAlpha(color, alphaBottom)],
    ],
    { axis: 'y', thickness: 64 },
  );
}

/** Vertical light shaft that is bright at the top and fades downwards — the
 * security drone's search cone. Bake at full alpha and modulate on draw. */
export function shaftSprite(color) {
  return gradientSprite(
    [
      [0, withAlpha(color, 1)],
      [0.45, withAlpha(color, 0.35)],
      [1, withAlpha(color, 0)],
    ],
    { axis: 'y', thickness: 64 },
  );
}

/** Soft horizontal falloff, used for the danger rims of a chasm. */
export function rimSprite(color, alphaNear = 0.55) {
  return gradientSprite(
    [
      [0, withAlpha(color, alphaNear)],
      [1, withAlpha(color, 0)],
    ],
    { axis: 'x', thickness: 64 },
  );
}

/** Vertical band that fades in and out again — the drifting fog layers. */
export function bandSprite(color, alphaMid = 0.16) {
  return gradientSprite(
    [
      [0, withAlpha(color, 0)],
      [0.5, withAlpha(color, alphaMid)],
      [1, withAlpha(color, 0)],
    ],
    { axis: 'y', thickness: 64 },
  );
}

/** The floor's depth ramp: neon edge at the surface, black at the bottom. */
export function depthSprite(edgeColor, floorColor) {
  return gradientSprite(
    [
      [0, withAlpha(edgeColor, 0.16)],
      [0.12, floorColor],
      [1, '#01020a'],
    ],
    { axis: 'y', thickness: 128 },
  );
}

/**
 * Draw a sprite stretched into a box. Manages the two pieces of context state
 * it needs by hand (no save/restore inside the particle loops).
 */
export function drawSprite(ctx, sprite, x, y, w, h, alpha = 1, additive = false) {
  if (alpha <= 0 || w <= 0 || h <= 0) return;
  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  if (additive) ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, prevAlpha * alpha);
  ctx.drawImage(sprite, x, y, w, h);
  ctx.globalCompositeOperation = prevComposite;
  ctx.globalAlpha = prevAlpha;
}

/** Centred round glow: `radius` is the visible halo radius, not the diameter. */
export function drawGlow(ctx, x, y, radius, color, alpha = 1, additive = true) {
  drawSprite(ctx, radialSprite(color), x - radius, y - radius, radius * 2, radius * 2, alpha, additive);
}

/** Turn any CSS colour into something with an explicit alpha. */
export function withAlpha(color, a) {
  if (a >= 1) return color;
  if (color[0] === '#') {
    const value = parseInt(color.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  }
  if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', `,${a})`);
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

/** Drop every cached sprite. */
export function clearSprites() {
  cache.clear();
}

/** Cache size for the debug overlay / harness. */
export const spriteCount = () => cache.size;

/** Text halo used by the HUD: a stretched soft glow behind a measured string. */
export function textHalo(ctx, width, x, y, color, blur, alpha) {
  const pad = blur * 1.5;
  const h = blur * 4.4;
  drawSprite(ctx, radialSprite(color), x - pad, y - h * 0.66, width + pad * 2, h, alpha, true);
}
