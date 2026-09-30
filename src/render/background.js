/**
 * Parallax environment: sky, stars, moon, procedural neon skyline, fog bands and
 * the (pit-broken) floor.
 *
 * Everything here is generated from an index hash rather than stored, and the
 * expensive halves of that generation are *baked*:
 *
 *   sky     one gradient + sun + glow, rendered into an offscreen canvas and
 *           re-blitted until the palette or the view size changes
 *   stars   a baked field, drifted with a wrap-around blit
 *   skyline three tiled strips (one per parallax layer). Each strip holds
 *           `TILES` buildings; the building at index `i` hashes `i % TILES`, so
 *           the strip is exactly periodic and can be reused forever instead of
 *           re-running the window hash ~500 times per frame
 *   fog     three stretched gradient sprites instead of three live gradients
 *   floor   a cached depth ramp + a cached edge glow instead of a live gradient
 *           and a `shadowBlur` per frame
 *
 * The strips are re-baked only when the palette reaches a new quantised step
 * (a handful of times per district cross-fade), never per frame. Layout,
 * parallax rates and palette values are unchanged.
 */
import { GROUND_Y, VIEW_W } from '../config.js';
import { alpha } from './theme.js';
import { bandSprite, depthSprite, drawSprite, gradientSprite, radialSprite } from './glow.js';

/** Cheap deterministic hash → [0,1). */
function rnd(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const LAYERS = [
  { pitch: 190, parallax: 0.14, minH: 120, maxH: 330, width: [110, 170], windows: 0.0, y: 40 },
  { pitch: 230, parallax: 0.3, minH: 90, maxH: 250, width: [120, 190], windows: 0.35, y: 60 },
  { pitch: 280, parallax: 0.52, minH: 70, maxH: 190, width: [140, 230], windows: 0.6, y: 90 },
];

/**
 * Buildings per strip. The repeat is invisible in practice: the three layers run
 * at different pitches *and* different phases, so the composite city only lines
 * up again after thousands of metres.
 */
const TILES = 16;
/** Head-room above the tallest building for antennas, plus the overhang below
 * the baseline that the original `height + 40` fill created. */
const ANTENNA_ROOM = 90;
const BELOW_BASELINE = 44;

const canvasFor = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
};

export function createBackground() {
  return {
    /** Baked sky bitmap (opaque) — { key, canvas }. */
    sky: null,
    /** Baked star field — { key, canvas, span, height } drawn twice to wrap. */
    stars: null,
    /** One tiled strip per parallax layer, parallel to LAYERS. */
    strips: LAYERS.map(() => null),
    /** How many times a baked layer had to be rebuilt (debug/profiler). */
    bakes: 0,
  };
}

/** Drop every baked layer. Called when the render scale changes. */
export function invalidateBackground(bg) {
  bg.sky = null;
  bg.stars = null;
  for (let i = 0; i < bg.strips.length; i++) bg.strips[i] = null;
}

/**
 * Palette identity for cache keys. Biomes cross-fade over ~90 m of play, so the
 * blend is quantised into six steps: that keeps the cross-fade visible while
 * capping re-bakes to a handful per district instead of one per frame.
 */
function paletteKey(palette) {
  return `${palette.name}|${palette.biomeTo}|${Math.round(palette.t * 6)}`;
}


/* ------------------------------------------------------------------- sky */

function bakeSky(view, palette, q) {
  const s = q.skyScale;
  const w = view.w;
  const h = view.groundScreenY + 2;
  const canvas = canvasFor(w * s, h * s);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(s, 0, 0, s, 0, 0);

  const g = ctx.createLinearGradient(0, 0, 0, view.groundScreenY);
  g.addColorStop(0, palette.sky[0]);
  g.addColorStop(0.55, palette.sky[1]);
  g.addColorStop(1, palette.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Sun / moon disc: baked. The drifting scan bands stay live (they animate).
  const discX = w * 0.74;
  const discY = view.groundScreenY * 0.34;
  const r = 74;
  drawSprite(ctx, radialSprite(palette.sun), discX - r * 4.2, discY - r * 4.2, r * 8.4, r * 8.4, 0.55, false);
  ctx.fillStyle = palette.sun;
  ctx.beginPath();
  ctx.arc(discX, discY, r, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

export function drawSky(bg, ctx, view, palette, time, q) {
  const key = `${paletteKey(palette)}|${view.w}|${view.groundScreenY}|${q.skyScale}`;
  if (!bg.sky || bg.sky.key !== key) {
    bg.sky = { key, canvas: bakeSky(view, palette, q) };
    bg.bakes++;
  }
  ctx.drawImage(bg.sky.canvas, 0, 0, view.w, view.groundScreenY + 2);

  // Bands drift across the disc and are what sells the retro sun. Cheap (a
  // 148 px circle of clip), but still skippable on the low preset.
  if (!q.sunBands) return;
  const discX = view.w * 0.74;
  const discY = view.groundScreenY * 0.34;
  const r = 74;
  ctx.save();
  ctx.beginPath();
  ctx.arc(discX, discY, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = alpha(palette.sky[0], 0.35);
  for (let i = 0; i < 6; i++) {
    const y = discY - r + i * 26 + ((time * 9) % 26);
    ctx.fillRect(discX - r, y, r * 2, 5);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- stars */

const STAR_COUNT = 130;
let starTable = null;

/**
 * Fixed per-star data. Same `rnd()` seeds as before, computed once instead of
 * twelve hashes per star per frame. Per-star parallax is replaced by scrolling
 * the whole baked field (a 4% drift — indistinguishable at this size).
 */
function starsFor(width) {
  if (starTable && starTable.width === width) return starTable.rows;
  const rows = new Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    rows[i] = {
      x: (rnd(i * 3 + 1) * 4000) % width,
      y: rnd(i * 5 + 2),
      size: 0.8 + rnd(i * 11) * 1.7,
      alpha: 0.35 + rnd(i * 13) * 0.65,
      rate: 0.6 + rnd(i) * 1.6,
      phase: i,
    };
  }
  starTable = { width, rows };
  return rows;
}

function bakeStars(view, palette, q) {
  const s = q.bgScale;
  const height = view.groundScreenY * 0.72 + 4;
  const canvas = canvasFor(view.w * s, height * s);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = palette.star;
  const rows = starsFor(view.w);
  for (let i = 0; i < rows.length; i++) {
    const star = rows[i];
    ctx.globalAlpha = star.alpha;
    ctx.beginPath();
    ctx.arc(star.x, star.y * view.groundScreenY * 0.72, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

export function drawStars(bg, ctx, view, palette, time, q) {
  const key = `${palette.star}|${view.w}|${view.groundScreenY}|${q.bgScale}`;
  if (!bg.stars || bg.stars.key !== key) {
    bg.stars = {
      key,
      canvas: bakeStars(view, palette, q),
      span: view.w,
      height: view.groundScreenY * 0.72 + 4,
    };
    bg.bakes++;
  }
  const { canvas, span, height } = bg.stars;
  const scroll = view.camX * 0.04;
  let offset = -(scroll % span);
  if (offset > 0) offset -= span;
  ctx.drawImage(canvas, offset, 0, span, height);
  ctx.drawImage(canvas, offset + span, 0, span, height);

  // A dozen live twinkles keep the field feeling alive without paying for 130
  // `sin()` calls (and 130 hashes) per frame.
  if (!q.starTwinkle) return;
  const rows = starsFor(view.w);
  ctx.fillStyle = palette.star;
  for (let i = 0; i < rows.length; i += 9) {
    const star = rows[i];
    const x = (((star.x - scroll) % span) + span) % span;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(time * star.rate + star.phase));
    ctx.globalAlpha = twinkle * 0.8;
    ctx.fillRect(x - 1, star.y * view.groundScreenY * 0.72 - 1, 2.4, 2.4);
  }
  ctx.globalAlpha = 1;
}

/* -------------------------------------------------------------- skyline */

/**
 * Bake one parallax layer into a tiled strip.
 *
 * The strip is drawn in *layer* space: `x = i * pitch + jitter`, `y = 0` is the
 * layer baseline and buildings grow upwards (the canvas transform is shifted so
 * the baseline sits `BELOW_BASELINE` above the strip's bottom edge).
 *
 * Beacons are collected while baking so the blinking lights can still be drawn
 * live — that is the only part of a building that animates.
 */
function bakeStrip(bg, li, palette, q) {
  const L = LAYERS[li];
  const s = q.bgScale;
  const span = L.pitch * TILES;
  const height = L.maxH + ANTENNA_ROOM + BELOW_BASELINE;
  const canvas = canvasFor(span * s, height * s);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(s, 0, 0, s, 0, (height - BELOW_BASELINE) * s);
  const beacons = [];
  const bodyColor = li === 0 ? palette.far : li === 1 ? palette.mid : palette.near;

  for (let i = 0; i < TILES; i++) {
    const seed = (i + 4096) * 977 + li * 7919;
    const width = L.width[0] + rnd(seed) * (L.width[1] - L.width[0]);
    const bh = L.minH + rnd(seed + 1) * (L.maxH - L.minH);
    const x = i * L.pitch + rnd(seed + 2) * 46 - 20;
    const y = -bh;

    // One flat body colour instead of a per-building linear gradient: at these
    // sizes and alphas the ramp is invisible, and gradients are the single most
    // expensive primitive to rasterise.
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x, y, width, bh + 40);

    // Neon roof edge.
    ctx.fillStyle = alpha(palette.accent, 0.22 + li * 0.12);
    ctx.fillRect(x, y, width, 2);

    // Windows.
    if (L.windows > 0 && bh > 100) {
      const cols = Math.max(1, Math.floor((width - 16) / 24));
      const rows = Math.floor((bh - 30) / 30);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rnd(seed + c * 37 + r * 11) < 0.42) continue;
          const lit = rnd(seed + c * 13 + r * 7 + 5);
          ctx.fillStyle = alpha(lit > 0.75 ? palette.accent2 : palette.accent, 0.16 + lit * 0.5);
          ctx.fillRect(x + 10 + c * 24, y + 16 + r * 30, 10, 14);
        }
      }
    }

    // Rooftop antenna; its beacon is drawn live so it can still blink.
    if (rnd(seed + 3) > 0.72) {
      const ax = x + width * 0.5;
      const ah = 26 + rnd(seed + 4) * 46;
      ctx.fillStyle = alpha(palette.accent, 0.4);
      ctx.fillRect(ax - 1, y - ah, 2, ah);
      beacons.push({ x: ax, y: y - ah, phase: i });
    }
  }

  bg.strips[li] = { key: `${paletteKey(palette)}|${s}`, canvas, span, height, beacons };
  bg.bakes++;
}

export function drawSkyline(bg, ctx, view, palette, time, q) {
  const key = `${paletteKey(palette)}|${q.bgScale}`;
  if (!bg.strips[0] || bg.strips[0].key !== key) {
    for (let li = 0; li < LAYERS.length; li++) bakeStrip(bg, li, palette, q);
  }

  const groundY = view.groundScreenY;
  ctx.save();
  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li];
    const strip = bg.strips[li];
    const baseY = groundY + 12 + li * 30;
    const scroll = view.camX * L.parallax;
    let offset = -(scroll % strip.span);
    if (offset > 0) offset -= strip.span;
    const top = baseY - strip.height + BELOW_BASELINE;
    for (let x = offset; x < view.w; x += strip.span) {
      ctx.drawImage(strip.canvas, x, top, strip.span, strip.height);
    }

    // Beacons for the frontmost layer only — the blinking red dots that make
    // the skyline feel occupied.
    if (li !== LAYERS.length - 1) continue;
    const baseline = top + strip.height - BELOW_BASELINE;
    ctx.fillStyle = '#ff5470';
    for (let i = 0; i < strip.beacons.length; i++) {
      const b = strip.beacons[i];
      const x = b.x - scroll;
      if (x < -20 || x > view.w + 20) continue;
      const blink = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.2 + b.phase));
      ctx.globalAlpha = blink * 0.9;
      ctx.beginPath();
      ctx.arc(x, baseline + b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ----------------------------------------------------- billboards + fog */

export function drawBillboards(bg, ctx, view, palette, time, q) {
  const parallax = 0.62;
  const pitch = 620;
  const scroll = view.camX * parallax;
  const baseY = view.groundScreenY;
  const i0 = Math.floor((scroll - 300) / pitch);
  const i1 = Math.ceil((scroll + view.w + 300) / pitch);

  for (let i = i0; i <= i1; i++) {
    const seed = i * 613 + 17;
    if (rnd(seed) < 0.25) continue;
    const w = 120 + rnd(seed + 1) * 110;
    const h = 54 + rnd(seed + 2) * 46;
    const x = i * pitch - scroll + rnd(seed + 3) * 120;
    const y = baseY - 150 - rnd(seed + 4) * 190;
    const accent = rnd(seed + 5) > 0.5 ? palette.accent : palette.accent2;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(time * 1.4 + i * 0.7));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rnd(seed + 6) - 0.5) * 0.07);
    // Outer glow first (a cached sprite stretched around the frame), then the
    // panel and its crisp rim. Replaces a `shadowBlur` on the stroke.
    drawSprite(ctx, radialSprite(accent), -14, -14, w + 28, h + 28, 0.5 * pulse, true);
    ctx.fillStyle = alpha('#04060f', 0.82);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = alpha(accent, 0.5 * pulse);
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);

    // Fake neon "text" bars.
    const bars = 2 + Math.floor(rnd(seed + 7) * 2);
    for (let b = 0; b < bars; b++) {
      const bw = w * (0.25 + rnd(seed + 8 + b) * 0.55);
      ctx.fillStyle = alpha(accent, 0.35 + rnd(seed + 20 + b) * 0.45 * pulse);
      ctx.fillRect(w * 0.12, 12 + b * (h / (bars + 1)), bw, 7);
    }
    ctx.restore();
  }
}

/** Band definitions are static; the sprites they resolve to are cached. */
const FOG_BANDS = [
  { y: -170, h: 120, a: 0.1 },
  { y: -92, h: 90, a: 0.13 },
  { y: -34, h: 70, a: 0.16 },
];

export function drawFog(bg, ctx, view, palette, time, q) {
  for (let i = 0; i < FOG_BANDS.length; i++) {
    const b = FOG_BANDS[i];
    const y = view.groundScreenY + b.y + Math.sin(time * 0.4 + i) * 8;
    // One cached gradient sprite stretched to the band: no gradient is built,
    // and no shader runs per pixel of it.
    drawSprite(ctx, bandSprite(palette.fog, b.a), 0, y, view.w, b.h, 1, false);
  }
}

/* ---------------------------------------------------------------- floor */

/** Reused scratch buffers — the ground rebuilds its segment list every frame
 * and must not allocate two arrays (and two sorts) to do it. */
const visiblePits = [];
const segments = [0, 0, 0, 0];

/**
 * The floor: neon surface, scrolling circuit grid, distance markers, and the
 * chasms punched out of it by pit hazards.
 */
export function drawGround(bg, ctx, view, palette, state, time, q) {
  const gy = view.groundScreenY;
  const camX = view.camX;
  const depth = view.h - gy;

  // --- floor segments, with pits removed --------------------------------
  visiblePits.length = 0;
  for (let i = 0; i < state.gaps.length; i++) {
    const g = state.gaps[i];
    if (g.x2 > camX - 120 && g.x < camX + VIEW_W + 120) visiblePits.push(g);
  }
  // Hazard groups are generated in ascending x, but sorting a handful of items
  // is far cheaper than trusting it.
  if (visiblePits.length > 1) visiblePits.sort((a, b) => a.x - b.x);

  segments.length = 0;
  let cursorX = camX - 120;
  for (let i = 0; i < visiblePits.length; i++) {
    const g = visiblePits[i];
    if (g.x > cursorX) segments.push(cursorX, g.x);
    cursorX = Math.max(cursorX, g.x2);
  }
  segments.push(cursorX, camX + VIEW_W + 120);

  const ramp = depthSprite(palette.edge, palette.floor);
  const edge = gradientSprite(
    [
      [0, alpha(palette.edge, 0)],
      [0.45, alpha(palette.edge, 0.8)],
      [1, alpha(palette.edge, 0)],
    ],
    { axis: 'y', thickness: 32 },
  );
  const rampH = Math.min(depth, 220) + 4;
  const gridAlpha = alpha(palette.edge, 0.1);

  for (let s = 0; s < segments.length; s += 2) {
    const a = segments[s];
    const b = segments[s + 1];
    const x0 = view.toX(a);
    const w = view.toX(b) - x0;
    if (w <= 0) continue;

    drawSprite(ctx, ramp, x0, gy - 4, w, rampH, 1, false);
    if (depth > rampH - 4) {
      ctx.fillStyle = '#01020a';
      ctx.fillRect(x0, gy + rampH - 4, w, depth - (rampH - 4));
    }

    // Vertical circuit grid, aligned to world x so it scrolls rigidly.
    const step = 96;
    const startK = Math.ceil(a / step) * step;
    ctx.fillStyle = gridAlpha;
    const gridH = Math.min(depth - 8, 150);
    for (let x = startK; x < b; x += step) ctx.fillRect(view.toX(x), gy + 8, 1.5, gridH);

    // Receding horizontal lines.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = alpha(palette.edge, Math.max(0.02, 0.08 - i * 0.018));
      ctx.fillRect(x0, gy + 34 + i * 44, w, 2);
    }

    // Neon surface edge: a stretched glow sprite plus the crisp line.
    drawSprite(ctx, edge, x0, gy - 16, w, 32, 1, true);
    ctx.fillStyle = palette.edge;
    ctx.fillRect(x0, gy - 2, w, 3);
  }

  // --- chasms -----------------------------------------------------------
  const rimL = gradientSprite(
    [
      [0, alpha('#ff3b6b', 0.55)],
      [1, alpha('#ff3b6b', 0)],
    ],
    { axis: 'x' },
  );
  const rimR = gradientSprite(
    [
      [0, alpha('#ff3b6b', 0)],
      [1, alpha('#ff3b6b', 0.55)],
    ],
    { axis: 'x' },
  );

  for (let i = 0; i < visiblePits.length; i++) {
    const g = visiblePits[i];
    const x0 = view.toX(g.x);
    const x1 = view.toX(g.x2);
    const w = x1 - x0;
    if (w <= 0) continue;

    ctx.fillStyle = '#01020a';
    ctx.fillRect(x0, gy - 3, w, depth + 3);

    // Depth stripes.
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = alpha(palette.edge, 0.07 - k * 0.01);
      ctx.fillRect(x0 + 3, gy + 18 + k * 30, w - 6, 1.5);
    }

    // Jagged rim glow (danger).
    drawSprite(ctx, rimL, x0, gy - 6, 30, 8, 1, false);
    drawSprite(ctx, rimR, x1 - 30, gy - 6, 30, 8, 1, false);

    ctx.strokeStyle = alpha('#ff3b6b', 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, gy - 2);
    ctx.lineTo(x0 + 4, gy + 14);
    ctx.moveTo(x1, gy - 2);
    ctx.lineTo(x1 - 4, gy + 14);
    ctx.stroke();
  }

  // --- distance markers every 100 m -------------------------------------
  const PX_PER_M = 42;
  const first = Math.floor((camX - 60) / (100 * PX_PER_M));
  const last = Math.ceil((camX + VIEW_W + 60) / (100 * PX_PER_M));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (let k = Math.max(1, first); k <= last; k++) {
    const worldX = k * 100 * PX_PER_M;
    const x = view.toX(worldX);
    const near = 1 - Math.min(1, Math.abs(camX + VIEW_W * 0.3 - worldX) / 900);
    ctx.fillStyle = alpha(palette.accent2, 0.25 + near * 0.5);
    ctx.fillRect(x - 1, gy - 40, 2, 40);
    ctx.fillRect(x - 16, gy - 44, 32, 4);
    ctx.font = '600 15px "Rajdhani", system-ui, sans-serif';
    ctx.fillText(`${k * 100}m`, x + 8, gy - 48);
    // road chevrons
    ctx.fillStyle = alpha(palette.accent2, 0.16 + near * 0.3);
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 14 + i * 14, gy + 12, 8, 22 - i * 4);
  }
}
