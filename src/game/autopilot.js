/**
 * Tiny reflex-based autopilot.
 *
 * It is used in two places:
 *   - `tests/*` to prove every generated level is survivable.
 *   - the title screen, where it plays the game as a live attract-mode demo.
 *
 * It only ever reads the public simulation state, so it doubles as living
 * documentation of how the hazards are meant to be answered.
 */
import { GROUND_Y, PLAYER } from '../config.js';
import { jumpDistanceFor } from './spawner.js';

/** Total air time of a full jump. */
export const JUMP_AIRTIME = (2 * PLAYER.jumpVelocity) / PLAYER.gravity;

export function createAutopilot() {
  return { jumpHold: 0 };
}

/**
 * @returns `{ jump, down }` — the input for this tick.
 */
export function autopilotInput(bot, state, dt) {
  const input = { jump: false, down: false };
  const p = state.player;
  bot.jumpHold = Math.max(0, bot.jumpHold - dt);
  if (state.dead) return input;

  // Landing always clears the hold, which guarantees a fresh press edge for the
  // next jump (a held key would otherwise never produce another edge). Once the
  // arc is descending the hold is useless too, so it is released early — that
  // keeps the double jump available as an escape.
  if (p.onGround || p.vy > 0) bot.jumpHold = 0;

  const speed = Math.max(state.speed, 1);
  const arc = jumpDistanceFor(speed);

  // Nearest hazard still ahead of (or overlapping) the player.
  let target = null;
  for (const h of state.hazards) {
    if (h.dead || h.passed) continue;
    if (h.x2 < p.x - 30) continue;
    if (!target || h.x < target.x) target = h;
  }

  if (target) {
    const dist = target.x - p.x;

    if (target.avoid === 'slide') {
      // Duck before arrival; if still airborne, hold down to drop fast so the
      // landing frame itself starts the slide.
      if (dist <= speed * 0.34) input.down = true;
    } else if (target.avoid === 'gap') {
      const takeoff = arc - target.w - 34;
      if (p.onGround && dist <= takeoff && dist > -24 && bot.jumpHold <= 0) {
        bot.jumpHold = JUMP_AIRTIME - 0.02;
      } else if (!p.onGround && p.jumpsLeft > 0 && p.vy > 0 && bot.jumpHold <= 0) {
        // Safety net: only panic if we are actually going to land in the hole.
        const drop = GROUND_Y - p.y;
        const fall = (-p.vy + Math.sqrt(p.vy * p.vy + 2 * PLAYER.gravity * drop)) / PLAYER.gravity;
        const landingX = p.x + speed * fall;
        if (landingX < target.x2 - 10 && p.y > GROUND_Y - 220) {
          bot.jumpHold = JUMP_AIRTIME * 0.75;
        }
      }
    } else {
      const takeoff = Math.max(70, arc * 0.5 - target.w * 0.5);
      if (dist <= takeoff && dist > -16 && bot.jumpHold <= 0) {
        if (p.onGround || p.coyote > 0) {
          bot.jumpHold = JUMP_AIRTIME - 0.02;
        } else if (p.jumpsLeft > 0 && (p.vy > 0 || p.y > GROUND_Y - 150)) {
          // Airborne and running out of arc: spend the double jump.
          bot.jumpHold = JUMP_AIRTIME * 0.7;
        }
      }
    }
  }

  if (bot.jumpHold > 0) input.jump = true;
  return input;
}
