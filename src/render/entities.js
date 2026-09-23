/**
 * Entity rendering: the runner, hazards and pickups.
 *
 * Everything is drawn procedurally (no image assets) with a neon/cyberpunk look:
 * dark bodies, bright emissive rims, additive glows. Hazards brighten as they get
 * close, which is what keeps a 1180 px/s run readable.
 */
import { PAD, PICKUP_KIND } from '../config.js';
import { clamp, clamp01, TAU } from '../core/math.js';
import { alpha } from './theme.js';

const BODY = '#e7fbff';
const SCARF = '#ffb03a';

/** How "hot" a hazard is — 0 far away, 1 when it is on top of the player. */
export function urgency(h, playerX, speed) {
  const look = Math.max(240, speed * 0.8);
  return clamp01(1 - (h.x - playerX) / look);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ----------------------------------------------------------------- player */

export function drawPlayer(ctx, view, state, player, opts = {}) {
  const { palette, time, trail = [], fade = 1 } = opts;
  const screenX = view.toX(player.x);
  const screenY = view.toY(player.renderY ?? player.y);
  const speed = state.speed;

  const overdrive = state.powerups.overdrive.active;
  const shield = state.powerups.shield.active && state.powerups.shield.charges > 0;
  const magnet = state.powerups.magnet.active;
  const blink = player.invuln > 0;
  const bodyAlpha = blink ? 0.45 + 0.55 * Math.abs(Math.sin(time * 26)) : 1;

  ctx.save();
  ctx.globalAlpha = fade;

  // --- afterimage trail --------------------------------------------------
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const k = (i + 1) / trail.length;
    ctx.globalAlpha = fade * k * k * (overdrive ? 0.32 : 0.2);
    const th = t.sliding ? 30 : 58;
    ctx.fillStyle = overdrive ? '#ff5d8f' : palette.accent;
    ctx.fillRect(view.toX(t.x) - 15, view.toY(t.y) - th, 30, th);
  }
  ctx.globalAlpha = fade * bodyAlpha;

  // --- aura --------------------------------------------------------------
  if (overdrive || shield || magnet) {
    const color = overdrive ? '#ff5d8f' : shield ? '#66e0ff' : '#c084fc';
    const radius = player.sliding ? 54 : 74;
    const g = ctx.createRadialGradient(screenX, screenY - 30, 4, screenX, screenY - 30, radius);
    g.addColorStop(0, alpha(color, 0.4));
    g.addColorStop(0.6, alpha(color, 0.12));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 30, radius, 0, TAU);
    ctx.fill();
  }

  ctx.translate(screenX, screenY);
  // Squash & stretch, double-jump spin, and the lying-down slide pose.
  ctx.scale(
    1 - player.jumpFx * 0.1 + player.landFx * 0.14,
    1 + player.jumpFx * 0.2 - player.landFx * 0.16,
  );
  if (player.spin > 0) ctx.rotate(-player.spin * TAU * 0.9);
  if (player.sliding) ctx.rotate(-Math.PI * 0.42);

  const h = player.sliding ? 34 : 64;
  const w = player.sliding ? 54 : 44;
  const airborne = !player.onGround;
  const rise = clamp(-player.vy / 900, -1, 1);
  const phase = player.runPhase;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = overdrive ? '#ff5d8f' : palette.accent;
  ctx.shadowBlur = 14;

  const legSwing = airborne ? 0.55 : Math.sin(phase) * 0.85;
  const legLift = airborne ? 0.7 : Math.max(0, Math.cos(phase)) * 0.55;
  const armSwing = airborne ? -0.9 : Math.sin(phase + Math.PI) * 0.8;
  const hipY = -h * 0.46;
  const shoulderY = -h * 0.74;

  // --- legs --------------------------------------------------------------
  const drawLeg = (swing, lift, shade) => {
    ctx.strokeStyle = shade;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(swing * 10, hipY + 14 - lift * 10);
    ctx.lineTo(swing * 20, lift * 12 - (airborne ? 8 : 0));
    ctx.stroke();
  };
  drawLeg(-legSwing, legLift * 0.6, '#8fd8ff');
  drawLeg(legSwing, legLift, BODY);

  // --- torso -------------------------------------------------------------
  const torsoTop = shoulderY - 2;
  const torsoBottom = hipY + 6;
  ctx.fillStyle = overdrive ? '#2a0a18' : '#0b1b2c';
  ctx.strokeStyle = overdrive ? '#ff8bb0' : palette.accent;
  ctx.lineWidth = 3;
  roundRect(ctx, -(w * 0.3), torsoTop, w * 0.6, torsoBottom - torsoTop, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = overdrive ? '#ffd7e4' : '#9ef3ff';
  ctx.beginPath();
  ctx.arc(2, hipY - 12, 3.6, 0, TAU);
  ctx.fill();


  // --- arms --------------------------------------------------------------
  const drawArm = (swing, shade) => {
    ctx.strokeStyle = shade;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(2, shoulderY + 4);
    ctx.lineTo(2 + swing * 12, shoulderY + 18);
    ctx.lineTo(2 + swing * 20, shoulderY + 30 + (airborne ? -rise * 10 : 0));
    ctx.stroke();
  };
  drawArm(-armSwing, '#9fe6ff');
  drawArm(armSwing, BODY);

  // --- head + visor ------------------------------------------------------
  ctx.fillStyle = '#0d2136';
  ctx.strokeStyle = overdrive ? '#ff8bb0' : palette.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(2, shoulderY - 12, 11, 0, TAU);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = overdrive ? '#fff1f6' : '#7ff0ff';
  ctx.fillRect(4, shoulderY - 16, 9, 5);

  // --- scarf -------------------------------------------------------------
  ctx.strokeStyle = overdrive ? '#ffd166' : SCARF;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-2, shoulderY - 6);
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    ctx.lineTo(
      -6 - t * (26 + Math.min(34, speed * 0.045)),
      shoulderY - 4 + Math.sin(time * 12 - i * 1.1) * 6 * t + t * 4,
    );
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();

  // --- power-up overlays (screen space, un-rotated) ----------------------
  ctx.save();
  ctx.globalAlpha = fade;
  if (shield) {
    const r = 46;
    ctx.strokeStyle = alpha('#66e0ff', 0.75);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 32, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = alpha('#e8ffff', 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = time * 1.4 + (i / 6) * TAU;
      const x = screenX + Math.cos(a) * r;
      const y = screenY - 32 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  if (magnet) {
    ctx.strokeStyle = alpha('#c084fc', 0.55);
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(screenX, screenY - 30, 62, 22, time * 2.4 + i * Math.PI, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}


/* --------------------------------------------------------------- hazards */

const HAZARD_HOT = '#ff4d6d';
const HAZARD_COLD = '#8a2140';

export function drawHazards(ctx, view, state, time) {
  const px = state.player.x;
  const speed = state.speed;
  ctx.save();
  ctx.lineJoin = 'round';

  for (const h of state.hazards) {
    if (h.dead) continue;
    const x0 = view.toX(h.x);
    const x1 = view.toX(h.x2);
    if (x1 < -80 || x0 > view.w + 80) continue;
    const y0 = view.toY(h.y);
    const y1 = view.toY(h.y + h.h);
    const u = urgency(h, px, speed);
    const hot = u > 0.72;
    const rim = hot ? HAZARD_HOT : HAZARD_COLD;
    const pulse = hot ? 0.65 + 0.35 * Math.sin(time * 22) : 1;

    if (h.kind === 'spike') {
      const w = x1 - x0;
      ctx.fillStyle = '#1a0a14';
      ctx.strokeStyle = alpha(rim, 0.85 * pulse);
      ctx.lineWidth = 2.5;
      ctx.shadowColor = alpha(HAZARD_HOT, hot ? 0.9 : 0.4);
      ctx.shadowBlur = hot ? 20 : 8;
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      ctx.lineTo(x0 + w * 0.5, y0);
      ctx.lineTo(x1, y1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = alpha('#ffd166', 0.5 * pulse);
      ctx.fillRect(x0, y1 - 5, w, 5);
    } else if (h.kind === 'crate') {
      ctx.fillStyle = '#12182b';
      ctx.strokeStyle = alpha(rim, 0.8 * pulse);
      ctx.lineWidth = 3;
      ctx.shadowColor = alpha(HAZARD_HOT, hot ? 0.8 : 0.3);
      ctx.shadowBlur = hot ? 16 : 6;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = alpha(rim, 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 + 4, y0 + 4);
      ctx.lineTo(x1 - 4, y1 - 4);
      ctx.moveTo(x1 - 4, y0 + 4);
      ctx.lineTo(x0 + 4, y1 - 4);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, Math.min(15, y1 - y0));
      ctx.clip();
      ctx.fillStyle = alpha('#ffd166', 0.6 * pulse);
      for (let sx = x0 - 20; sx < x1 + 20; sx += 16) {
        ctx.beginPath();
        ctx.moveTo(sx, y1);
        ctx.lineTo(sx + 8, y0);
        ctx.lineTo(sx + 14, y0);
        ctx.lineTo(sx + 6, y1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (h.kind === 'overhang') {
      const top = view.toY(h.y);
      const bottom = view.toY(h.y + h.h);
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, '#0a0f1e');
      g.addColorStop(1, '#160b1a');
      ctx.fillStyle = g;
      ctx.fillRect(x0, top - 80, x1 - x0, bottom - top + 80);
      ctx.shadowColor = alpha(HAZARD_HOT, hot ? 0.9 : 0.35);
      ctx.shadowBlur = hot ? 22 : 8;
      ctx.fillStyle = alpha(rim, 0.9 * pulse);
      ctx.fillRect(x0, bottom - 4, x1 - x0, 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = alpha('#ffd166', 0.3 * pulse);
      for (let sx = x0; sx < x1 - 12; sx += 26) {
        ctx.beginPath();
        ctx.moveTo(sx, bottom - 8);
        ctx.lineTo(sx + 13, bottom - 8);
        ctx.lineTo(sx + 6, bottom - 20);
        ctx.closePath();
        ctx.fill();
      }
    } else if (h.kind === 'drone') {
      const cx = (x0 + x1) * 0.5;
      const cy = (y0 + y1) * 0.5;
      const w = x1 - x0;
      const beam = ctx.createLinearGradient(cx, cy, cx, view.groundScreenY);
      beam.addColorStop(0, alpha(HAZARD_HOT, 0.26 * (0.6 + 0.4 * pulse)));
      beam.addColorStop(1, alpha(HAZARD_HOT, 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.3, y1);
      ctx.lineTo(cx + w * 0.3, y1);
      ctx.lineTo(cx + w * 0.75, view.groundScreenY);
      ctx.lineTo(cx - w * 0.75, view.groundScreenY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#12172b';
      ctx.strokeStyle = alpha(rim, 0.85 * pulse);
      ctx.lineWidth = 3;
      ctx.shadowColor = alpha(HAZARD_HOT, hot ? 0.9 : 0.4);
      ctx.shadowBlur = hot ? 20 : 8;
      roundRect(ctx, x0, y0, w, y1 - y0, 12);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = alpha('#9fe6ff', 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, y0 - 7, w * 0.42, 5, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = alpha('#ff2d55', 0.95 * pulse);
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5 + pulse * 1.5, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Spinning ground saws. */
export function drawSaws(ctx, view, state, time) {
  for (const h of state.hazards) {
    if (h.dead || h.kind !== 'saw') continue;
    const cx = view.toX(h.cx ?? h.x + h.w * 0.5);
    if (cx < -90 || cx > view.w + 90) continue;
    const cy = view.toY(h.y + h.h);
    const r = h.w * 0.62;
    const u = urgency(h, state.player.x, state.speed);
    const pulse = u > 0.72 ? 0.7 + 0.3 * Math.sin(time * 22) : 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = alpha(HAZARD_HOT, u > 0.7 ? 0.95 : 0.45);
    ctx.shadowBlur = u > 0.7 ? 22 : 10;
    ctx.rotate(time * 15);
    ctx.fillStyle = alpha(HAZARD_HOT, 0.9 * pulse);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      ctx.lineTo(Math.cos(a + 0.17) * r * 1.14, Math.sin(a + 0.17) * r * 1.14);
      ctx.lineTo(Math.cos(a + 0.34) * r * 0.8, Math.sin(a + 0.34) * r * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.rotate(-time * 21);
    ctx.fillStyle = '#1a0a14';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = alpha(HAZARD_HOT, 0.8 * pulse);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(r * 0.6, 0);
    ctx.moveTo(0, -r * 0.6);
    ctx.lineTo(0, r * 0.6);
    ctx.stroke();
    ctx.fillStyle = alpha('#ffd166', 0.85);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#0b0f1c';
    ctx.fillRect(cx - r * 1.15, cy - 5, r * 2.3, 10);
  }
}

/* --------------------------------------------------------------- pickups */

export function drawPickups(ctx, view, state, time) {
  ctx.save();
  const magnetOn = state.powerups.magnet.active;
  const px = state.player.x;
  const py = state.player.y - state.player.h * 0.5;

  for (const p of state.pickups) {
    if (p.taken) continue;
    const x = view.toX(p.x);
    if (x < -60 || x > view.w + 60) continue;
    const bob = p.pulled ? 0 : Math.sin(time * 3 + p.phase) * 3;
    const y = view.toY(p.y) + bob;

    if (p.kind === PICKUP_KIND.COIN) {
      const spin = Math.abs(Math.cos(time * 4.4 + p.phase));
      const near = magnetOn || Math.hypot(p.x - px, p.y - py) < 190;
      ctx.shadowColor = alpha('#ffd166', near ? 0.95 : 0.5);
      ctx.shadowBlur = near ? 18 : 9;
      ctx.fillStyle = '#ffcf5c';
      ctx.beginPath();
      ctx.ellipse(x, y, p.r * (0.35 + spin * 0.65), p.r, 0, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = alpha('#fff6d6', 0.9);
      ctx.beginPath();
      ctx.ellipse(x, y, p.r * (0.1 + spin * 0.24), p.r * 0.46, 0, 0, TAU);
      ctx.fill();
    } else if (p.kind === PICKUP_KIND.GEM) {
      const hue = (time * 90 + p.phase * 40) % 360;
      ctx.shadowColor = `hsla(${hue}, 100%, 70%, 0.9)`;
      ctx.shadowBlur = 20;
      ctx.fillStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.beginPath();
      ctx.moveTo(x, y - p.r);
      ctx.lineTo(x + p.r * 0.85, y);
      ctx.lineTo(x, y + p.r);
      ctx.lineTo(x - p.r * 0.85, y);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = alpha('#ffffff', 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y - p.r);
      ctx.lineTo(x + p.r * 0.3, y - p.r * 0.1);
      ctx.lineTo(x, y + p.r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = alpha('#ffffff', 0.35);
      ctx.lineWidth = 1;
      const pulse = 1 + Math.sin(time * 7 + p.phase) * 0.12;
      ctx.beginPath();
      ctx.arc(x, y, p.r * 1.9 * pulse, 0, TAU);
      ctx.stroke();
    } else {
      drawPowerupOrb(ctx, x, y, p, time);
    }
  }
  ctx.restore();
}

const ORB_COLORS = {
  [PICKUP_KIND.SHIELD]: '#66e0ff',
  [PICKUP_KIND.MAGNET]: '#c084fc',
  [PICKUP_KIND.MULTIPLIER]: '#ffd166',
  [PICKUP_KIND.OVERDRIVE]: '#ff5d8f',
};

function drawPowerupOrb(ctx, x, y, p, time) {
  const color = ORB_COLORS[p.kind] ?? '#ffffff';
  const pulse = 0.75 + 0.25 * Math.sin(time * 5 + p.phase);

  // Light shaft, so orbs read from far away.
  const beam = ctx.createLinearGradient(x, y - 240, x, y + 20);
  beam.addColorStop(0, alpha(color, 0));
  beam.addColorStop(1, alpha(color, 0.16 * pulse));
  ctx.fillStyle = beam;
  ctx.fillRect(x - 16, y - 240, 32, 260);

  ctx.shadowColor = alpha(color, 0.95);
  ctx.shadowBlur = 24;
  ctx.fillStyle = alpha('#04070f', 0.92);
  ctx.beginPath();
  ctx.arc(x, y, 22 * pulse + 2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = alpha(color, 0.6);
  ctx.lineWidth = 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time * 1.7 + p.phase);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 29, (i / 3) * TAU, (i / 3) * TAU + 1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  if (p.kind === PICKUP_KIND.SHIELD) {
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(9, -6);
    ctx.lineTo(9, 3);
    ctx.quadraticCurveTo(9, 10, 0, 13);
    ctx.quadraticCurveTo(-9, 10, -9, 3);
    ctx.lineTo(-9, -6);
    ctx.closePath();
    ctx.stroke();
  } else if (p.kind === PICKUP_KIND.MAGNET) {
    ctx.beginPath();
    ctx.arc(0, 2, 8, Math.PI, 0);
    ctx.moveTo(-8, 2);
    ctx.lineTo(-8, 9);
    ctx.moveTo(8, 2);
    ctx.lineTo(8, 9);
    ctx.stroke();
  } else if (p.kind === PICKUP_KIND.MULTIPLIER) {
    ctx.font = '700 18px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x2', 0, 1);
  } else {
    ctx.beginPath();
    ctx.moveTo(2, -12);
    ctx.lineTo(-6, 2);
    ctx.lineTo(0, 2);
    ctx.lineTo(-2, 12);
    ctx.lineTo(7, -2);
    ctx.lineTo(1, -2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ----------------------------------------------------------- charge pads */

const PAD_FONT = '"Rajdhani", "Chakra Petch", system-ui, sans-serif';

const PAD_COLORS = {
  [PICKUP_KIND.SHIELD]: '#66e0ff',
  [PICKUP_KIND.MAGNET]: '#c084fc',
  [PICKUP_KIND.OVERDRIVE]: '#ff5d8f',
};

function padLabel(ctx, text, x, y, color, a) {
  ctx.font = `700 17px ${PAD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = alpha(color, 0.9 * a);
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(2,6,16,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = alpha(color, a);
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

/** A small diamond, used as the "chain" currency glyph next to a price. */
function chainGlyph(ctx, x, y, r, color, a) {
  ctx.fillStyle = alpha(color, a);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Charge pads: a ground strip that sells one power-up for chain. The strip
 * carries the price and the payload, and lights up only when the runner can
 * actually afford it — so affordability is readable at a glance, without a HUD
 * readout. Holding "down" on it fills the bar and completes the purchase.
 */
export function drawPads(ctx, view, state, time) {
  if (!state.pads.length) return;
  const gy = view.groundScreenY;
  const chain = state.chain;

  for (const pad of state.pads) {
    const x0 = view.toX(pad.x);
    const x1 = view.toX(pad.x2);
    if (x1 < -90 || x0 > view.w + 90) continue;

    const color = PAD_COLORS[pad.kind] ?? '#ffffff';
    const w = Math.max(24, x1 - x0);
    const affordable = !pad.used && chain >= pad.cost;
    const missing = Math.max(0, pad.cost - chain);
    const lead = pad.x - state.player.x;
    const near = lead < Math.max(280, state.speed * 0.6);
    const pulse = 0.65 + 0.35 * Math.sin(time * 4 + pad.phase);
    const lit = pad.used ? 0.22 : affordable ? 0.75 + pulse * 0.25 : 0.38;
    const chargeFrac = pad.used ? 1 : clamp01(pad.charge / PAD.dwell);

    ctx.save();

    // --- light shaft: makes the pad readable from far away ---
    if (!pad.used) {
      const beam = ctx.createLinearGradient(x0, gy - 150, x0, gy);
      beam.addColorStop(0, alpha(color, 0));
      beam.addColorStop(1, alpha(color, (affordable ? 0.16 : 0.07) * (near ? 1.6 : 1)));
      ctx.fillStyle = beam;
      ctx.fillRect(x0 - 6, gy - 150, w + 12, 150);
    }

    // --- the strip ---
    ctx.fillStyle = alpha('#04091a', 0.88);
    ctx.beginPath();
    ctx.roundRect(x0, gy - PAD.band * 0.5, w, PAD.band, 7);
    ctx.fill();

    // --- charge / progress fill ---
    if (chargeFrac > 0) {
      ctx.fillStyle = alpha(color, pad.used ? 0.25 : 0.5);
      ctx.beginPath();
      ctx.roundRect(x0 + 2, gy - PAD.band * 0.5 + 2, (w - 4) * chargeFrac, PAD.band - 4, 5);
      ctx.fill();
    }

    // --- chevrons: this is the line you run ---
    ctx.strokeStyle = alpha(color, (pad.used ? 0.18 : 0.5) * lit);
    ctx.lineWidth = 2;
    const steps = Math.max(2, Math.round(w / 46));
    for (let i = 0; i < steps; i++) {
      const cx = x0 + (w * (i + 0.5)) / steps;
      ctx.beginPath();
      ctx.moveTo(cx - 5, gy - 4);
      ctx.lineTo(cx + 1, gy);
      ctx.lineTo(cx - 5, gy + 4);
      ctx.stroke();
    }

    // --- rim ---
    ctx.strokeStyle = alpha(color, lit);
    ctx.lineWidth = 2;
    ctx.shadowColor = alpha(color, lit);
    ctx.shadowBlur = near && !pad.used ? 16 : 7;
    ctx.beginPath();
    ctx.roundRect(x0, gy - PAD.band * 0.5, w, PAD.band, 7);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // --- label: what you get, and what it costs ---
    const mid = x0 + w * 0.5;
    const labelY = gy - PAD.band - 18;
    if (pad.used) {
      padLabel(ctx, 'SOLD', mid, labelY, '#7ba7c9', 0.7);
    } else if (affordable) {
      padLabel(ctx, 'HOLD', mid - 22, labelY, '#ffffff', 0.95);
      ctx.font = `700 17px ${PAD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = alpha('#ffffff', 0.95 * pulse);
      // down arrow
      ctx.beginPath();
      ctx.moveTo(mid + 4, labelY - 8);
      ctx.lineTo(mid + 10, labelY - 1);
      ctx.lineTo(mid + 7, labelY - 1);
      ctx.lineTo(mid + 7, labelY + 8);
      ctx.lineTo(mid + 1, labelY + 8);
      ctx.lineTo(mid + 1, labelY - 1);
      ctx.lineTo(mid - 2, labelY - 1);
      ctx.closePath();
      ctx.fill();
      chainGlyph(ctx, mid + 30, labelY, 6, '#ffd166', 0.95);
      padLabel(ctx, String(pad.cost), mid + 46, labelY, '#ffd166', 0.95);
    } else {
      chainGlyph(ctx, mid - 26, labelY, 6, '#ff8fa8', 0.75);
      padLabel(ctx, `${pad.cost}`, mid - 12, labelY, '#ff8fa8', 0.8);
      padLabel(ctx, `NEED ${missing}`, mid + 30, labelY, '#ff8fa8', 0.72 + 0.2 * pulse);
    }

    // --- refusal flash ---
    if (pad.denied > 0) {
      ctx.strokeStyle = alpha('#ff4d6d', pad.denied * 0.8);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x0 - 3, gy - PAD.band * 0.5 - 3, w + 6, PAD.band + 6, 9);
      ctx.stroke();
    }

    // --- purchase flare ---
    if (pad.flash > 0) {
      ctx.globalAlpha = pad.flash;
      ctx.strokeStyle = alpha('#ffffff', 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x0 - 6, gy - PAD.band * 0.5 - 6, w + 12, PAD.band + 12, 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}

/** Pulsing danger markers above the rims of a chasm. */
export function drawPitWarnings(ctx, view, state, time) {
  const px = state.player.x;
  for (const g of state.gaps) {
    const x0 = view.toX(g.x);
    const x1 = view.toX(g.x2);
    if (x1 < -60 || x0 > view.w + 60) continue;
    const u = clamp01(1 - (g.x - px) / Math.max(320, state.speed));
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(time * 6));
    const blink = u > 0.6 ? pulse : 0.35;
    ctx.strokeStyle = alpha('#ff3b6b', 0.3 + blink * 0.5);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x0, view.groundScreenY - 12);
    ctx.lineTo(x1, view.groundScreenY - 12);
    ctx.stroke();
    ctx.setLineDash([]);
    if (u > 0.3) {
      const mid = (x0 + x1) * 0.5;
      ctx.fillStyle = alpha('#ff3b6b', blink * 0.8);
      ctx.beginPath();
      ctx.moveTo(mid, view.groundScreenY - 30);
      ctx.lineTo(mid - 9, view.groundScreenY - 46);
      ctx.lineTo(mid + 9, view.groundScreenY - 46);
      ctx.closePath();
      ctx.fill();
    }
  }
}
