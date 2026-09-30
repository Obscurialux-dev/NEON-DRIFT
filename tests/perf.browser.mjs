/**
 * Browser performance harness for NEON DRIFT.
 *
 *   npm run perf                 # all scenarios
 *   npm run perf -- --label before
 *   npm run perf -- --extra adaptive=0    # extra query args on every page
 *   PERF_SECONDS=20 npm run perf
 *
 * Boots the real static server + Chromium via Playwright and measures the live
 * frame loop (rAF deltas) plus the in-app profiler (`?debug=1`) at the four
 * environments the optimisation brief calls out: desktop 1280x720, desktop
 * high-DPI, mobile landscape and mobile portrait — and once more for a long
 * autopiloted session.
 *
 * Every scenario is played, never left on an idle game-over screen: builds that
 * expose the `__neonDrift.autopilot` debug hook drive themselves, older ones get
 * restarted whenever the runner dies. A sample that still ends with a dead
 * runner is retried, so the printed numbers always describe live gameplay.
 *
 * Prints a table, and dumps JSON to /tmp/neon-drift-perf-<label>.json so a
 * before/after pair can be diffed.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(process.env.SMOKE_PORT || 5298);
const BASE = `http://127.0.0.1:${PORT}`;
const LABEL = arg('label', 'run');
const SECONDS = Number(arg('seconds', process.env.PERF_SECONDS || 10));
const LONG_SECONDS = Number(arg('long', process.env.PERF_LONG_SECONDS || 40));

/**
 * Extra query parameters for every measured page, e.g.
 *   npm run perf -- --extra adaptive=0     (pin the render scale)
 *   npm run perf -- --extra quality=low
 * The debug profiler is always on; everything measured is therefore the real
 * game loop plus a handful of `performance.now()` calls.
 */
const EXTRA = arg('extra', process.env.PERF_EXTRA || '').replace(/^[?&]/, '');
const QUERY = EXTRA ? `debug=1&${EXTRA}` : 'debug=1';

/* --------------------------------------------------------------- scenarios */

/**
 * Every scenario plays: an idle game-over screen costs nothing to render, so a
 * run that dies early measures an empty world. Where the build exposes
 * `__neonDrift.autopilot` (the debug bot) it drives the run; older builds get
 * restarted on death instead — see the setup block below.
 */
const SCENARIOS = [
  {
    id: 'desktop-1280x720',
    cssW: 1280,
    cssH: 720,
    dsf: 1,
    seconds: SECONDS,
    autopilot: true,
    note: 'baseline reference',
  },
  {
    id: 'desktop-hidpi',
    cssW: 1600,
    cssH: 900,
    dsf: 2,
    seconds: SECONDS + 6,
    warmup: 6000,
    autopilot: true,
    note: 'DPR 2 laptop panel',
  },
  {
    id: 'mobile-landscape',
    cssW: 844,
    cssH: 390,
    dsf: 3,
    mobile: true,
    seconds: SECONDS,
    autopilot: true,
    note: 'phone, 3x DPR',
  },
  {
    id: 'mobile-portrait',
    cssW: 390,
    cssH: 844,
    dsf: 3,
    mobile: true,
    seconds: SECONDS,
    autopilot: true,
    note: 'phone held upright',
  },
  {
    id: 'long-session',
    cssW: 1280,
    cssH: 720,
    dsf: 1,
    autopilot: true,
    seconds: LONG_SECONDS,
    sampleTail: 12,
    warmup: 8000,
    note: 'autopiloted run, late-game speed',
  },
];

/* --------------------------------------------------------------- server */

const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

let serverUp = false;
for (let i = 0; i < 60 && !serverUp; i++) {
  try {
    serverUp = (await fetch(BASE, { method: 'HEAD' })).ok;
  } catch {
    await delay(100);
  }
}
if (!serverUp) {
  console.error(`static server never came up on ${BASE}`);
  server.kill('SIGTERM');
  process.exit(1);
}

/* -------------------------------------------------------------- browser */

const results = [];
let browser;

try {
  browser = await chromium.launch();
} catch (error) {
  console.error(`Could not launch Chromium: ${error.message}`);
  console.error('Install the browser binary with: npx playwright install chromium');
  server.kill('SIGTERM');
  process.exit(2);
}

/** rAF sampler + profiler snapshot, run inside the page. */
const sampleFrames = (page, { seconds, tail }) =>
  page.evaluate(
    async ({ seconds, tail }) => {
      const app = globalThis.__neonDrift;
      const deltas = [];
      let peakParticles = 0;
      const total = seconds * 1000;
      const windowStart = total - Math.max(tail, seconds) * 1000;
      let last = performance.now();
      const start = last;
      await new Promise((resolve) => {
        const tick = (now) => {
          const dt = now - last;
          last = now;
          const t = now - start;
          if (t >= windowStart) {
            deltas.push(dt);
            // Live-particle high-water mark: the instantaneous count is often 0
            // (the bot is mid-air, so nothing is emitting), the peak is what the
            // renderer actually had to walk.
            const live = app.perf?.metrics?.particles ?? 0;
            if (live > peakParticles) peakParticles = live;
          }
          if (t < total) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      deltas.sort((a, b) => a - b);
      const pick = (q) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * q))] ?? 0;
      const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
      // `perf` only exists in builds with the profiler (and only reports when
      // ?debug=1 is on), so older builds still produce frame-time numbers.
      const snap = app.perf
        ? app.perf.snapshot()
        : { frameMs: 0, framePeak: 0, fps: 0, total: 0, metrics: {}, sections: {} };
      const quality = app.quality ?? null;
      return {
        frames: deltas.length,
        frameMs: mean,
        p50: pick(0.5),
        p95: pick(0.95),
        p99: pick(0.99),
        worst: deltas[deltas.length - 1] ?? 0,
        fps: 1000 / Math.max(0.001, mean),
        peakParticles,
        profiler: snap,
        quality,
        render: {
          backingW: document.getElementById('game').width,
          backingH: document.getElementById('game').height,
          cssW: document.getElementById('game').clientWidth,
          cssH: document.getElementById('game').clientHeight,
          dpr: globalThis.devicePixelRatio,
        },
        game: {
          scene: app.scene,
          metres: app.state.metres,
          speed: app.state.speed,
          hazards: app.state.hazards.length,
          pickups: app.state.pickups.length,
          dead: app.state.dead,
        },
      };
    },
    { seconds, tail: tail ?? seconds },
  );

try {
  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({
      viewport: { width: scenario.cssW, height: scenario.cssH },
      deviceScaleFactor: scenario.dsf,
      isMobile: !!scenario.mobile,
      hasTouch: !!scenario.mobile,
    });
    const page = await context.newPage();
    const errors = [];
    let crashed = false;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('crash', () => {
      crashed = true;
    });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // One hostile environment (a software-rendered 3x-DPR phone viewport is the
    // usual suspect) must not take the whole benchmark down with it, so each
    // scenario is isolated: it either produces a row or it reports why not.
    try {
      await page.goto(`${BASE}/?${QUERY}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!globalThis.__neonDrift, null, { timeout: 10000 });
      await page.evaluate(
        ({ autopilot }) => {
          const app = globalThis.__neonDrift;
          app.start();
          if (!autopilot) return;
          if (typeof app.autopilot === 'function') {
            app.autopilot(true);
            return;
          }
          // Older builds have no autopilot hook: keep the session alive by
          // restarting whenever the untouched runner dies, so the workload still
          // resembles a long run. The poll is fast on purpose — every millisecond
          // spent on the game-over screen is a millisecond of cheating.
          globalThis.__restart = setInterval(() => {
            if (app.state.dead) app.start();
          }, 300);
        },
        { autopilot: !!scenario.autopilot },
      );
      // Warm-up: let caches, JIT, the adaptive controller and the first gameplay
      // seconds settle before anything is measured.
      await delay(scenario.warmup ?? 4000);
      // A run should be sampled while it is actually running: a dead runner sits
      // on a frozen world, which is both an easier and a far less representative
      // workload. Restart, and retry the sample if the bot dies mid-window.
      const revive = () =>
        page.evaluate(() => {
          const app = globalThis.__neonDrift;
          if (app.state.dead) app.start();
        });

      await revive();

      let sample = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        sample = await sampleFrames(page, { seconds: scenario.seconds, tail: scenario.sampleTail });
        if (!sample.game.dead) break;
        if (attempt < 2) await revive();
      }
      results.push({ ...scenario, ...sample, errors });

      const r = results[results.length - 1];
      const quality = r.quality ? `  bias ${r.quality.bias}` : '';
      console.log(
        `${r.id.padEnd(20)} fps ${r.fps.toFixed(1).padStart(5)}  frame ${r.frameMs.toFixed(2)}ms  ` +
          `p95 ${r.p95.toFixed(2)}  p99 ${r.p99.toFixed(2)}  ` +
          `render ${r.render.backingW}x${r.render.backingH}  ` +
          `pk-particles ${String(r.peakParticles).padStart(3)}  entities ${r.profiler.metrics.entities}  ` +
          `${r.game.dead ? 'DEAD' : `alive ${Math.round(r.game.metres)}m`}${quality}`,
      );
      if (errors.length) console.log(`  ! runtime errors: ${errors.slice(0, 3).join(' | ')}`);
    } catch (error) {
      const why = crashed ? 'the renderer crashed' : error.message;
      console.log(`${scenario.id.padEnd(20)} SKIPPED — ${why}`);
      results.push({ ...scenario, failed: why, errors });
    }

    await context.close().catch(() => {});
  }
} catch (error) {
  console.error(error);
} finally {
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
}

/* --------------------------------------------------------------- report */

const out = `/tmp/neon-drift-perf-${LABEL}.json`;
await writeFile(out, JSON.stringify({ label: LABEL, when: new Date().toISOString(), results }, null, 2));

console.log('\nstage breakdown (smoothed ms/frame, from ?debug=1 profiler):');
for (const r of results) {
  // Builds without the profiler (and scenarios that never produced a sample)
  // simply have no breakdown to show.
  if (!r.profiler?.sections || !Object.keys(r.profiler.sections).length) {
    console.log(`  ${r.id.padEnd(20)} ${r.failed ? `skipped — ${r.failed}` : 'no profiler in this build'}`);
    continue;
  }
  const top = Object.entries(r.profiler.sections)
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 7)
    .map(([k, v]) => `${k} ${v.ms.toFixed(1)}`)
    .join(' · ');
  console.log(`  ${r.id.padEnd(20)} total ${r.profiler.total.toFixed(1)}ms   ${top}`);
}

console.log(`\nJSON written to ${out}`);
process.exit(0);
