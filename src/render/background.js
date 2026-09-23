/**
 * Parallax environment: sky, stars, moon, procedural neon skyline, fog bands and
 * the (pit-broken) floor. Each layer is generated on the fly from an index hash,
 * so the city never repeats exactly and nothing has to be stored.
 */
import { GROUND_Y, VIEW_W } from '../config.js';
import { alpha } from './theme.js';

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

export function createBackground() {
  return { stars: null, lastBiome: -1 };
}

/* ------------------------------------------------------------------- sky */

export function drawSky(ctx, view, palette, time) {
  const g = ctx.createLinearGradient(0, 0, 0, view.groundScreenY);
  g.addColorStop(0, palette.sky[0]);
  g.addColorStop(0.55, palette.sky[1]);
  g.addColorStop(1, palette.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.groundScreenY + 2);

  // Sun / moon disc.
  const discX = view.w * 0.74;
  const discY = view.groundScreenY * 0.34;
  const r = 74;
  const glow = ctx.createRadialGradient(discX, discY, 0, discX, discY, r * 4.2);
  glow.addColorStop(0, alpha(palette.sun, 0.55));
  glow.addColorStop(0.35, alpha(palette.sunGlow, 0.18));
  glow.addColorStop(1, alpha(palette.sunGlow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(discX, discY, r * 4.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.sun;
  ctx.beginPath();
  ctx.arc(discX, discY, r, 0, Math.PI * 2);
  ctx.fill();

  // Scan bands across the disc for a retro feel.
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

export function drawStars(ctx, view, palette, time) {
  const count = 130;
  const scroll = view.camX * 0.04;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const sx = (rnd(i * 3 + 1) * 4000 - scroll * (0.6 + rnd(i * 7) * 0.8)) % view.w;
    const x = sx < 0 ? sx + view.w : sx;
    const y = rnd(i * 5 + 2) * view.groundScreenY * 0.72;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(time * (0.6 + rnd(i) * 1.6) + i));
    const size = 0.8 + rnd(i * 11) * 1.7;
    ctx.globalAlpha = twinkle * (0.35 + rnd(i * 13) * 0.65);
    ctx.fillStyle = palette.star;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}


/* -------------------------------------------------------------- skyline */

export function drawSkyline(ctx, view, palette, time) {
  const groundY = view.groundScreenY;
  ctx.save();

  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li];
    const scroll = view.camX * L.parallax;
    const baseY = groundY + 12 + li * 30;
    const i0 = Math.floor((scroll - 240) / L.pitch);
    const i1 = Math.ceil((scroll + view.w + 240) / L.pitch);
    const bodyColor = li === 0 ? palette.far : li === 1 ? palette.mid : palette.near;

    for (let i = i0; i <= i1; i++) {
      const seed = (i + 4096) * 977 + li * 7919;
      const width = L.width[0] + rnd(seed) * (L.width[1] - L.width[0]);
      const height = L.minH + rnd(seed + 1) * (L.maxH - L.minH);
      const x = i * L.pitch - scroll + rnd(seed + 2) * 46 - 20;
      const y = baseY - height;

      const g = ctx.createLinearGradient(0, y, 0, baseY);
      g.addColorStop(0, bodyColor);
      g.addColorStop(1, alpha(bodyColor, 0.55));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, width, height + 40);

      // Neon roof edge.
      ctx.fillStyle = alpha(palette.accent, 0.22 + li * 0.12);
      ctx.fillRect(x, y, width, 2);

      // Windows.
      if (L.windows > 0 && height > 100) {
        const cols = Math.max(1, Math.floor((width - 16) / 24));
        const rows = Math.floor((height - 30) / 30);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (rnd(seed + c * 37 + r * 11) < 0.42) continue;
            const lit = rnd(seed + c * 13 + r * 7 + 5);
            ctx.fillStyle = alpha(lit > 0.75 ? palette.accent2 : palette.accent, 0.16 + lit * 0.5);
            ctx.fillRect(x + 10 + c * 24, y + 16 + r * 30, 10, 14);
          }
        }
      }

      // Rooftop antenna with a blinking beacon.
      if (rnd(seed + 3) > 0.72) {
        const ax = x + width * 0.5;
        const ah = 26 + rnd(seed + 4) * 46;
        ctx.fillStyle = alpha(palette.accent, 0.4);
        ctx.fillRect(ax - 1, y - ah, 2, ah);
        const blink = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.2 + i));
        ctx.fillStyle = alpha('#ff5470', blink * 0.9);
        ctx.beginPath();
        ctx.arc(ax, y - ah, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* ----------------------------------------------------- billboards + fog */

export function drawBillboards(ctx, view, palette, time) {
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
    ctx.fillStyle = alpha('#04060f', 0.82);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = alpha(accent, 0.5 * pulse);
    ctx.lineWidth = 2;
    ctx.shadowColor = alpha(accent, 0.9);
    ctx.shadowBlur = 16;
    ctx.strokeRect(0, 0, w, h);
    ctx.shadowBlur = 0;

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

export function drawFog(ctx, view, palette, time) {
  const bands = [
    { y: -170, h: 120, a: 0.1 },
    { y: -92, h: 90, a: 0.13 },
    { y: -34, h: 70, a: 0.16 },
  ];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const y = view.groundScreenY + b.y + Math.sin(time * 0.4 + i) * 8;
    const g = ctx.createLinearGradient(0, y, 0, y + b.h);
    g.addColorStop(0, alpha(palette.fog, 0));
    g.addColorStop(0.5, alpha(palette.fog, b.a));
    g.addColorStop(1, alpha(palette.fog, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y, view.w, b.h);
  }
}

/* ---------------------------------------------------------------- floor */

/**
 * The floor: neon surface, scrolling circuit grid, distance markers, and the
 * chasms punched out of it by pit hazards.
 */
export function drawGround(ctx, view, palette, state, time) {
  const gy = view.groundScreenY;
  const camX = view.camX;
  const depth = view.h - gy;

  // --- floor segments, with pits removed --------------------------------
  const pits = state.gaps
    .filter((g) => g.x2 > camX - 120 && g.x < camX + VIEW_W + 120)
    .sort((a, b) => a.x - b.x);

  const segments = [];
  let cursorX = camX - 120;
  for (const g of pits) {
    if (g.x > cursorX) segments.push([cursorX, g.x]);
    cursorX = Math.max(cursorX, g.x2);
  }
  segments.push([cursorX, camX + VIEW_W + 120]);

  for (const [a, b] of segments) {
    const x0 = view.toX(a);
    const x1 = view.toX(b);
    const w = x1 - x0;
    if (w <= 0) continue;

    const grad = ctx.createLinearGradient(0, gy - 4, 0, gy + Math.min(depth, 220));
    grad.addColorStop(0, alpha(palette.edge, 0.16));
    grad.addColorStop(0.12, palette.floor);
    grad.addColorStop(1, '#01020a');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, gy, w, depth);

    // Vertical circuit grid, aligned to world x so it scrolls rigidly.
    const step = 96;
    const startK = Math.ceil(a / step) * step;
    ctx.fillStyle = alpha(palette.edge, 0.1);
    for (let x = startK; x < b; x += step) {
      ctx.fillRect(view.toX(x), gy + 8, 1.5, Math.min(depth - 8, 150));
    }

    // Receding horizontal lines.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = alpha(palette.edge, Math.max(0.02, 0.08 - i * 0.018));
      ctx.fillRect(x0, gy + 34 + i * 44, w, 2);
    }

    // Neon surface edge.
    ctx.shadowColor = palette.edge;
    ctx.shadowBlur = 16;
    ctx.fillStyle = palette.edge;
    ctx.fillRect(x0, gy - 2, w, 3);
    ctx.shadowBlur = 0;
  }

  // --- chasms -----------------------------------------------------------
  for (const g of pits) {
    const x0 = view.toX(g.x);
    const x1 = view.toX(g.x2);
    const w = x1 - x0;
    if (w <= 0) continue;

    ctx.fillStyle = '#01020a';
    ctx.fillRect(x0, gy - 3, w, depth + 3);

    // Depth stripes.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = alpha(palette.edge, 0.07 - i * 0.01);
      ctx.fillRect(x0 + 3, gy + 18 + i * 30, w - 6, 1.5);
    }

    // Jagged rim glow (danger).
    const rim = ctx.createLinearGradient(x0, gy, x0 + 30, gy);
    rim.addColorStop(0, alpha('#ff3b6b', 0.55));
    rim.addColorStop(1, alpha('#ff3b6b', 0));
    ctx.fillStyle = rim;
    ctx.fillRect(x0, gy - 6, 30, 8);
    const rim2 = ctx.createLinearGradient(x1, gy, x1 - 30, gy);
    rim2.addColorStop(0, alpha('#ff3b6b', 0.55));
    rim2.addColorStop(1, alpha('#ff3b6b', 0));
    ctx.fillStyle = rim2;
    ctx.fillRect(x1 - 30, gy - 6, 30, 8);

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
    const near = 1 - Math.min(1, Math.abs((camX + VIEW_W * 0.3) - worldX) / 900);
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
