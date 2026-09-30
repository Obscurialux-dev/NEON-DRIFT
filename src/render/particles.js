/**
 * Pooled particle + floating-text effects. Purely presentational: it never feeds
 * back into the simulation, and it uses `Math.random` freely (only the level
 * generator needs to be deterministic).
 */
import { alpha } from './theme.js';
import { radialSprite } from './glow.js';

const TAU = Math.PI * 2;

function makeParticle() {
  return {
    alive: false,
    kind: 'dust',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 1,
    grow: 0,
    rot: 0,
    vr: 0,
    color: '#ffffff',
    gravity: 0,
    drag: 0,
    additive: true,
    fade: 1,
    /** Index inside `fx.active`, or -1 while dead. */
    slot: -1,
  };
}

/**
 * @param {number} max Pool size. This is a ceiling, not a target: the *budget*
 *   (`capacity`) is what the quality preset actually allows to be live, and can
 *   be lowered at runtime without reallocating.
 */
export function createFx(max = 900) {
  const pool = new Array(max);
  for (let i = 0; i < max; i++) pool[i] = makeParticle();
  return {
    pool,
    cursor: 0,
    texts: [],
    trauma: 0,
    /** Live-particle budget (quality preset). */
    capacity: max,
    /**
     * Compact list of the live particles, so update/draw cost is proportional
     * to what is actually on screen instead of to the 900-slot pool.
     */
    active: [],
  };
}

/** How many pool slots a single spawn may examine before giving up. */
const SPAWN_SCAN = 24;

export function spawn(fx, props) {
  const pool = fx.pool;
  const active = fx.active;
  const budgetLeft = active.length < fx.capacity;
  let p = null;
  // Walk from the ring cursor looking for a slot we are allowed to take. Under
  // budget that is a free slot; at budget it has to be a live one (recycling the
  // oldest particle rather than growing the live set).
  for (let i = 0; i < SPAWN_SCAN; i++) {
    const candidate = pool[(fx.cursor + i) % pool.length];
    const usable = budgetLeft ? !candidate.alive : candidate.alive;
    if (usable) {
      p = candidate;
      fx.cursor = (fx.cursor + i + 1) % pool.length;
      break;
    }
  }
  if (!p) return null;
  Object.assign(p, props);
  p.alive = true;
  p.life = props.maxLife ?? props.life ?? 0.5;
  p.maxLife = p.life;
  if (p.slot < 0) {
    p.slot = active.length;
    active.push(p);
  }
  return p;
}

export function burst(fx, x, y, count, opts = {}) {
  const {
    speed = 180,
    spread = TAU,
    angle = 0,
    kind = 'spark',
    color = '#ffffff',
    maxLife = 0.5,
    size = 3,
    gravity = 0,
    drag = 2,
    grow = 0,
    vy: extraVy = 0,
  } = opts;
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const s = speed * (0.45 + Math.random() * 0.85);
    spawn(fx, {
      kind,
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s + extraVy,
      maxLife: maxLife * (0.6 + Math.random() * 0.8),
      size: size * (0.6 + Math.random() * 0.9),
      color,
      gravity,
      drag,
      grow,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 14,
      additive: true,
    });
  }
}

export function ring(fx, x, y, opts = {}) {
  const { color = '#ffffff', size = 12, maxLife = 0.4, grow = 420 } = opts;
  return spawn(fx, {
    kind: 'ring',
    x,
    y,
    vx: 0,
    vy: 0,
    size,
    grow,
    maxLife,
    color,
    additive: true,
    gravity: 0,
    drag: 0,
  });
}

export function floatText(fx, text, x, y, opts = {}) {
  const { color = '#fff', size = 22, maxLife = 0.9, vy = -70, weight = 800 } = opts;
  fx.texts.push({ text, x, y, vy, life: maxLife, maxLife, color, size, weight });
  if (fx.texts.length > 48) fx.texts.shift();
}


/** Number of live particles — used by the debug overlay and perf harness. */
export function liveCount(fx) {
  return fx.active.length;
}

export function updateFx(fx, dt) {
  const active = fx.active;
  for (let i = 0; i < active.length; i++) {
    const p = active[i];
    p.life -= dt;
    if (p.life <= 0 || !p.alive) {
      p.alive = false;
      p.slot = -1;
      // Swap-remove: keeps the list compact so the loop never visits dead slots.
      const last = active.pop();
      if (last !== p) {
        last.slot = i;
        active[i] = last;
        i--;
      }
      continue;
    }
    p.vy += p.gravity * dt;
    if (p.drag) {
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.grow) p.size += p.grow * dt;
  }

  for (let i = fx.texts.length - 1; i >= 0; i--) {
    const t = fx.texts[i];
    t.life -= dt;
    t.y += t.vy * dt;
    t.vy *= Math.max(0, 1 - 1.6 * dt);
    if (t.life <= 0) fx.texts.splice(i, 1);
  }
  fx.trauma = Math.max(0, fx.trauma - dt * 2.2);
}

/**
 * Draw every live particle. `toX`/`toY` convert world space to screen space, so
 * effects follow the camera exactly. Only the compact `active` list is walked.
 */
export function drawFx(ctx, fx, toX, toY) {
  const active = fx.active;
  if (!active.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < active.length; i++) {
    const p = active[i];
    const t = p.life / p.maxLife;
    const a = Math.min(1, t * p.fade) * (p.kind === 'smoke' ? 0.32 : 1);
    const x = toX(p.x);
    const y = toY(p.y);
    ctx.globalAlpha = a;

    switch (p.kind) {
      case 'spark': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx * 0.02, y - p.vy * 0.02);
        ctx.stroke();
        break;
      }
      case 'ring': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.2, 4 * t);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, p.size), 0, TAU);
        ctx.stroke();
        break;
      }
      case 'shard': {
        // Rotated quad drawn as an explicit path: no per-particle transform
        // (and no save/restore) in the hot loop.
        const dx = Math.cos(p.rot) * p.size;
        const dy = Math.sin(p.rot) * p.size;
        const ex = -dy * 0.4;
        const ey = dx * 0.4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(x - dx - ex, y - dy - ey);
        ctx.lineTo(x + dx - ex, y + dy - ey);
        ctx.lineTo(x + dx + ex, y + dy + ey);
        ctx.lineTo(x - dx + ex, y - dy + ey);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'star': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * 0.35);
        const s = p.size * (1 + (1 - t) * 0.6);
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.lineTo(x + s, y);
        ctx.moveTo(x, y - s);
        ctx.lineTo(x, y + s);
        ctx.stroke();
        break;
      }
      case 'glow': {
        // A cached sprite instead of a radial gradient per particle per frame.
        const r = Math.max(2, p.size);
        ctx.drawImage(radialSprite(p.color), x - r, y - r, r * 2, r * 2);
        break;
      }
      case 'smoke': {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, p.size), 0, TAU);
        ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size), 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawTexts(ctx, fx, toX, toY) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of fx.texts) {
    const k = t.life / t.maxLife;
    const pop = k > 0.82 ? 1 + (1 - (k - 0.82) / 0.18) * 0.32 : 1;
    ctx.globalAlpha = Math.min(1, k * 2.2);
    ctx.font = `${t.weight} ${t.size * pop}px "Rajdhani", "Segoe UI", system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(2,4,12,0.85)';
    ctx.strokeText(t.text, toX(t.x), toY(t.y));
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, toX(t.x), toY(t.y));
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
