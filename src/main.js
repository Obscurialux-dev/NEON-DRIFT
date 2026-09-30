/**
 * NEON DRIFT — bootstrap, fixed-timestep loop, scene management and the bridge
 * between simulation events and the presentation layer (particles + audio).
 */
import {
  CONFIG,
  GROUND_Y,
  PLAYER_ANCHOR_X,
  POWERUPS,
  PX_PER_METRE,
  SPEED,
  VIEW_H,
  VIEW_W,
} from './config.js';
import { clamp } from './core/math.js';
import { createProfiler } from './core/perf.js';
import { createInput } from './core/input.js';
import { loadSave, recordRun } from './core/storage.js';
import { createAutopilot, autopilotInput } from './game/autopilot.js';
import { createGameState, drainEvents, resetGame, stepGame } from './game/state.js';
import { createAudio } from './audio/audio.js';
import {
  createBackground,
  drawBillboards,
  drawFog,
  drawGround,
  drawSky,
  drawSkyline,
  drawStars,
  invalidateBackground,
} from './render/background.js';
import {
  drawHazards,
  drawPads,
  drawPickups,
  drawPitWarnings,
  drawPlayer,
  drawSaws,
} from './render/entities.js';
import { drawHud } from './render/hud.js';
import {
  burst,
  createFx,
  drawFx,
  drawTexts,
  floatText,
  liveCount,
  ring,
  spawn,
  updateFx,
} from './render/particles.js';
import { createQuality } from './render/quality.js';
import { alpha, paletteAt } from './render/theme.js';
import { createScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.has('debug');

/** Stage profiler. Only samples when `?debug=1` is on (see `PROFILE`). */
const PROFILE = DEBUG;
const prof = createProfiler({ enabled: PROFILE });

/** Quality tier, render resolution and the adaptive controller. */
const quality = createQuality({ params: PARAMS });
/** Current preset (re-read whenever the tier changes). */
let q = quality.preset;

/** Stage timer helpers — no-ops (one boolean branch) unless profiling is on. */
const t0 = () => {
  if (prof.enabled) prof.begin();
};
const t1 = (name) => {
  if (prof.enabled) prof.end(name);
};

/* ------------------------------------------------------------- game state */

const save = loadSave();
const audio = createAudio();
const fx = createFx(CONFIG.particles.max);
const background = createBackground();
const screens = createScreens({
  onStart: () => startRun(),
  onResume: () => resume(),
  onRestart: () => startRun(),
  // The on-screen touch pad feeds the same input pipeline as the keyboard, so
  // the JUMP / SLIDE buttons the mobile layout shows actually work. (`input` is
  // declared below; this only runs after a tap, long after module evaluation.)
  onTouch: (key, held) => {
    if (key === 'jump') input.state.touchJump = held;
    else if (key === 'slide') input.state.touchDown = held;
  },
  onToggleSound: () => {
    const muted = audio.toggleMute();
    save.muted = muted;
    writeSaveSilently();
    screens.setSound(muted);
  },
});

const game = createGameState({ seed: (Math.random() * 0xffffffff) >>> 0 });
const demo = createGameState({ seed: (Math.random() * 0xffffffff) >>> 0 });
const demoBot = createAutopilot();

let scene = 'title';
let frameCount = 0;
let fpsAcc = 0;
let fps = 60;
/** Debug-only autopilot for the perf harness (`__neonDrift.autopilot(true)`). */
let autoBot = null;

const trail = [];
let trailTimer = 0;
let hintTimer = 0;
let districtName = '';
let districtFlash = 0;
let overDelay = 0;

/* ------------------------------------------------------------------- view */

const view = {
  w: VIEW_W,
  h: VIEW_H,
  scale: 1,
  dpr: 1,
  groundScreenY: GROUND_Y,
  camX: 0,
  toX(x) {
    return x - this.camX;
  },
  toY(y) {
    return y - GROUND_Y + this.groundScreenY;
  },
};

function resize() {
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const next = quality.resize(cssW, cssH, window.devicePixelRatio || 1);
  if (canvas.width !== next.width || canvas.height !== next.height) {
    canvas.width = next.width;
    canvas.height = next.height;
    // Baked layers are sized in device pixels, so they have to be rebuilt.
    invalidateBackground(background);
    vignette.key = '';
  }
  // `view.h` is in virtual units: only the CSS size and the virtual width matter.
  view.scale = cssW / VIEW_W;
  view.dpr = next.dpr;
  view.backing = canvas.width * canvas.height;
  view.h = cssH / view.scale;
  view.groundScreenY = clamp(view.h * 0.78, 320, Math.max(340, view.h - 90));
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* ------------------------------------------------------------------ input */

const input = createInput(canvas, {
  onAction(name) {
    if (name === 'mute') {
      const muted = audio.toggleMute();
      save.muted = muted;
      writeSaveSilently();
      screens.setSound(muted);
      return;
    }
    if (name === 'confirm' || name === 'press' || name === 'up') audio.unlock();
    if (scene === 'title' && (name === 'confirm' || name === 'press' || name === 'up')) {
      startRun();
    } else if (scene === 'paused' && (name === 'pause' || name === 'confirm' || name === 'press')) {
      resume();
    } else if (scene === 'over' && (name === 'restart' || name === 'confirm' || name === 'press')) {
      // The overlay promises "press SPACE / tap to run again", so accept both.
      startRun();
    } else if (scene === 'playing' && name === 'pause') {
      pause();
    }
  },
});

/* ------------------------------------------------------------ transitions */

function startRun() {
  audio.unlock();
  audio.resetMusic();
  resetGame(game, (Math.random() * 0xffffffff) >>> 0);
  trail.length = 0;
  fx.texts.length = 0;
  for (const p of fx.pool) p.alive = false;
  hintTimer = 9;
  overDelay = 0;
  districtName = paletteAt(0).name;
  districtFlash = 2.6;
  scene = 'playing';
  screens.show(null);
  audio.sfx('start');
}

function pause() {
  if (scene !== 'playing') return;
  scene = 'paused';
  input.release();
  screens.show('pause', { score: game.score, metres: game.metres });
}

function resume() {
  if (scene !== 'paused') return;
  scene = 'playing';
  screens.show(null);
}

function finishRun() {
  const { save: updated, records } = recordRun(save, {
    score: game.score,
    metres: game.metres,
    coins: game.coins,
    bestChain: game.bestChain,
    cashed: game.cashed,
    padsBought: game.padsBought,
  });
  scene = 'over';
  screens.show('over', { run: game, save: updated, records, cause: game.deathCause });
  if (records.length) audio.sfx('record');
}

function writeSaveSilently() {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(save));
  } catch {
    /* storage is optional */
  }
}

/* -------------------------------------------------------------------- fx */

const POWERUP_LABELS = {
  shield: 'SHIELD ONLINE',
  magnet: 'MAGNET ONLINE',
  multiplier: 'DOUBLE SCORE',
  overdrive: 'OVERDRIVE!',
};

function deathBurst(event) {
  burst(fx, event.x, event.y, 46, {
    color: '#ff6b9d',
    speed: 460,
    kind: 'shard',
    size: 6,
    maxLife: 1.1,
    drag: 1.1,
    gravity: 900,
  });
  burst(fx, event.x, event.y, 26, {
    color: '#ffd166',
    speed: 620,
    kind: 'spark',
    size: 4,
    maxLife: 0.7,
    drag: 1.6,
  });
  ring(fx, event.x, event.y, { color: '#ff5d8f', size: 16, grow: 900, maxLife: 0.6 });
  ring(fx, event.x, event.y, { color: '#ffffff', size: 8, grow: 620, maxLife: 0.4 });
  floatText(fx, 'SYSTEM FAILURE', event.x, event.y - 60, {
    color: '#ff8bb0',
    size: 30,
    maxLife: 1.4,
    vy: -40,
  });
}

/** Turn simulation events into particles, floating text and sound. */
function emitFromEvents(state, events) {
  for (const event of events) {
    switch (event.type) {
      case 'jump':
        ring(fx, event.x, event.y, { color: '#7ff0ff', size: 8, grow: 260, maxLife: 0.3 });
        burst(fx, event.x, event.y, 8, {
          color: '#9fe6ff',
          speed: 190,
          angle: Math.PI * 0.5,
          spread: 1.4,
          kind: 'spark',
          size: 3,
          maxLife: 0.32,
          gravity: 500,
          drag: 1.4,
        });
        audio.sfx('jump');
        break;
      case 'doubleJump':
        ring(fx, event.x, event.y, { color: '#c084fc', size: 10, grow: 420, maxLife: 0.36 });
        burst(fx, event.x, event.y - 10, 12, {
          color: '#d9b3ff',
          speed: 240,
          kind: 'spark',
          size: 3,
          maxLife: 0.36,
          drag: 1.8,
        });
        audio.sfx('doubleJump');
        break;
      case 'land':
        burst(fx, event.x, event.y, 10, {
          color: '#9fd8ff',
          speed: 150,
          angle: -Math.PI * 0.5,
          spread: 2.6,
          kind: 'dust',
          size: 4,
          maxLife: 0.36,
          gravity: 260,
          drag: 2.4,
        });
        audio.sfx('land');
        break;
      case 'slide':
        audio.sfx('slide');
        break;
      case 'coin':
        burst(fx, event.x, event.y, 5, {
          color: '#ffd166',
          speed: 150,
          kind: 'star',
          size: 4,
          maxLife: 0.32,
          drag: 3,
        });
        audio.sfx('coin', state.chain);
        break;
      case 'gem':
        burst(fx, event.x, event.y, 16, {
          color: '#8ef0ff',
          speed: 260,
          kind: 'star',
          size: 5,
          maxLife: 0.5,
          drag: 2.6,
        });
        ring(fx, event.x, event.y, { color: '#ffffff', size: 8, grow: 520, maxLife: 0.4 });
        floatText(fx, `+${60 * state.multiplier}`, event.x, event.y - 22, {
          color: '#d8f9ff',
          size: 26,
        });
        audio.sfx('gem');
        break;
      case 'powerupOrb':
        audio.sfx('powerup');
        break;
      case 'powerup':
        ring(fx, event.x, event.y - 30, { color: '#ffffff', size: 14, grow: 700, maxLife: 0.5 });
        floatText(fx, POWERUP_LABELS[event.kind] ?? 'POWER UP', event.x, event.y - 74, {
          color: '#ffffff',
          size: 26,
        });
        break;
      case 'nearMiss':
        floatText(fx, 'NEAR MISS', event.x, event.y, { color: '#ffd166', size: 20, maxLife: 0.7 });
        audio.sfx('nearMiss');
        break;
      case 'shieldBreak':
        ring(fx, event.x, event.y, { color: '#66e0ff', size: 18, grow: 600, maxLife: 0.5 });
        burst(fx, event.x, event.y, 22, {
          color: '#bff2ff',
          speed: 320,
          kind: 'shard',
          size: 5,
          maxLife: 0.6,
          drag: 1.6,
        });
        audio.sfx('shieldBreak');
        break;
      case 'smash':
        burst(fx, event.x, event.y, 18, {
          color: '#ff8bb0',
          speed: 300,
          kind: 'shard',
          size: 5,
          maxLife: 0.55,
          drag: 1.8,
          gravity: 800,
        });
        audio.sfx('smash');
        break;
      case 'hazardHit':
        burst(fx, event.x, event.y, 20, {
          color: '#ff5d8f',
          speed: 330,
          kind: 'spark',
          size: 4,
          maxLife: 0.5,
          drag: 1.6,
        });
        break;
      case 'cashIn': {
        const color = POWERUPS[event.kind]?.color ?? '#ffffff';
        ring(fx, event.x, event.y, { color, size: 12, grow: 780, maxLife: 0.5 });
        burst(fx, event.x, event.y, 22, {
          color,
          speed: 360,
          kind: 'spark',
          size: 4,
          maxLife: 0.45,
          drag: 1.6,
          additive: true,
        });
        floatText(fx, `-${event.cost}  ${POWERUP_LABELS[event.kind] ?? 'POWER UP'}`, event.x, event.y - 100, {
          color,
          size: 22,
          maxLife: 1.1,
        });
        audio.sfx('cashIn');
        break;
      }
      case 'padDenied':
        floatText(fx, `NEED ${event.need}  ·  HAVE ${event.have}`, event.x, event.y - 100, {
          color: '#ff8fa8',
          size: 18,
          maxLife: 0.95,
        });
        audio.sfx('padDenied');
        break;
      case 'death':
        deathBurst(event);
        audio.sfx(event.cause === 'fall' ? 'fall' : 'hit');
        audio.sfx('death');
        break;
      default:
        break;
    }
  }
}

/* --------------------------------------------------------------- drawing */

const toX = (x) => x - view.camX;
const toY = (y) => y - GROUND_Y + view.groundScreenY;

/**
 * Baked screen vignette. The original built a full-screen radial gradient every
 * frame; baked at a third of the resolution and stretched, it is one textured
 * blit and visually identical (it is a smooth darkening, so upscaling is free).
 */
const VIGNETTE_SCALE = 0.34;
const vignette = { key: '', canvas: null };

function bakeVignette(viewState, s) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewState.w * s));
  canvas.height = Math.max(1, Math.round(viewState.h * s));
  const g2 = canvas.getContext('2d');
  g2.setTransform(s, 0, 0, s, 0, 0);
  const grad = g2.createRadialGradient(
    viewState.w * 0.5,
    viewState.h * 0.5,
    viewState.h * 0.35,
    viewState.w * 0.5,
    viewState.h * 0.5,
    viewState.h * 0.95,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, viewState.w, viewState.h);
  return canvas;
}

function drawVignette(target, viewState) {
  const key = `${viewState.w}|${viewState.h}|${viewState.scale.toFixed(3)}`;
  if (vignette.key !== key) {
    vignette.canvas = bakeVignette(viewState, VIGNETTE_SCALE);
    vignette.key = key;
  }
  target.drawImage(vignette.canvas, 0, 0, viewState.w, viewState.h);
}

let dustTimer = 0;
let streakTimer = 0;

function ambientFx(state, dt) {
  const p = state.player;
  if (!p.alive || scene !== 'playing') return;
  /** Decorative-only emitters scale with the quality tier; gameplay feedback
   * (jump/land/hit bursts) never does. */
  const deco = q.decorativeScale;

  if (p.onGround && !p.sliding) {
    dustTimer -= dt;
    if (dustTimer <= 0) {
      dustTimer = 0.055;
      const count = deco >= 1 ? 2 : deco >= 0.5 ? 1 : 0;
      for (let i = 0; i < count; i++) {
        spawn(fx, {
          kind: 'dust',
          x: p.x - 18 + Math.random() * 10,
          y: p.y - 2 - Math.random() * 6,
          vx: -state.speed * (0.25 + Math.random() * 0.2),
          vy: -40 - Math.random() * 60,
          size: 2 + Math.random() * 3,
          color: '#8fd8ff',
          maxLife: 0.34,
          drag: 2.4,
          gravity: 120,
          additive: true,
        });
      }
    }
  } else if (p.sliding) {
    dustTimer -= dt;
    if (dustTimer <= 0) {
      dustTimer = 0.022;
      const count = deco >= 1 ? 3 : deco >= 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        spawn(fx, {
          kind: 'smoke',
          x: p.x - 24,
          y: p.y - 4 - Math.random() * 14,
          vx: -state.speed * (0.35 + Math.random() * 0.3),
          vy: -80 - Math.random() * 90,
          size: 5 + Math.random() * 6,
          grow: 26,
          color: '#63e0ff',
          maxLife: 0.42,
          drag: 2.2,
          additive: true,
        });
      }
    }
  }

  if (state.speed > 700) {
    streakTimer -= dt;
    if (streakTimer <= 0) {
      streakTimer = 0.03;
      const screenY = 40 + Math.random() * (view.groundScreenY - 90);
      spawn(fx, {
        kind: 'spark',
        x: state.player.x + 760 + Math.random() * 200,
        y: GROUND_Y - (view.groundScreenY - screenY),
        vx: -state.speed * 1.7,
        vy: 0,
        size: 2,
        color: '#cfefff',
        maxLife: 0.4,
        drag: 0,
        additive: true,
      });
    }
  }
}

/* --------------------------------------------------------------- stepping */

const stepSeconds = CONFIG.fixedStep;
let accumulator = 0;
let previousY = GROUND_Y;

function stepActiveState(dt, snapshot) {
  if (scene === 'playing') {
    previousY = game.player.y;
    stepGame(game, dt, snapshot);
    const events = drainEvents(game);
    if (events.length) emitFromEvents(game, events);
    spawnTrail(game, dt);
  } else if (scene === 'title') {
    const demoInput = autopilotInput(demoBot, demo, dt);
    stepGame(demo, dt, demoInput);
    drainEvents(demo);
    if (demo.dead && demo.deathTimer > 1.6) {
      resetGame(demo, (Math.random() * 0xffffffff) >>> 0);
    }
  }
}

function spawnTrail(state, dt) {
  trailTimer -= dt;
  const player = state.player;
  if (trailTimer <= 0 && player.alive) {
    trailTimer = 0.035;
    trail.push({ x: player.x, y: player.y, sliding: player.sliding });
    if (trail.length > 6) trail.shift();
  }
  if (state.dead) {
    trail.length = 0;
  }
}


function render(alphaFraction) {
  const state = scene === 'title' ? demo : game;
  const palette = paletteAt(state.metres);
  view.camX = state.player.x + state.speed * alphaFraction * stepSeconds - VIEW_W * PLAYER_ANCHOR_X;

  const shake = state.shake;
  const shakeX = (Math.random() - 0.5) * shake * 1.5;
  const shakeY = (Math.random() - 0.5) * shake * 1.5;

  ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, 0, 0);
  ctx.save();
  ctx.translate(shakeX, shakeY);

  t0();
  drawSky(background, ctx, view, palette, state.time, q);
  t1('sky');
  t0();
  drawStars(background, ctx, view, palette, state.time, q);
  t1('stars');
  t0();
  drawSkyline(background, ctx, view, palette, state.time, q);
  t1('skyline');
  t0();
  drawBillboards(background, ctx, view, palette, state.time, q);
  t1('billboards');
  t0();
  drawFog(background, ctx, view, palette, state.time, q);
  t1('fog');
  t0();
  drawGround(background, ctx, view, palette, state, state.time, q);
  t1('ground');
  t0();
  drawPitWarnings(ctx, view, state, state.time);
  t1('pitWarn');
  t0();
  drawPads(ctx, view, state, state.time);
  t1('pads');
  t0();
  drawPickups(ctx, view, state, state.time);
  t1('pickups');
  t0();
  drawHazards(ctx, view, state, state.time);
  t1('hazards');
  t0();
  drawSaws(ctx, view, state, state.time);
  t1('saws');

  if (scene === 'playing') {
    t0();
    state.player.renderY = previousY + (state.player.y - previousY) * alphaFraction;
    drawPlayer(ctx, view, state, state.player, { palette, time: state.time, trail, fade: 1 });
    t1('player');
  }

  t0();
  drawFx(ctx, fx, toX, toY);
  drawTexts(ctx, fx, toX, toY);
  t1('fx');

  t0();

  // --- screen effects ----------------------------------------------------
  if (state.flash > 0.02) {
    ctx.globalAlpha = Math.min(0.5, state.flash * 0.45);
    ctx.fillStyle = state.dead ? '#ff4d6d' : '#ffffff';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalAlpha = 1;
  }

  if (state.dead) {
    const k = Math.min(1, state.deathTimer * 1.6);
    ctx.fillStyle = alpha('#12000a', 0.35 * k);
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalAlpha = 0.25 * (1 - k * 0.6);
    for (let i = 0; i < 6; i++) {
      if (Math.random() > 0.5) continue;
      const y = Math.random() * view.h;
      ctx.fillStyle = i % 2 ? '#ff2d6b' : '#2de3ff';
      ctx.fillRect(0, y, view.w, 2 + Math.random() * 8);
    }
    ctx.globalAlpha = 1;
  }
  t1('overlay');

  t0();
  drawVignette(ctx, view);
  t1('vignette');

  ctx.restore();

  // --- HUD (never shaken) ------------------------------------------------
  ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, 0, 0);
  if (scene === 'playing' || scene === 'paused' || scene === 'over') {
    t0();
    drawHud(ctx, view, game, {
      time: game.time,
      best: save.bestScore,
      musicOn: !audio.isMuted,
      district: scene === 'playing' ? districtName : '',
      districtFlash: scene === 'playing' ? districtFlash : 0,
      hint: scene === 'playing' ? clamp((hintTimer - 1.5) / 2.5, 0, 1) : 0,
    });
    t1('hud');
  }

  if (scene === 'title') {
    ctx.fillStyle = 'rgba(2,4,12,0.62)';
    ctx.fillRect(0, 0, view.w, view.h);
  }

  if (DEBUG) {
    t0();
    drawDebugOverlay(view, prof, fps, entityCount(state), view.backing ?? 0);
    t1('debug');
  }
}

/** Live entity count behind the debug readout. */
function entityCount(state) {
  return state.hazards.length + state.pickups.length + state.gaps.length + state.pads.length;
}

/**
 * `?debug=1` readout: frame timing, per-stage cost, workload and the render
 * resolution actually in use. Cheap (a handful of `fillText` calls, no glow),
 * and only compiled into the frame path when the query flag is present.
 */
function drawDebugOverlay(viewState, profiler, fpsValue, entities, backingPixels) {
  const p = profiler;
  const m = p.metrics;
  const lines = [
    `fps ${fpsValue.toFixed(0)}  frame ${p.frameEma.toFixed(1)}ms (peak ${p.framePeak.toFixed(0)})  sim ${m.simMs.toFixed(2)}ms x${m.steps}`,
    `particles ${m.particles}/${m.particlesCap}  entities ${entities}  ${scene}`,
    `render ${canvas.width}x${canvas.height}px  dpr ${viewState.dpr.toFixed(2)}  scale ${viewState.scale.toFixed(2)}  q ${m.quality}`,
    `speed ${game.speed.toFixed(0)}  sky ${p.ms('sky').toFixed(1)} · city ${p.ms('skyline').toFixed(1)} · floor ${p.ms('ground').toFixed(1)} · fx ${p.ms('fx').toFixed(1)} · hud ${p.ms('hud').toFixed(1)} · sim ${p.ms('sim').toFixed(2)}`,
  ];
  ctx.font = '600 14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const baseY = viewState.h - 14 - (lines.length - 1) * 17;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? '#7ff0ff' : '#4fbfd8';
    ctx.fillText(lines[i], 12, baseY + i * 17);
  }
  // Backing-store size is shown above; the raw pixel count is handy when
  // comparing render scales run-to-run.
  if (backingPixels) {
    ctx.fillStyle = '#2f7f95';
    ctx.fillText(`${(backingPixels / 1e6).toFixed(2)} Mpx`, 12, baseY - 17);
  }
}

/* ------------------------------------------------------------- main loop */

let lastTime = performance.now() / 1000;

function frame(nowMs) {
  const now = nowMs / 1000;
  let dt = now - lastTime;
  lastTime = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.25);

  fpsAcc += dt;
  frameCount++;
  if (fpsAcc >= 0.5) {
    fps = frameCount / fpsAcc;
    frameCount = 0;
    fpsAcc = 0;
  }
  prof.tick(dt * 1000);
  // Adaptive render scale: if the smoothed frame time says we are missing the
  // budget, shed resolution (and grow it back when there is headroom).
  if (quality.observe(prof.frameEma)) resize();

  input.update(dt);
  const snapshot = { jump: input.state.jump, down: input.state.down };
  if (autoBot && scene === 'playing') {
    const botInput = autopilotInput(autoBot, game, dt);
    snapshot.jump = botInput.jump;
    snapshot.down = botInput.down;
  }

  accumulator += dt;
  let steps = 0;
  const maxSteps = CONFIG.maxStepsPerFrame;
  if (prof.enabled) prof.begin();
  while (accumulator >= stepSeconds && steps < maxSteps) {
    stepActiveState(stepSeconds, snapshot);
    accumulator -= stepSeconds;
    steps++;
  }
  if (steps >= maxSteps) accumulator = 0;
  if (prof.enabled) {
    prof.end('sim');
    prof.metrics.steps = steps;
    prof.metrics.simMs = prof.ms('sim');
  }

  updateFx(fx, dt);
  ambientFx(scene === 'title' ? demo : game, dt);

  const palette = paletteAt(game.metres);
  if (scene === 'playing') {
    if (palette.name !== districtName) {
      districtName = palette.name;
      districtFlash = 2.6;
      audio.sfx('district');
    }
    districtFlash = Math.max(0, districtFlash - dt);
    hintTimer = Math.max(0, hintTimer - dt);
    if (game.dead) {
      overDelay += dt;
      if (overDelay > 1.15) finishRun();
    }
  }

  const intensity = clamp((game.speed - SPEED.start) / (SPEED.max * 1.35 - SPEED.start), 0, 1);
  audio.update(scene === 'playing' ? intensity : 0.12);

  if (prof.enabled) {
    prof.metrics.particles = liveCount(fx);
    prof.metrics.particlesCap = fx.capacity;
    prof.metrics.entities = entityCount(scene === 'title' ? demo : game);
    prof.metrics.quality = quality.describe();
  }

  render(clamp(accumulator / stepSeconds, 0, 1));
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ boot */

function boot() {
  resize();
  fx.capacity = q.particleCap;
  audio.setMuted(save.muted);
  screens.setSound(save.muted);
  screens.setTitleStats(save);
  screens.show('title');
  requestAnimationFrame(frame);
}

boot();

// Debug surface used by the automated browser smoke test.
globalThis.__neonDrift = {
  get scene() {
    return scene;
  },
  get state() {
    return game;
  },
  get demo() {
    return demo;
  },
  get fps() {
    return fps;
  },
  get perf() {
    return prof;
  },
  /** Live render-quality state (tier, adaptive bias, backing store). */
  get quality() {
    return quality.snapshot();
  },
  /** Debug-only: switch tier at runtime (`__neonDrift.setQuality('low')`). */
  setQuality(name) {
    if (!quality.setPreset(name)) return false;
    q = quality.preset;
    fx.capacity = q.particleCap;
    resize();
    return true;
  },
  get view() {
    return view;
  },
  /** Live input booleans (handy for automated input tests). */
  get input() {
    return {
      jump: input.state.jump,
      down: input.state.down,
      touchJump: input.state.touchJump,
      touchDown: input.state.touchDown,
    };
  },
  start: startRun,
  pause,
  resume,
  setInput(jump, down) {
    input.state.touchJump = !!jump;
    input.state.touchDown = !!down;
  },
  /**
   * Debug-only: hand the live run over to the attract-mode autopilot. Used by
   * `npm run perf` to profile a long, realistic run instead of the ~5 s an
   * untouched runner survives. Does not touch gameplay code or controls.
   */
  autopilot(on) {
    autoBot = on ? (autoBot ?? createAutopilot()) : null;
  },
};

