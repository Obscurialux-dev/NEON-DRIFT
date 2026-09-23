/**
 * Player physics: run, variable-height jump, double jump, slide, fast fall.
 *
 * The player's world position advances every tick (the camera follows), which
 * keeps a single, simple source of truth for "how far along the level are we".
 */
import { PLAYER, GROUND_Y } from '../config.js';
import { clamp } from '../core/math.js';
import { groundSurfaceAt } from './collision.js';

export function createPlayer() {
  return {
    x: 0,
    /** Feet position. */
    y: GROUND_Y,
    vy: 0,
    w: PLAYER.standW,
    h: PLAYER.standH,

    alive: true,
    onGround: true,
    jumpsLeft: PLAYER.doubleJumps,
    sliding: false,
    slideTimer: 0,
    slideLock: 0,
    slideCooldown: 0,

    coyote: PLAYER.coyoteTime,
    buffer: 0,
    /** True between take-off and either apex-cut or landing. */
    rising: false,
    fastFall: false,

    /**
     * The world speed the current airborne arc was launched with. `player.x`
     * advances at `state.speed`, so a jump's reach is `speed x airtime` — the
     * exact quantity the level generator sizes gaps against. Latching it means
     * a jump that looks correct at take-off can never fall short because a
     * bonus expired mid-flight.
     */
    arcSpeed: 0,

    /** Seconds since the player left the ground (drives the run animation). */
    airTime: 0,
    runPhase: 0,
    invuln: 0,
    hitStop: 0,
    /** Visual timers, updated here so rendering stays read-only. */
    landFx: 0,
    jumpFx: 0,
    spin: 0,
    wasSliding: false,
    prevJump: false,
    prevDown: false,
  };
}

export function resetPlayer(player, x = 0, y = GROUND_Y) {
  const fresh = createPlayer();
  Object.assign(player, fresh, { x, y });
  return player;
}

/** Current hitbox size for the player's pose. */
function applyPose(player) {
  if (player.sliding) {
    player.w = PLAYER.slideW;
    player.h = PLAYER.slideH;
  } else {
    player.w = PLAYER.standW;
    player.h = PLAYER.standH;
  }
}

/**
 * Advance the player by `dt` seconds.
 * `input` is `{ jump: boolean, down: boolean }` (button *held*, edges are derived).
 */
export function updatePlayer(player, state, dt, input) {
  if (!player.alive) {
    player.hitStop = Math.max(0, player.hitStop - dt);
    return;
  }

  // --- hit-stop: brief freeze for impact weight ---------------------------
  if (player.hitStop > 0) {
    player.hitStop -= dt;
    return;
  }

  player.invuln = Math.max(0, player.invuln - dt);
  player.slideCooldown = Math.max(0, player.slideCooldown - dt);
  player.landFx = Math.max(0, player.landFx - dt * 4);
  player.jumpFx = Math.max(0, player.jumpFx - dt * 5);
  player.spin = Math.max(0, player.spin - dt * 4.2);

  const jumpPressed = input.jump && !player.prevJump;
  const downHeld = input.down;
  player.prevJump = input.jump;
  player.prevDown = downHeld;

  // --- buffer + coyote ---------------------------------------------------
  if (jumpPressed) player.buffer = PLAYER.jumpBuffer;
  player.buffer = Math.max(0, player.buffer - dt);

  if (player.onGround) player.coyote = PLAYER.coyoteTime;
  else player.coyote = Math.max(0, player.coyote - dt);

  // --- slide -------------------------------------------------------------
  // Sliding stays available as long as "down" is held on the ground (so a held
  // input that started as a fast-fall still slides on the landing frame), and
  // the slide is held open while the key stays down.
  const canSlide = player.slideCooldown <= 0 && !player.sliding;
  if (downHeld && player.onGround && canSlide) {
    player.sliding = true;
    player.slideTimer = PLAYER.slideDuration;
    player.slideLock = 0.16;
    state.events.push({ type: 'slide', x: player.x, y: player.y });
  }

  if (player.sliding) {
    if (downHeld && player.onGround) {
      // Holding the key keeps the slide alive; never blink back to standing.
      player.slideTimer = Math.max(player.slideTimer, PLAYER.slideDuration * 0.45);
    } else {
      player.slideTimer -= dt;
    }
    player.slideLock = Math.max(0, player.slideLock - dt);
    const releasedEarly = player.slideLock <= 0 && !downHeld;
    const airborne = player.airTime > 0.02;
    if (player.slideTimer <= 0 || releasedEarly || airborne) {
      player.sliding = false;
      player.slideCooldown = PLAYER.slideCooldown;
    }
  }
  applyPose(player);

  // --- jumping -----------------------------------------------------------
  const wantsJump = player.buffer > 0;
  if (wantsJump && (player.onGround || player.coyote > 0)) {
    player.vy = -PLAYER.jumpVelocity;
    player.onGround = false;
    player.coyote = 0;
    player.buffer = 0;
    player.jumpsLeft = PLAYER.doubleJumps;
    player.rising = true;
    player.sliding = false;
    player.airTime = 0.0001;
    player.jumpFx = 1;
    applyPose(player);
    state.events.push({ type: 'jump', x: player.x, y: player.y });
  } else if (wantsJump && player.jumpsLeft > 0 && !player.onGround) {
    player.vy = -PLAYER.doubleJumpVelocity;
    player.jumpsLeft -= 1;
    player.buffer = 0;
    player.rising = true;
    player.spin = 1;
    state.events.push({ type: 'doubleJump', x: player.x, y: player.y });
  }

  // Variable jump height: releasing the key while rising clips the arc.
  if (player.rising && !input.jump && player.vy < 0) {
    player.vy *= PLAYER.jumpCut;
    player.rising = false;
  }
  if (player.vy >= 0) player.rising = false;

  // --- gravity -----------------------------------------------------------
  player.fastFall = downHeld && !player.onGround;
  const gravity = player.fastFall ? PLAYER.gravityFast : PLAYER.gravity;
  player.vy = Math.min(player.vy + gravity * dt, PLAYER.maxFallSpeed);

  // --- integrate ---------------------------------------------------------
  player.x += state.speed * dt;
  const wasGrounded = player.onGround;
  player.y += player.vy * dt;

  const surface = groundSurfaceAt(state.gaps, player.x);
  if (surface !== Infinity && player.y >= surface && player.vy >= 0) {
    player.y = surface;
    player.vy = 0;
    if (!wasGrounded && player.airTime > 0.12) {
      player.landFx = 1;
      state.events.push({ type: 'land', x: player.x, y: player.y });
    }
    player.onGround = true;
    player.fastFall = false;
    player.jumpsLeft = PLAYER.doubleJumps;
    player.airTime = 0;

    // A "down" key that was held through the landing must slide *this* tick,
    // otherwise the player would stand up for a frame right under an overhang.
    if (downHeld && !player.sliding && player.slideCooldown <= 0) {
      player.sliding = true;
      player.slideTimer = PLAYER.slideDuration;
      player.slideLock = 0.16;
      state.events.push({ type: 'slide', x: player.x, y: player.y });
      applyPose(player);
    }
  } else {
    player.onGround = false;
    if (player.airTime === 0) player.airTime = 0.0001;
    else player.airTime += dt;
  }

  // Running animation speed scales with how fast the world is moving.
  const cadence = player.onGround ? 5.2 + state.speed / 150 : 2.4;
  player.runPhase += dt * cadence * (player.sliding ? 0.25 : 1);
  player.wasSliding = player.sliding;
}

/** Vertical clearance the current pose leaves (used by generation tests). */
export const playerClearance = (player) => player.h;
