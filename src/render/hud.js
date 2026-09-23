/**
 * Canvas HUD: score, distance, coins, multiplier, power-up timers, velocity
 * meter, district name and the opening control hint.
 */
import { PICKUP_KIND, POWERUPS, SCORE, SPEED } from '../config.js';
import { clamp01 } from '../core/math.js';
import { alpha } from './theme.js';

const FONT = '"Rajdhani", "Chakra Petch", system-ui, sans-serif';

function neonText(ctx, text, x, y, opts = {}) {
  const {
    size = 28,
    weight = 700,
    color = '#eafcff',
    glow = '#4de2ff',
    align = 'left',
    glowSize = 14,
    tracking = 0,
    alpha: a = 1,
  } = opts;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (tracking) ctx.letterSpacing = `${tracking}px`;
  ctx.shadowColor = alpha(glow, 0.9);
  ctx.shadowBlur = glowSize;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(2,6,16,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function chip(ctx, x, y, w, h, color, frac) {
  ctx.save();
  ctx.fillStyle = alpha('#03060f', 0.72);
  ctx.strokeStyle = alpha(color, 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  if (frac !== undefined) {
    ctx.fillStyle = alpha(color, 0.35);
    ctx.beginPath();
    ctx.roundRect(x + 2, y + h - 5, Math.max(0, (w - 4) * frac), 3, 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawHud(ctx, view, state, opts = {}) {
  const {
    time = 0,
    best = 0,
    musicOn = true,
    district = '',
    districtFlash = 0,
    hint = 0,
  } = opts;

  const pad = 26;
  ctx.save();

  // --- score / distance --------------------------------------------------
  neonText(ctx, state.score.toLocaleString('en-US'), pad, pad + 44, {
    size: 44,
    weight: 700,
    color: '#ffffff',
    glow: '#4de2ff',
    glowSize: 18,
  });
  neonText(ctx, `${Math.max(0, Math.floor(state.metres)).toLocaleString('en-US')} m`, pad + 2, pad + 76, {
    size: 24,
    weight: 600,
    color: '#9fe6ff',
    glow: '#2b8bff',
    glowSize: 8,
  });

  // --- best (right) ------------------------------------------------------
  neonText(ctx, 'BEST', view.w - pad, pad + 18, {
    size: 14,
    weight: 700,
    color: '#7ba7c9',
    glow: '#2b8bff',
    glowSize: 4,
    align: 'right',
    tracking: 3,
  });
  neonText(ctx, `${Math.max(best, state.score).toLocaleString('en-US')}`, view.w - pad, pad + 48, {
    size: 30,
    weight: 700,
    color: '#ffd166',
    glow: '#ff9d3d',
    glowSize: 12,
    align: 'right',
  });

  // --- coins + multiplier ------------------------------------------------
  const coinY = pad + 104;
  ctx.fillStyle = '#ffcf5c';
  ctx.shadowColor = alpha('#ffd166', 0.8);
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(pad + 11, coinY - 7, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  neonText(ctx, `x ${state.coins}`, pad + 28, coinY, {
    size: 24,
    weight: 700,
    color: '#ffe9b0',
    glow: '#ff9d3d',
    glowSize: 6,
  });

  // --- multiplier chip: always visible, dim while it is only x1 -----------
  const mult = state.multiplier;
  const hot = mult > 1;
  const pulse = hot ? 1 + 0.12 * Math.sin(time * 9) : 1;
  ctx.save();
  ctx.translate(pad + 172, coinY - 10);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = alpha('#ffd166', hot ? 0.16 : 0.07);
  ctx.strokeStyle = alpha('#ffd166', hot ? 0.9 : 0.4);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-34, -18, 68, 36, 8);
  ctx.fill();
  ctx.stroke();
  neonText(ctx, `x${mult}`, 0, 8, {
    size: 24,
    weight: 700,
    color: hot ? '#fff6d6' : '#cdbd97',
    glow: '#ffd166',
    glowSize: hot ? 12 : 5,
    align: 'center',
  });
  ctx.restore();

  // --- tier ladder: one tick per earned multiplier tier -------------------
  // Always on screen, because the chain doubles as the wallet that charge pads
  // charge in: the player has to be able to read what they can afford.
  const segW = 24;
  const segGap = 4;
  for (let i = 0; i < SCORE.chainMax; i++) {
    const need = (i + 1) * SCORE.chainStep;
    const frac = clamp01(state.chain / need);
    const sx = pad + i * (segW + segGap);
    ctx.fillStyle = alpha('#ffd166', 0.2);
    ctx.beginPath();
    ctx.roundRect(sx, coinY + 12, segW, 5, 2.5);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = alpha('#ffd166', 0.9);
      ctx.beginPath();
      ctx.roundRect(sx, coinY + 12, segW * frac, 5, 2.5);
      ctx.fill();
    }
  }

  // --- the wallet itself, in the same currency the pads quote -------------
  ctx.fillStyle = alpha('#ffd166', 0.92);
  ctx.beginPath();
  ctx.moveTo(pad + 8, coinY + 26);
  ctx.lineTo(pad + 14, coinY + 32);
  ctx.lineTo(pad + 8, coinY + 38);
  ctx.lineTo(pad + 2, coinY + 32);
  ctx.closePath();
  ctx.fill();
  neonText(ctx, `${state.chain}`, pad + 22, coinY + 38, {
    size: 17,
    weight: 700,
    color: '#ffe9b0',
    glow: '#ff9d3d',
    glowSize: 5,
  });

  drawPowerupChips(ctx, view, state, pad);
  drawVelocity(ctx, view, pad, state);
  drawDistrict(ctx, view, pad, district, districtFlash);

  if (hint > 0) {
    const a = clamp01(hint);
    const mid = view.w * 0.5;
    neonText(ctx, 'SPACE / ↑  JUMP', mid - 14, view.groundScreenY - 190, {
      size: 26,
      weight: 700,
      color: '#eafcff',
      glow: '#4de2ff',
      glowSize: 10,
      align: 'right',
      alpha: a,
    });
    neonText(ctx, '↓  SLIDE', mid + 14, view.groundScreenY - 190, {
      size: 26,
      weight: 700,
      color: '#eafcff',
      glow: '#4de2ff',
      glowSize: 10,
      align: 'left',
      alpha: a,
    });
    neonText(ctx, 'TAP JUMP AGAIN MID-AIR FOR A DOUBLE JUMP', mid, view.groundScreenY - 152, {
      size: 15,
      weight: 600,
      color: '#9fe6ff',
      glow: '#2b8bff',
      glowSize: 4,
      align: 'center',
      alpha: a * 0.9,
      tracking: 1,
    });
  }

  if (!musicOn) {
    neonText(ctx, '♪ MUTED  ·  M TO UNMUTE', pad, view.h - pad, {
      size: 15,
      weight: 600,
      color: '#7ba7c9',
      glow: '#2b8bff',
      glowSize: 3,
      tracking: 2,
    });
  }

  ctx.restore();
}

/** Power-up timer chips, stacked down the right-hand side. */
function drawPowerupChips(ctx, view, state, pad) {
  const active = Object.keys(POWERUPS).filter((k) => state.powerups[k].active);
  active.forEach((kind, i) => {
    const p = state.powerups[kind];
    const w = 150;
    const h = 34;
    const x = view.w - pad - w;
    const y = pad + 72 + i * (h + 8);
    chip(ctx, x, y, w, h, POWERUPS[kind].color, clamp01(p.timer / p.duration));
    neonText(ctx, POWERUPS[kind].label, x + 12, y + 23, {
      size: 18,
      weight: 700,
      color: '#ffffff',
      glow: POWERUPS[kind].color,
      glowSize: 8,
      tracking: 1,
    });
    neonText(ctx, `${p.timer.toFixed(1)}`, x + w - 12, y + 23, {
      size: 17,
      weight: 600,
      color: '#dff6ff',
      glow: POWERUPS[kind].color,
      glowSize: 4,
      align: 'right',
    });
    if (kind === PICKUP_KIND.SHIELD && p.charges > 0) {
      ctx.fillStyle = alpha(POWERUPS.shield.color, 0.95);
      ctx.beginPath();
      ctx.arc(x + w - 54, y + 17, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Speed meter in the bottom-right corner. */
function drawVelocity(ctx, view, pad, state) {
  const frac = clamp01((state.speed - SPEED.start) / (SPEED.max * 1.3 - SPEED.start));
  const w = 190;
  const x = view.w - pad - w;
  const y = view.h - pad - 14;
  ctx.fillStyle = alpha('#031024', 0.75);
  ctx.beginPath();
  ctx.roundRect(x, y, w, 10, 5);
  ctx.fill();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#4de2ff');
  g.addColorStop(0.6, '#ffd166');
  g.addColorStop(1, '#ff4d6d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, Math.max(4, (w - 2) * frac), 8, 4);
  ctx.fill();
  neonText(ctx, 'VELOCITY', x - 12, y + 10, {
    size: 14,
    weight: 700,
    color: '#7ba7c9',
    glow: '#2b8bff',
    glowSize: 3,
    align: 'right',
    tracking: 2,
  });
}

/** District name banner, flashed when a new district starts. */
function drawDistrict(ctx, view, pad, district, flash) {
  if (!district || flash <= 0) return;
  const a = Math.min(1, flash * 2);
  neonText(ctx, district, view.w * 0.5, pad + 40, {
    size: 30,
    weight: 700,
    color: '#ffffff',
    glow: '#a86bff',
    glowSize: 18,
    align: 'center',
    tracking: 6,
    alpha: a,
  });
  ctx.fillStyle = alpha('#a86bff', a * 0.6);
  ctx.fillRect(view.w * 0.5 - 90, pad + 50, 180, 2);
}

