# NEON DRIFT

A procedurally generated neon/cyberpunk endless runner. Zero external assets — every
skyline, billboard, hazard and pickup is drawn with canvas primitives, and every sound
is synthesised with the Web Audio API.

## Run it

```bash
npm start            # static server on http://127.0.0.1:5173
PORT=8080 npm start  # ...or pick a port
```

Then open <http://127.0.0.1:5173>. Add `?debug=1` for an on-canvas FPS/entity readout.

**Controls** — `SPACE` / `↑` / `W` (tap on mobile) to jump, press again in mid-air to double
jump, hold `↓` / `S` (or swipe down) to slide under drones and barriers, `ESC` / `P` to
pause, `R` to retry from the game-over screen, `M` to mute.

## Spending your chain: charge pads

Coins feed a **chain**, and the chain does two things. It sets your score multiplier
(`+1` tier every 8 chain, up to `x5`), and it is the **currency you spend on charge
pads**.

A charge pad is a lit strip on the runway that sells one power-up — magnet (12), shield
(20) or overdrive (32). It advertises both its payload and its price, and only lights up
when you can afford it. To buy it, **hold `↓` on the pad** (a 0.12 s dwell, with a short
grace window). The price comes straight out of your chain, so a purchase can drop you a
multiplier tier or two.

That is the decision: cash in for safety or tempo now, or keep the chain and keep scoring
faster. Because the multiplier multiplies pickup income but *not* distance, spending chain
always has a real cost — and because the chain is also your wallet, hoarding has a real
risk.

Buying is a slide, so the generator only places pads on runways leading into a **jump**
pattern, far enough past the previous hazard that any slide you were holding has already
ended. A pad is therefore never something you are forced to buy; it reserves its own
runway space, and `tests/level.test.js` asserts all of that plus the fact that buying
never kills the autopilot. Note that holding `↓` *in mid-air* is still the pre-existing
fast-fall — the pad only completes when you are planted on it.

## Layout

```
index.html            DOM shell: canvas + title/pause/game-over overlays
server.mjs            zero-dependency static file server
src/main.js           bootstrap, fixed-timestep loop, scenes, event -> fx/audio bridge
src/config.js         every tunable: speed ramp, player physics, spawn rules, palettes
src/core/             math + seeded rng, input (keyboard/pointer/touch), localStorage save, frame profiler
src/game/             player, procedural spawner, collision, autopilot, world state
src/render/           background, entities, particles, HUD, theme, cached glow sprites, quality presets
src/audio/            Web Audio synthesiser: SFX + procedural music whose intensity tracks speed
src/ui/               overlay screens controller and touch pad
```

## Performance

The frame loop renders a fixed 1280x720 *virtual* view into a backing store whose device
resolution is chosen at boot and can shrink or grow while you play:

- **Quality presets** (`high` / `medium` / `low`) pick a hard DPR cap and a ceiling on
  `canvas.width * canvas.height`, so a 3x-DPR phone never rasterises megapixels of glow it
  cannot display.
- **The adaptive controller** watches the smoothed frame time in 60-frame windows and steps
  the render scale down (by up to 0.88x, floored at 0.55x) when frames overrun, and back up
  when there is headroom. A hysteresis band around 60 fps stops it flapping.
- **Static work is baked once** — sky, starfield, vignette, skyline strips and every glow
  halo live in cached offscreen canvases or sprites (`src/render/glow.js`), so a frame is
  mostly blits. `backdrop-filter` is deliberately absent from the overlay CSS: it makes the
  compositor re-blur the canvas behind every always-present `.screen` layer.

URL overrides, handy when you want to measure or A/B a device by hand:

```
?debug=1            on-canvas frame time, per-stage cost, render resolution and workload
?quality=low        force a preset (high | medium | low)
?scale=0.75         pin the resolution multiplier (also disables the adaptive loop)
?adaptive=0         keep the preset's resolution, but stop the adaptive controller
```

### Measuring

```bash
npm run perf                              # desktop, hi-DPI, mobile x2, long session
npm run perf -- --label before            # writes /tmp/neon-drift-perf-before.json
npm run perf -- --extra adaptive=0        # extra query args on every measured page
PERF_SECONDS=20 npm run perf              # longer sampling windows
```

`tests/perf.browser.mjs` boots the real server and Chromium, drives every scenario with the
autopilot debug hook (`__neonDrift.autopilot(true)` — older builds are restarted on death
instead), and prints mean frame time with p95/p99 plus the profiler's stage breakdown.

## Tests

```bash
npm test             # headless Node suite (no dependencies)
npm run smoke        # real Chromium via Playwright
npm run smoke:firefox # real Firefox via geckodriver (no browser download needed)
npm run perf         # frame-time benchmark across desktop + mobile (see Performance above)
```

The Node suite covers the deterministic core (rng, math, player physics, world state,
save/load), validates generated levels by simulating thousands of metres with an
autopilot, checks the DOM/module wiring statically, and boots the *whole* app against DOM
and Web Audio stubs to exercise the loop, scene machine, renderer and audio scheduler.

The smoke tests drive the real game in a real browser through the real keyboard pipeline:
boot, title screen, attract-mode demo, scoring, jump, double jump, slide, pause/resume,
death, the game-over screen, localStorage persistence and restart.

## Design notes

- **Determinism where it matters** — only the level generator uses a seeded RNG, so a seed
  plus a fixed input stream reproduces a run exactly. Effects and audio use `Math.random`
  freely and never affect simulation state.
- **Readability at speed** — hazards telegraph their required reflex (jump / slide) and
  brighten as they approach, which matters at 1180 px/s.
- **Procedural level quality is tested** — the level validator asserts every spacing rule
  (jump clearance, pit widths, slide reaction runway, and that charge pads only appear
  where cashing in is voluntary) and that the autopilot survives — both while ignoring
  pads and while buying every one it can afford.
