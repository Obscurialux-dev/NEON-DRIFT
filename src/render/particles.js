/**
 * Pooled particle + floating-text effects. Purely presentational: it never feeds
 * back into the simulation, and it uses `Math.random` freely (only the level
 * generator needs to be deterministic).
 */
import { alpha } from './theme.js';

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
  };
}

export function createFx(max = 900) {
  const pool = new Array(max);
  for (let i = 0; i < max; i++) pool[i] = makeParticle();
  return { pool, cursor: 0, texts: [], trauma: 0 };
}

export function spawn(fx, props) {
  const pool = fx.pool;
  const p = pool[fx.cursor];
  fx.cursor = (fx.cursor + 1) % pool.length;
  Object.assign(p, props);
  p.alive = true;
  p.life = props.maxLife ?? props.life ?? 0.5;
  p.maxLife = p.life;
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


export function updateFx(fx, dt) {
  const pool = fx.pool;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
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
 * effects follow the camera exactly.
 */
export function drawFx(ctx, fx, toX, toY) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < fx.pool.length; i++) {
    const p = fx.pool[i];
    if (!p.alive) continue;
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
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.restore();
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
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(2, p.size));
        g.addColorStop(0, alpha(p.color, 0.9));
        g.addColorStop(0.5, alpha(p.color, 0.3));
        g.addColorStop(1, alpha(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, p.size), 0, TAU);
        ctx.fill();
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
