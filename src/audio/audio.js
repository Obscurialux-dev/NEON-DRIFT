/**
 * WebAudio synthesiser: every sound is generated at runtime, so the game ships
 * with zero audio assets. Two buses (music / sfx) feed a master gain, and a
 * lookahead scheduler drives a 4-bar procedural music loop whose intensity
 * tracks the run speed.
 *
 * The whole module is a no-op if WebAudio is unavailable, so nothing else in the
 * game has to care.
 */

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** A-minor 4-bar loop: Am - F - C - G */
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64], arp: [69, 72, 76, 72] },
  { root: 41, chord: [53, 57, 60], arp: [65, 69, 72, 69] },
  { root: 48, chord: [60, 64, 67], arp: [72, 76, 79, 76] },
  { root: 43, chord: [55, 59, 62], arp: [67, 71, 74, 71] },
];

export function createAudio() {
  const audio = {
    ready: false,
    muted: false,
    musicOn: true,
  };

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuffer = null;
  let step = 0;
  let nextStepTime = 0;
  let intensity = 0;
  let lastSfx = new Map();

  function ensure() {
    if (ctx) return true;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ctx = new Ctor();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.85;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3;
    musicBus.connect(master);

    // Pre-rendered noise for percussion / impacts.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    audio.ready = true;
    return true;
  }

  /** Browsers require a gesture before audio may start. */
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function applyGain() {
    if (!ctx) return;
    const target = audio.muted ? 0 : 0.85;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
    musicBus.gain.setTargetAtTime(audio.musicOn ? 0.3 : 0.0, ctx.currentTime, 0.05);
  }

  /* ---------------------------------------------------------------- prims */

  function tone(freq, dur, opts = {}) {
    if (!ctx || audio.muted) return;
    const {
      type = 'sine',
      gain = 0.18,
      to = freq,
      bus = sfxBus,
      attack = 0.006,
      delay = 0,
      detune = 0,
    } = opts;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts = {}) {
    if (!ctx || audio.muted || !noiseBuffer) return;
    const { gain = 0.2, lp = 4000, hp = 120, bus = sfxBus, delay = 0, sweepTo = 0, q = 1 } = opts;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(lp, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    filter.Q.value = q;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(highpass);
    highpass.connect(g);
    g.connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
  /* ------------------------------------------------------------------ sfx */

  const SFX = {
    jump: () => {
      tone(320, 0.16, { type: 'square', to: 700, gain: 0.13 });
      noise(0.09, { gain: 0.08, lp: 1400, sweepTo: 3200 });
    },
    doubleJump: () => {
      tone(520, 0.18, { type: 'triangle', to: 1150, gain: 0.14 });
      tone(780, 0.12, { type: 'square', to: 1500, gain: 0.06, delay: 0.02 });
    },
    land: () => {
      tone(150, 0.11, { type: 'sine', to: 70, gain: 0.16 });
      noise(0.12, { gain: 0.1, lp: 900, sweepTo: 260, q: 0.8 });
    },
    slide: () => noise(0.32, { gain: 0.1, lp: 2400, sweepTo: 700, q: 0.7 }),
    coin: (index = 0) => {
      const step2 = Math.min(index, 12);
      tone(NOTE(84 + step2), 0.08, { type: 'square', gain: 0.09 });
      tone(NOTE(91 + step2), 0.12, { type: 'square', gain: 0.07, delay: 0.05 });
    },
    gem: () => {
      [76, 81, 85, 88].forEach((n, i) =>
        tone(NOTE(n), 0.22, { type: 'triangle', gain: 0.11, delay: i * 0.05 }),
      );
    },
    powerup: () => {
      [69, 72, 76, 81, 84].forEach((n, i) =>
        tone(NOTE(n), 0.3, { type: 'sawtooth', gain: 0.07, delay: i * 0.055 }),
      );
      tone(NOTE(45), 0.5, { type: 'sine', gain: 0.12 });
    },
    powerupEnd: () => tone(420, 0.28, { type: 'triangle', to: 180, gain: 0.09 }),
    shieldBreak: () => {
      tone(900, 0.22, { type: 'square', to: 200, gain: 0.14 });
      noise(0.3, { gain: 0.22, lp: 5200, sweepTo: 400, q: 0.6 });
    },
    smash: () => {
      noise(0.22, { gain: 0.26, lp: 1600, sweepTo: 220, q: 0.7 });
      tone(220, 0.2, { type: 'sawtooth', to: 60, gain: 0.16 });
    },
    nearMiss: () => tone(1500, 0.06, { type: 'triangle', gain: 0.06, to: 2100 }),
    hit: () => {
      noise(0.4, { gain: 0.3, lp: 2600, sweepTo: 180, q: 0.5 });
      tone(300, 0.4, { type: 'sawtooth', to: 60, gain: 0.2 });
    },
    fall: () => tone(260, 0.7, { type: 'sine', to: 40, gain: 0.2 }),
    death: () => {
      noise(0.9, { gain: 0.3, lp: 3000, sweepTo: 120, q: 0.4 });
      [57, 55, 52, 45].forEach((n, i) =>
        tone(NOTE(n - 12), 0.6, { type: 'sawtooth', gain: 0.11, delay: i * 0.13 }),
      );
    },
    start: () => {
      [64, 69, 76, 81].forEach((n, i) =>
        tone(NOTE(n), 0.28, { type: 'square', gain: 0.08, delay: i * 0.07 }),
      );
    },
    record: () => {
      [72, 76, 79, 84, 88, 91].forEach((n, i) =>
        tone(NOTE(n), 0.4, { type: 'triangle', gain: 0.1, delay: i * 0.09 }),
      );
    },
    district: () => {
      tone(NOTE(52), 0.7, { type: 'triangle', gain: 0.1 });
      tone(NOTE(59), 0.7, { type: 'triangle', gain: 0.08, delay: 0.06 });
      noise(0.5, { gain: 0.07, lp: 3200, sweepTo: 900 });
    },
    cashIn: () => {
      // "Credit accepted": a bright rising triad over a low thump, plus a short
      // swipe of noise so it reads as a transaction rather than a pickup.
      [72, 79, 84, 88].forEach((n, i) =>
        tone(NOTE(n), 0.14, { type: 'triangle', gain: 0.11, delay: i * 0.045 }),
      );
      tone(NOTE(45), 0.22, { type: 'sine', gain: 0.16 });
      noise(0.1, { gain: 0.07, lp: 5200, sweepTo: 1800, q: 0.9, delay: 0.02 });
    },
    padDenied: () => {
      tone(220, 0.16, { type: 'square', to: 110, gain: 0.1 });
      noise(0.1, { gain: 0.08, lp: 700, sweepTo: 200, q: 0.8 });
    },
    ui: () => tone(880, 0.07, { type: 'square', gain: 0.07 }),
  };

  /** Play a named effect. Repeats inside 25 ms collapse into one (cheap limiter). */
  function sfx(name, arg) {
    if (!ctx || audio.muted) return;
    const fn = SFX[name];
    if (!fn) return;
    const now = ctx.currentTime;
    const last = lastSfx.get(name) ?? -1;
    if (now - last < 0.025) return;
    lastSfx.set(name, now);
    try {
      fn(arg);
    } catch {
      /* audio must never break the game */
    }
  }


  /* --------------------------------------------------------------- music */

  const BPM = 132;
  const SIXTEENTH = 60 / BPM / 4;

  function scheduleStep(s, when) {
    const bar = Math.floor(s / 16) % PROGRESSION.length;
    const beat = s % 16;
    const prog = PROGRESSION[bar];

    // Kick on 1 and 3.
    if (beat === 0 || beat === 8) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(44, when + 0.16);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.5, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.25);
    }

    // Hat on every eighth, with an accent on the downbeats.
    if (beat % 2 === 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const g = ctx.createGain();
      const acc = beat % 4 === 0 ? 0.13 : 0.07;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(acc, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      src.connect(hp);
      hp.connect(g);
      g.connect(musicBus);
      src.start(when);
      src.stop(when + 0.07);
    }

    // Bass on each beat, with an octave hop half way through the bar.
    if (beat % 4 === 0) {
      const note = prog.root + (beat === 8 ? 12 : 0);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = NOTE(note);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320 + intensity * 900, when);
      filter.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.32, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
      osc.connect(filter);
      filter.connect(g);
      g.connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.34);
    }

    // Pad chord at the top of each bar.
    if (beat === 0) {
      for (const n of prog.chord) {
        tone(NOTE(n), 1.7, { type: 'triangle', gain: 0.03, bus: musicBus, attack: 0.4 });
      }
    }

    // Arp layer, fading in as the run speeds up.
    if (intensity > 0.18) {
      const arpNote = prog.arp[s % prog.arp.length];
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = NOTE(arpNote + 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.018 + intensity * 0.1, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.16);
    }
  }

  /** Call once per frame; `level` is a 0..1 tension value. */
  function update(level = 0) {
    if (!ctx || audio.muted || !audio.musicOn) return;
    intensity = Math.max(0, Math.min(1, level));
    const now = ctx.currentTime;
    if (nextStepTime < now) nextStepTime = now + 0.06;
    let guard = 0;
    while (nextStepTime < now + 0.25 && guard++ < 64) {
      scheduleStep(step, nextStepTime);
      step = (step + 1) % 64;
      nextStepTime += SIXTEENTH;
    }
  }

  function resetMusic() {
    step = 0;
    if (ctx) nextStepTime = ctx.currentTime + 0.06;
  }

  return {
    state: audio,
    unlock,
    sfx,
    update,
    resetMusic,
    get isMuted() {
      return audio.muted;
    },
    get musicOn() {
      return audio.musicOn;
    },
    setMuted(value) {
      audio.muted = !!value;
      applyGain();
    },
    setMusic(value) {
      audio.musicOn = !!value;
      applyGain();
    },
    toggleMute() {
      audio.muted = !audio.muted;
      applyGain();
      return audio.muted;
    },
  };
}

