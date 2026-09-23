/**
 * Ground + collision queries. Pure functions over plain data.
 */
import { GROUND_Y } from '../config.js';

/** The bit of the player that needs ground underneath it (a narrow foot box). */
export const FOOT_HALF = 12;

/**
 * Ground surface height under a world x position.
 * Returns `Infinity` when there is a hole (pit) there, meaning "nothing to land on".
 */
export function groundSurfaceAt(gaps, x) {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    if (x > g.x && x < g.x2) return Infinity;
  }
  return GROUND_Y;
}

/** True when the player currently has ground beneath their feet. */
export const playerSupported = (gaps, player) =>
  groundSurfaceAt(gaps, player.x) !== Infinity;

/** True when any part of the player's foot box is over a pit. */
export function footOverPit(gaps, player) {
  return groundSurfaceAt(gaps, player.x - FOOT_HALF) === Infinity;
}

/** Player hitbox in world space. `x` is the centre, `y` is the feet. */
export function playerRect(player, inset = 0) {
  const w = player.w - inset * 2;
  const h = player.h - inset;
  return { x: player.x - w * 0.5, y: player.y - h, w, h };
}

/** Centre point of the player (used for pickups / magnet maths). */
export const playerCentre = (player) => ({ x: player.x, y: player.y - player.h * 0.5 });
