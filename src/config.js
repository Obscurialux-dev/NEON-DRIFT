/**
 * NEON DRIFT — central tuning + shared constants.
 *
 * Everything gameplay-related lives here so the game can be tuned in one place.
 * This module is intentionally free of any DOM/browser references: the whole
 * `src/game/*` layer (and the test-suite) imports it inside plain Node.
 */

/** Virtual resolution. All gameplay math happens in these units. */
export const VIEW_W = 1280;
export const VIEW_H = 720;

/** Where the ground surface sits (world y grows downwards). */
export const GROUND_Y = 560;

/** Screen-space X of the player, as a fraction of the view width. */
export const PLAYER_ANCHOR_X = 0.3;

/* ------------------------------------------------------------------ player */

export const PLAYER = {
  standW: 44,
  standH: 64,
  slideW: 54,
  slideH: 32,

  /** Horizontal hitbox inset so near-misses feel generous rather than unfair. */
  forgiveness: 5,

  gravity: 3400,
  /** Gravity applied while "down" is held in the air (fast fall). */
  gravityFast: 5800,
  jumpVelocity: 1000,
  doubleJumpVelocity: 860,
  /** Multiply upward velocity when the jump key is released early. */
  jumpCut: 0.42,
  maxFallSpeed: 1700,

  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  doubleJumps: 1,

  /** Extra visuals only: how much the player stretches while launching. */
  stretch: 0.22,

  slideDuration: 0.78,
  slideCooldown: 0.1,
  /** Speed bonus while sliding (fraction). */
  slideSpeedBonus: 0.06,

  invulnAfterShield: 1.15,
  hitStop: 0.14,
};

/* ------------------------------------------------------------------- speed */

export const SPEED = {
  start: 430,
  /** px/s added per second of play. */
  ramp: 8.6,
  max: 1180,
  /** How much of the ramp is "eased" before applying it (keeps the early game calm). */
  rampDelay: 6,
  /** Extra speed from Overdrive. */
  overdriveBonus: 0.32,
};

/* ------------------------------------------------------------------ scoring */

/** World pixels per displayed metre. */
export const PX_PER_METRE = 42;

export const SCORE = {
  perMetre: 1,
  coin: 12,
  gem: 60,
  nearMiss: 5,
  /** Chain length needed for each extra multiplier step. */
  chainStep: 8,
  chainMax: 4,
  /** Seconds of no coin pickup before the chain decays. */
  chainTimeout: 3.2,
  /** Grace before a hit resets the chain to 1. */
  chainGrace: 1.5,
};

/* -------------------------------------------------------------- charge pads */

/**
 * Charge pads are the sink for the chain: the collectible value you have been
 * hoarding can be traded for a power-up by *sliding onto* a pad on the runway.
 *
 * Prices are deliberately not multiples of `chainStep`, so a cost reads as a
 * price rather than "exactly N multiplier steps". The cheap pad (magnet) pays
 * for itself if you keep collecting, which is what makes tier 1 an investment
 * decision rather than a pure cost.
 */
export const PAD = {
  prices: { magnet: 12, shield: 20, overdrive: 32 },
  /** Seconds of held "down" while grounded on the pad needed to complete a buy. */
  dwell: 0.12,
  /** A hold that started on the pad keeps charging this long after it ends. */
  grace: 0.22,
  /** How fast unfinished progress bleeds off once "down" is released. */
  decay: 3,
  /**
   * Pad length expressed in *seconds of travel* (then px-clamped), so it always
   * scales with speed: at any speed the pad is worth ~0.22 s of contact, which
   * comfortably contains the dwell. Runways are 0.78-0.92 s of travel, so the
   * lead-in and lead-out stay small enough to fit inside one.
   */
  window: 0.2,
  widthMin: 110,
  widthMax: 300,
  /** Difficulty gate per tier: the cheap "investment" pad shows up first. */
  minDiff: { magnet: 0, shield: 0.18, overdrive: 0.45 },
  weights: { magnet: 1, shield: 0.85, overdrive: 0.4 },
  /** Chance that an eligible runway actually receives a pad. */
  chance: 0.55,
  /** Pads only start showing up once the run is underway (seconds). */
  firstAt: 8,
  /** Minimum distance between two pads, in seconds of travel. */
  spacing: 7,
  /**
   * Clear of the previous group (long enough that a slide held for the last
   * overhang has ended) and before the next one. A pad reserves this much room
   * plus its own width, so the runway is widened rather than the rules bent.
   */
  leadIn: 0.4,
  /**
   * Lead-out matters more than it looks: a runner setting up the jump that
   * follows the pad takes off roughly half a jump arc early (~0.3 s of travel),
   * so a pad tucked right against its pattern would be flown over. This keeps
   * the pad comfortably grounded-accessible.
   */
  leadOut: 0.5,
  /** Extra jitter room inside the reservation, so pads do not line up. */
  slack: 0.12,
  /** Drawn strip thickness on the ground (world px). */
  band: 18,
};

/* ----------------------------------------------------------------- hazards */

/** Collision kinds. `avoid` describes the reflex that clears the hazard. */
export const HAZARD_KIND = {
  SPIKE: 'spike',
  CRATE: 'crate',
  OVERHANG: 'overhang',
  DRONE: 'drone',
  SAW: 'saw',
  PIT: 'pit',
};

/** `avoid`: 'jump' | 'slide' | 'gap' — used by the level validator and the test bot. */
export const HAZARD_META = {
  spike: { avoid: 'jump', lethal: true },
  crate: { avoid: 'jump', lethal: true },
  overhang: { avoid: 'slide', lethal: true },
  drone: { avoid: 'slide', lethal: true },
  saw: { avoid: 'jump', lethal: true },
  pit: { avoid: 'gap', lethal: true },
};

/* ------------------------------------------------------------------ pickups */

export const PICKUP_KIND = {
  COIN: 'coin',
  GEM: 'gem',
  SHIELD: 'shield',
  MAGNET: 'magnet',
  MULTIPLIER: 'multiplier',
  OVERDRIVE: 'overdrive',
};

export const POWERUPS = {
  shield: { label: 'SHIELD', duration: 9, color: '#66e0ff' },
  magnet: { label: 'MAGNET', duration: 9, color: '#c084fc' },
  multiplier: { label: 'x2 SCORE', duration: 11, color: '#ffd166' },
  overdrive: { label: 'OVERDRIVE', duration: 6, color: '#ff5d8f' },
};

export const MAGNET = {
  radius: 300,
  pull: 1500,
  /** Coins are "collected" within this distance of the player's centre. */
  collectRadius: 34,
  attractionFalloff: 0.45,
};

export const POWERUP_SPAWN = {
  /** Seconds. The first power-up always shows up fairly early. */
  firstAt: 14,
  min: 17,
  max: 26,
};

/* -------------------------------------------------------- level generation */

export const SPAWN = {
  /** Cull entities this far behind the camera. */
  cullBehind: 200,
  /** Keep the world generated this far ahead of the camera. */
  lookAhead: 1600,
  /** Reactions grace: seconds of travel guaranteed between hazard groups. */
  reaction: 0.92,
  /** Absolute minimum gap in world px. */
  minGap: 320,
  /** A pattern's total hazard span must fit inside this fraction of a jump arc. */
  jumpFit: 0.66,
  /** Difficulty (0..1) is reached at this distance in metres. */
  rampMetres: 2000,
};

export const BIOME = {
  /** Metres per palette shift. */
  length: 480,
  /** How long (metres) a cross-fade between biomes lasts. */
  blend: 90,
};

/* ------------------------------------------------------------------- config */

export const CONFIG = {
  /** Physics tick. High enough to feel identical on 60 / 144 / 240 Hz displays. */
  fixedStep: 1 / 120,
  /** Never simulate more than this many ticks in a single animation frame. */
  maxStepsPerFrame: 8,
  storageKey: 'neon-drift.save.v1',
  particles: { max: 900 },
};
