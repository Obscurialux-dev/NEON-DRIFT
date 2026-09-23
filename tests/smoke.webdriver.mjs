/**
 * Real-browser smoke test driven through geckodriver + system Firefox.
 *
 *   npm run smoke:firefox
 *
 * Same intent as tests/smoke.browser.mjs (Playwright/Chromium) but it needs no
 * browser download: only geckodriver + Firefox (`sudo apt install firefox-geckodriver`).
 *
 * Note: Firefox runs WebDriver scripts inside a sandbox, so page state is
 * always reached through `window.*` (never `globalThis.*`).
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { launchFirefox } from './helpers/webdriver.js';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;

const fails = [];
const check = (ok, label, extra = '') => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    fails.push(label);
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

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

/* --------------------------------------------------------------- driver */

let driver;
try {
  driver = await launchFirefox();
} catch (error) {
  console.error(error.message);
  server.kill('SIGTERM');
  process.exit(2);
}

const PLAYER_FIELDS = ['onGround', 'sliding', 'jumpsLeft', 'alive', 'x', 'y'];

/** Small, JSON-safe projection of the live game state. */
const readState = () =>
  driver.eval((fields) => {
    const app = window.__neonDrift;
    const s = app.state;
    const out = {
      scene: app.scene,
      fps: app.fps,
      metres: s.metres,
      score: s.score,
      dead: s.dead,
    };
    for (const key of fields) out[key] = s.player[key];
    return out;
  }, [PLAYER_FIELDS]);

const scene = () => driver.eval(() => window.__neonDrift.scene);
const isVisible = (id) =>
  driver.eval((sel) => !document.getElementById(sel).classList.contains('hidden'), [id]);
const textOf = (id) => driver.eval((sel) => document.getElementById(sel).textContent, [id]);

/** Wait for a condition on the live player, with a labelled timeout message. */
const waitForPlayer = (expr, label, timeout = 3000) =>
  driver
    .waitFor(`const p = window.__neonDrift.state.player; return (${expr});`, {
      timeout,
      interval: 25,
    })
    .catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });

/** Clear the procedural field so input checks are not interrupted by hazards. */
const clearField = () =>
  driver.eval(() => {
    const state = window.__neonDrift.state;
    state.hazards.length = 0;
    state.gaps.length = 0;
    return true;
  });

/** If the run ended, start a fresh one so the next checks have a live player. */
const ensurePlaying = async () => {
  if (await driver.eval(() => window.__neonDrift.state.dead)) {
    await driver.waitFor(() => window.__neonDrift.scene === 'over', { timeout: 5000 });
  }
  if ((await scene()) !== 'playing') {
    await driver.tap('Space', 60);
    await driver.waitFor(() => window.__neonDrift.scene === 'playing', { timeout: 3000 });
  }
  await clearField();
};

try {
  await driver.goto(`${BASE}/?debug=1`);
  await driver.waitFor(() => !!window.__neonDrift, { timeout: 15_000 });

  // Collect runtime errors from here on. A boot error would have stopped the
  // debug surface above from ever appearing.
  await driver.eval(() => {
    window.__smokeErrors = [];
    window.addEventListener('error', (e) => window.__smokeErrors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) =>
      window.__smokeErrors.push(String(e.reason)),
    );
    return true;
  });
  await delay(400);

  /* ------------------------------------------------------------- boot */
  const canvas = await driver.eval(() => {
    const c = document.getElementById('game');
    return { w: c.clientWidth, h: c.clientHeight, bw: c.width, bh: c.height, dpr: devicePixelRatio };
  });
  check(canvas.w > 300 && canvas.h > 200, 'canvas is sized', JSON.stringify(canvas));
  check(canvas.bw >= canvas.w && canvas.bh >= canvas.h, 'canvas backing store matches the CSS size');
  check((await scene()) === 'title', 'boots into the title screen');
  check(await isVisible('screen-title'), 'the title overlay is shown');
  check((await isVisible('screen-over')) === false, 'the game-over overlay starts hidden');
  check(String(await textOf('title-best')).length > 0, 'the title screen shows a best score');

  /* ------------------------------------------------------ attract mode */
  const demoStart = await driver.eval(() => window.__neonDrift.demo.metres);
  await delay(1200);
  const demoNow = await driver.eval(() => window.__neonDrift.demo.metres);
  check(demoNow > demoStart, 'the attract-mode demo runner is moving', `${demoStart} -> ${demoNow}`);

  /* ---------------------------------------------------------- playing */
  await driver.tap('Space', 60);
  await driver.waitFor(() => window.__neonDrift.scene === 'playing', { timeout: 3000 });
  check(true, 'space starts a run');
  check((await isVisible('screen-title')) === false, 'the title overlay hides during play');

  let state = await readState();
  await delay(1500);
  const later = await readState();
  check(later.metres > state.metres, 'distance grows while playing', `${state.metres} -> ${later.metres}`);
  check(later.score > 0, 'score grows while playing');
  check(later.fps > 20, 'the loop is running at a playable rate', `${later.fps?.toFixed(0)} fps`);

  /* ---------------------------------------------------- jump / slide */
  // Clear the field so these input assertions cannot be cut short by a hazard.
  await ensurePlaying();
  await waitForPlayer('p.onGround === true', 'the runner should land');
  check((await readState()).jumpsLeft === 1, 'a double jump is available on the ground');

  await driver.tap('Space', 55);
  await waitForPlayer('p.onGround === false', 'space should launch a jump');
  check(true, 'space launches a jump');

  await driver.tap('Space', 55);
  await waitForPlayer('p.jumpsLeft === 0', 'the second press should double jump');
  check(true, 'a second press double jumps');

  // The slide is only held open while "down" is pressed. WebDriver serialises
  // requests per session, so the samples are recorded inside the page while the
  // key is held and read back afterwards.
  await ensurePlaying();
  await waitForPlayer('p.alive === true && p.onGround === true', 'the runner should land');
  await clearField();
  await driver.eval(() => {
    window.__slideSamples = [];
    window.__slideSampler = setInterval(() => {
      const app = window.__neonDrift;
      window.__slideSamples.push({
        down: app.input.down,
        sliding: app.state.player.sliding,
      });
    }, 40);
    return true;
  });
  await driver.hold('ArrowDown', 700);
  const samples = await driver.eval(() => {
    clearInterval(window.__slideSampler);
    return window.__slideSamples;
  });

  const heldSamples = samples.filter((s) => s.down);
  check(heldSamples.length > 0, 'the browser reports "down" as held', `${heldSamples.length} samples`);
  check(
    heldSamples.some((s) => s.sliding),
    'holding down slides',
    `${heldSamples.length} held samples, ${heldSamples.filter((s) => s.sliding).length} sliding`,
  );
  check(samples[samples.length - 1]?.sliding === false, 'releasing down ends the slide');

  /* ------------------------------------------------------------- pads */
  // Fund the wallet, put a pad in front of the runner, then buy it with the
  // real keyboard pipeline.
  await ensurePlaying();
  await waitForPlayer('p.alive === true && p.onGround === true', 'the runner should land');
  await clearField();
  await driver.eval(() => {
    const state = window.__neonDrift.state;
    state.pickups.length = 0;
    state.chain = 40;
    state.chainTimer = 999;
    const x = state.player.x + 40;
    state.pads.push({
      id: 777777,
      kind: 'shield',
      cost: 20,
      x,
      x2: x + 320,
      w: 320,
      y: 560,
      used: false,
      charge: 0,
      grace: 0,
      flash: 0,
      denied: 0,
      group: 1,
      phase: 0,
    });
    return true;
  });

  await driver.hold('ArrowDown', 750);
  const bought = await driver.eval(() => {
    const state = window.__neonDrift.state;
    return {
      bought: state.padsBought,
      cashed: state.cashed,
      chain: state.chain,
      shield: state.powerups.shield.active,
    };
  });
  check(bought.bought === 1, 'holding down on a charge pad buys it', JSON.stringify(bought));
  check(bought.cashed === 20, 'the price is charged to the chain', JSON.stringify(bought));
  check(bought.chain === 20, 'chain is spent, not duplicated', String(bought.chain));
  check(bought.shield === true, 'the pad payload goes live');

  /* ------------------------------------------------------------ pause */
  await clearField();
  await driver.tap('Escape', 60);
  await driver.waitFor(() => window.__neonDrift.scene === 'paused', { timeout: 3000 });
  check(true, 'escape pauses');
  check(await isVisible('screen-pause'), 'the pause overlay is shown');
  check(Number(String(await textOf('pause-score')).replace(/,/g, '')) >= 0, 'the pause screen shows the score');

  const frozen = await readState();
  await delay(700);
  const stillFrozen = await readState();
  check(Math.abs(stillFrozen.metres - frozen.metres) < 0.001, 'the world is frozen while paused');

  await driver.tap('Escape', 60);
  await driver.waitFor(() => window.__neonDrift.scene === 'playing', { timeout: 3000 });
  check(true, 'escape resumes');

  /* ------------------------------------------------- death + game over */
  await driver.eval(() => {
    const app = window.__neonDrift;
    const p = app.state.player;
    p.invuln = 0;
    // A pad earlier in this run may have left a shield up; drop every
    // power-up so the injected hazard is unambiguously lethal.
    for (const pw of Object.values(app.state.powerups)) {
      pw.active = false;
      pw.charges = 0;
      pw.timer = 0;
    }
    app.state.hazards.length = 0;
    app.state.hazards.push({
      id: 999001,
      kind: 'spike',
      x: p.x - 10,
      x2: p.x + 30,
      y: 530,
      w: 40,
      h: 30,
      avoid: 'jump',
      passed: false,
      dead: false,
      minDist: Infinity,
      group: 999,
      speed: 400,
      diff: 0,
    });
    return true;
  });
  await driver.waitFor(() => window.__neonDrift.state.dead === true, { timeout: 6000 });
  check(true, 'a collision kills the runner');

  await driver.waitFor(() => window.__neonDrift.scene === 'over', { timeout: 6000 });
  check(await isVisible('screen-over'), 'the game-over overlay appears');
  check(
    Number(String(await textOf('over-score')).replace(/,/g, '')) > 0,
    'the game-over screen reports the score',
  );
  check(String(await textOf('over-reason')).length > 4, 'the game-over screen explains the cause');

  const saved = await driver.eval(() => window.localStorage.getItem('neon-drift.save.v1'));
  check(!!saved && JSON.parse(String(saved)).runs >= 1, 'the run is persisted to localStorage');

  /* ---------------------------------------------------------- restart */
  await driver.tap('Space', 60);
  await driver.waitFor(() => window.__neonDrift.scene === 'playing', { timeout: 3000 });
  check(true, 'space restarts from the game-over screen');
  const restarted = await readState();
  check(restarted.score < 80, 'the restarted run starts from a fresh score', String(restarted.score));
  check((await isVisible('screen-over')) === false, 'the game-over overlay hides again');

  /* --------------------------------------------------------- no errors */
  const errors = await driver.eval(
    () => window.__smokeErrors.filter((e) => !/PrivateBrowsingUtils|docShell/.test(e)),
  );
  check(errors.length === 0, 'no runtime errors in the browser', errors.slice(0, 5).join(' | '));
  if (driver.usedFallback) console.log('  note  key input fell back to synthetic KeyboardEvents');
} catch (error) {
  fails.push(`exception: ${error.message}`);
  console.error(error);
} finally {
  await driver.quit();
  if (driver.stopper) driver.stopper();
  server.kill('SIGTERM');
}

console.log(`\n${fails.length === 0 ? 'smoke (firefox): PASS' : `smoke (firefox): FAIL (${fails.length})`}`);
for (const fail of fails) console.log(` - ${fail}`);
process.exit(fails.length === 0 ? 0 : 1);

