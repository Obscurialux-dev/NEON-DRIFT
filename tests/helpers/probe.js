/**
 * Test helper: play a seed with the autopilot and record every hazard group the
 * generator produced, plus every charge pad it offered. Groups are keyed the way
 * the generator emits them (all hazards of one pattern share a `group` id), so
 * one record == one reflex. A pad carries the `group` of the pattern it leads
 * into, which is what lets the validator check its runway.
 */
import { CONFIG, GROUND_Y, PLAYER, SPAWN } from '../../src/config.js';
import { createAutopilot, autopilotInput } from '../../src/game/autopilot.js';
import { createGameState, stepGame, drainEvents } from '../../src/game/state.js';

export const DT = CONFIG.fixedStep;
/** A slide/duck needs this much warning (seconds of travel). */
export const SLIDE_LEAD = 0.34;

export function recordLevel(seed, targetMetres = 2600) {
  const state = createGameState({ seed });
  const bot = createAutopilot();
  const groups = new Map();
  const pads = new Map();

  while (!state.dead && state.metres < targetMetres) {
    for (const h of state.hazards) {
      let g = groups.get(h.group);
      if (!g) {
        g = {
          group: h.group,
          speed: h.speed,
          diff: h.diff,
          hazards: [],
          kinds: new Set(),
          avoid: new Set(),
          minX: Infinity,
          maxX2: -Infinity,
          maxTop: 0,
        };
        groups.set(h.group, g);
      }
      if (g.hazards.length < 12) {
        g.hazards.push({ kind: h.kind, x: h.x, x2: h.x2, w: h.w, h: h.h, y: h.y });
      }
      g.kinds.add(h.kind);
      g.avoid.add(h.avoid);
      g.minX = Math.min(g.minX, h.x);
      g.maxX2 = Math.max(g.maxX2, h.x2);
      g.maxTop = Math.max(g.maxTop, GROUND_Y - h.y);
    }
    for (const pad of state.pads) {
      if (pads.has(pad.id)) continue;
      pads.set(pad.id, {
        id: pad.id,
        kind: pad.kind,
        cost: pad.cost,
        x: pad.x,
        x2: pad.x2,
        w: pad.w,
        group: pad.group,
      });
    }

    const input = autopilotInput(bot, state, DT);
    stepGame(state, DT, input);
    drainEvents(state);
  }

  return {
    state,
    groups: [...groups.values()].sort((a, b) => a.minX - b.minX),
    pads: [...pads.values()].sort((a, b) => a.x - b.x),
    placed: state.spawner.placed,
  };
}

/** Height of a full jump `t` seconds after take-off. */
export const arcHeight = (t) => PLAYER.jumpVelocity * t - 0.5 * PLAYER.gravity * t * t;

/**
 * Can a *single* jump started from the ground clear a hazard of `span` width and
 * `top` height at `speed`? Solves the window during which the arc is above the
 * hazard and compares it with the span.
 */
export function singleJumpClears(span, top, speed, clearanceMargin = 4) {
  const clearance = top + clearanceMargin;
  const disc = PLAYER.jumpVelocity ** 2 - 2 * PLAYER.gravity * clearance;
  if (disc <= 0) return false;
  const root = Math.sqrt(disc);
  const tEnter = (PLAYER.jumpVelocity - root) / PLAYER.gravity;
  const tExit = (PLAYER.jumpVelocity + root) / PLAYER.gravity;
  return span <= (tExit - tEnter) * speed;
}

export { SPAWN };
