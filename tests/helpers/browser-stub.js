/**
 * Minimal DOM + WebAudio + rAF stubs so the *whole app* (main.js: loop, scenes,
 * renderer, particles, audio scheduler) can be exercised inside plain Node.
 *
 * This is not a pixel-accurate browser: it is a "does the real code path run
 * without throwing, and does it produce work" harness. `counts` records the
 * interesting calls so tests can assert that drawing and audio actually happened.
 */

export function installStubs() {
  const counts = {
    fill: 0,
    fillRect: 0,
    stroke: 0,
    arc: 0,
    gradients: 0,
    oscillators: 0,
    buffers: 0,
    ramps: 0,
    raf: 0,
  };

  const gradient = { addColorStop: () => {} };

  const makeParam = () => ({
    value: 0,
    setValueAtTime: () => counts.ramps++,
    linearRampToValueAtTime: () => counts.ramps++,
    exponentialRampToValueAtTime: () => counts.ramps++,
    setTargetAtTime: () => counts.ramps++,
    cancelScheduledValues: () => {},
  });

  const makeNode = () => ({
    connect: () => {},
    disconnect: () => {},
    start: () => {},
    stop: () => {},
    gain: makeParam(),
    frequency: makeParam(),
    Q: makeParam(),
    detune: makeParam(),
    playbackRate: makeParam(),
    threshold: makeParam(),
    ratio: makeParam(),
    knee: makeParam(),
    type: 'sine',
    buffer: null,
    loop: false,
  });

  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = makeNode();
    }
    createGain() {
      return makeNode();
    }
    createOscillator() {
      counts.oscillators++;
      return makeNode();
    }
    createBiquadFilter() {
      return makeNode();
    }
    createBufferSource() {
      counts.buffers++;
      return makeNode();
    }
    createDynamicsCompressor() {
      return makeNode();
    }
    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
  }

  const makeClassList = () => ({
    toggle: () => {},
    add: () => {},
    remove: () => {},
    contains: () => false,
  });

  const elements = new Map();
  const listeners = new Map();

  const canvasContext = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => {
            counts.gradients++;
            return gradient;
          };
        }
        if (prop === 'createPattern') return () => null;
        if (prop === 'measureText') return () => ({ width: 42 });
        if (prop === 'fill') return () => counts.fill++;
        if (prop === 'fillRect') return () => counts.fillRect++;
        if (prop === 'stroke' || prop === 'strokeRect' || prop === 'strokeText') {
          return () => counts.stroke++;
        }
        if (prop === 'arc') return () => counts.arc++;
        if (prop in target) return target[prop];
        return () => undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );

  const makeElement = (id) => {
    const element = {
      id,
      textContent: '',
      innerHTML: '',
      style: { setProperty: () => {} },
      classList: makeClassList(),
      clientWidth: 1280,
      clientHeight: 720,
      width: 0,
      height: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      focus: () => {},
      appendChild: () => {},
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      getContext: () => canvasContext,
    };
    elements.set(id, element);
    return element;
  };

  const canvas = makeElement('game');

  const documentStub = {
    getElementById: (id) => elements.get(id) ?? makeElement(id),
    createElement: () => makeElement('created'),
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: makeClassList() },
    hidden: false,
  };

  let rafId = 0;
  let pendingFrame = null;
  let nowMs = 0;

  const windowStub = {
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    requestAnimationFrame: (cb) => {
      pendingFrame = cb;
      counts.raf++;
      return ++rafId;
    },
    cancelAnimationFrame: () => {},
    AudioContext: MockAudioContext,
    performance: { now: () => nowMs },
  };

  const store = new Map();
  const localStorageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const previous = {};
  for (const key of [
    'window',
    'document',
    'localStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'performance',
    'matchMedia',
    'location',
    'AudioContext',
  ]) {
    previous[key] = globalThis[key];
  }

  globalThis.window = windowStub;
  globalThis.document = documentStub;
  globalThis.localStorage = localStorageStub;
  globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
  globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;
  globalThis.performance = windowStub.performance;
  globalThis.matchMedia = windowStub.matchMedia;
  globalThis.AudioContext = MockAudioContext;
  globalThis.location = { search: '', href: 'http://localhost/', reload: () => {} };

  return {
    counts,
    elements,
    listeners,
    store,
    canvas,
    /** Advance time by `dtMs` and run the frame callback that was queued. */
    tick(dtMs = 16.6) {
      nowMs += dtMs;
      const cb = pendingFrame;
      pendingFrame = null;
      if (cb) cb(nowMs);
      return nowMs;
    },
    hasFrame() {
      return pendingFrame !== null;
    },
    fire(name, event = {}) {
      for (const fn of listeners.get(name) ?? []) fn(event);
    },
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

