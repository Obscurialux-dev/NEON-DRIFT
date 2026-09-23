/**
 * Unified input: keyboard, mouse and touch.
 *
 * The simulation only ever sees "is jump held / is down held", so every source
 * (key, tap, swipe, on-screen button) is folded into those two booleans. Taps and
 * swipes are turned into short *pulses* so a quick tap still produces a jump.
 */
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyK', 'Numpad8'];
const DOWN_KEYS = ['ArrowDown', 'KeyS', 'KeyJ', 'Numpad2'];

/** How long a tap/swipe keeps the virtual button held (seconds). */
const TAP_PULSE = 0.16;
const SWIPE_PULSE = 0.34;
const SWIPE_MIN = 26;

export function createInput(canvas, { onAction } = {}) {
  const keys = new Set();
  const pointers = new Map();
  let jumpPulse = 0;
  let downPulse = 0;
  let time = 0;

  const state = {
    jump: false,
    down: false,
    /** Set by the UI layer so touch buttons can feed the same pipeline. */
    touchJump: false,
    touchDown: false,
  };

  const action = (name, event) => {
    if (onAction) onAction(name, event);
  };

  /* ------------------------------------------------------------ keyboard */
  const onKeyDown = (event) => {
    const code = event.code;
    if (JUMP_KEYS.includes(code) || DOWN_KEYS.includes(code)) {
      event.preventDefault();
      if (!event.repeat) {
        if (JUMP_KEYS.includes(code)) jumpPulse = Math.max(jumpPulse, 0.001);
        action('press', event);
      }
    }
    if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') action('confirm', event);
    if (code === 'Escape' || code === 'KeyP') action('pause', event);
    if (code === 'KeyR') action('restart', event);
    if (code === 'KeyM') action('mute', event);
    if (code === 'ArrowUp' || code === 'KeyW') action('up', event);
    if (code === 'ArrowDown' || code === 'KeyS') action('down', event);
    if (code === 'ArrowLeft' || code === 'KeyA') action('left', event);
    if (code === 'ArrowRight' || code === 'KeyD') action('right', event);
    keys.add(code);
  };

  const onKeyUp = (event) => {
    keys.delete(event.code);
    if (JUMP_KEYS.includes(event.code)) jumpPulse = 0;
    if (DOWN_KEYS.includes(event.code)) downPulse = 0;
  };

  /* ------------------------------------------------------------- pointer */
  const onPointerDown = (event) => {
    if (event.target !== canvas) return;
    canvas.focus?.();
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      down: true,
    });
    if (event.pointerType === 'mouse') {
      // Mouse click = jump, right click = duck.
      if (event.button === 2) downPulse = SWIPE_PULSE;
      else jumpPulse = TAP_PULSE;
      action('press', event);
      action('confirm', event);
    } else {
      action('press', event);
      action('confirm', event);
    }
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX;
    p.y = event.clientY;
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    if (Math.hypot(dx, dy) > SWIPE_MIN) {
      p.moved = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy < 0) jumpPulse = SWIPE_PULSE;
        else downPulse = SWIPE_PULSE;
      } else {
        jumpPulse = SWIPE_PULSE;
      }
      p.startX = p.x;
      p.startY = p.y;
    }
  };

  const onPointerUp = (event) => {
    const p = pointers.get(event.pointerId);
    if (p) {
      if (!p.moved && event.pointerType !== 'mouse') {
        // A plain tap is a jump.
        jumpPulse = TAP_PULSE;
      }
      pointers.delete(event.pointerId);
    }
    if (event.target === canvas) event.preventDefault();
  };

  const onBlur = () => {
    keys.clear();
    pointers.clear();
    jumpPulse = 0;
    downPulse = 0;
  };

  /* ------------------------------------------------------------ plumbing */
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    state,
    /** Call once per rendered frame with the frame delta. */
    update(dt) {
      time += dt;
      jumpPulse = Math.max(0, jumpPulse - dt);
      downPulse = Math.max(0, downPulse - dt);
      const keyJump = JUMP_KEYS.some((k) => keys.has(k)) || state.touchJump;
      const keyDown = DOWN_KEYS.some((k) => keys.has(k)) || state.touchDown;
      state.jump = keyJump || jumpPulse > 0;
      state.down = keyDown || downPulse > 0;
      return state;
    },
    snapshot() {
      return { jump: state.jump, down: state.down };
    },
    release() {
      onBlur();
      state.jump = false;
      state.down = false;
      state.touchJump = false;
      state.touchDown = false;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
