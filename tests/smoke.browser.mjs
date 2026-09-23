/**
 * Real-browser smoke test driven by Playwright + Chromium.
 *
 *   npm run smoke
 *
 * Checks that the game boots, renders, plays, scores, jumps, double jumps,
 * slides, pauses, dies, persists and restarts — all through the real keyboard
 * pipeline. Requires `npx playwright install chromium`.
 *
 * (tests/smoke.webdriver.mjs runs the same checks against system Firefox via
 * geckodriver, without needing Playwright's browser download.)
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const PORT = Number(process.env.SMOKE_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = '/tmp/neon-drift-shots';

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

await mkdir(SHOTS, { recursive: true });

/* -------------------------------------------------------------- browser */

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error(`Could not launch Chromium: ${error.message}`);
  console.error('Install the browser binary with: npx playwright install chromium');
  server.kill('SIGTERM');
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
});

const PLAYER_FIELDS = ['onGround', 'sliding', 'jumpsLeft', 'alive', 'x', 'y'];

/** Small, JSON-safe projection of the live game state. */
const readState = () =>
  page.evaluate((fields) => {
    const app = globalThis.__neonDrift;
    const s = app.state;
    const out = { scene: app.scene, fps: app.fps, metres: s.metres, score: s.score, dead: s.dead };
    for (const key of fields) out[key] = s.player[key];
    return out;
  }, PLAYER_FIELDS);

const scene = () => page.evaluate(() => globalThis.__neonDrift.scene);
const isVisible = (id) =>
  page.evaluate((sel) => !document.getElementById(sel).classList.contains('hidden'), id);
const textOf = (id) => page.textContent(`#${id}`);

const waitFor = (fn, label, timeout = 3000) =>
  page.waitForFunction(fn, null, { timeout, polling: 25 }).catch((error) => {
    throw new Error(`${label}: ${error.message.split('\n')[0]}`);
  });

const waitForPlayer = (body, label, timeout = 3000) =>
  waitFor(
    new Function(
      'const p = globalThis.__neonDrift.state.player; ' + body,
    ),
    label,
    timeout,
  );

const tap = async (key, holdMs = 60) => {
  await page.keyboard.down(key);
  await delay(holdMs);
  await page.keyboard.up(key);
  await delay(30);
};

const clearField = () =>
  page.evaluate(() => {
    const state = globalThis.__neonDrift.state;
    state.hazards.length = 0;
    state.gaps.length = 0;
  });

/** If the run ended, start a fresh one so the next checks have a live player. */
const ensurePlaying = async () => {
  if (await page.evaluate(() => globalThis.__neonDrift.state.dead)) {
    await waitFor(() => globalThis.__neonDrift.scene === 'over', 'run should end', 5000);
  }
  if ((await scene()) !== 'playing') {
    await tap('Space');
    await waitFor(() => globalThis.__neonDrift.scene === 'playing', 'run should start');
  }
  await clearField();
};

try {
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__neonDrift, null, { timeout: 15_000 });
  await delay(400);

  /* ------------------------------------------------------------- boot */
  const canvas = await page.evaluate(() => {
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
  const demoStart = await page.evaluate(() => globalThis.__neonDrift.demo.metres);
  await delay(1200);
  const demoNow = await page.evaluate(() => globalThis.__neonDrift.demo.metres);
  check(demoNow > demoStart, 'the attract-mode demo runner is moving', `${demoStart} -> ${demoNow}`);

  /* ---------------------------------------------------------- playing */
  await tap('Space');
  await waitFor(() => globalThis.__neonDrift.scene === 'playing', 'space should start a run');
  check(true, 'space starts a run');
  check((await isVisible('screen-title')) === false, 'the title overlay hides during play');

  const early = await readState();
  await delay(1500);
  const later = await readState();
  check(later.metres > early.metres, 'distance grows while playing', `${early.metres} -> ${later.metres}`);
  check(later.score > 0, 'score grows while playing');
  check(later.fps > 20, 'the loop is running at a playable rate', `${later.fps?.toFixed(0)} fps`);

  /* ---------------------------------------------------- jump / slide */
  await ensurePlaying();
  await waitForPlayer('return p.onGround === true;', 'the runner should land');
  check((await readState()).jumpsLeft === 1, 'a double jump is available on the ground');

  await tap('Space', 55);
  await waitForPlayer('return p.onGround === false;', 'space should launch a jump');
  check(true, 'space launches a jump');

  await tap('Space', 55);
  await waitForPlayer('return p.jumpsLeft === 0;', 'the second press should double jump');
  check(true, 'a second press double jumps');

  // The slide is only held open while "down" is pressed, so check it mid-hold.
  await ensurePlaying();
  await waitForPlayer('return p.alive === true && p.onGround === true;', 'the runner should land');
  await page.keyboard.down('ArrowDown');
  await waitForPlayer('return p.sliding === true;', 'holding down should slide');
  check(true, 'holding down slides');
  await page.keyboard.up('ArrowDown');
  await waitForPlayer('return p.sliding === false;', 'releasing down should end the slide');
  check(true, 'releasing down ends the slide');

  /* ------------------------------------------------------------- pads */
  // Fund the wallet, put a pad in front of the runner, then buy it through the
  // real keyboard pipeline.
  await ensurePlaying();
  await waitForPlayer('return p.alive === true && p.onGround === true;', 'the runner should land');
  await clearField();
  await page.evaluate(() => {
    const state = globalThis.__neonDrift.state;
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
  });

  await page.keyboard.down('ArrowDown');
  await waitFor(
    () => globalThis.__neonDrift.state.padsBought === 1,
    'holding down on a charge pad should buy it',
  );
  await page.keyboard.up('ArrowDown');

  const bought = await page.evaluate(() => {
    const state = globalThis.__neonDrift.state;
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
  await tap('Escape');
  await waitFor(() => globalThis.__neonDrift.scene === 'paused', 'escape should pause');
  check(true, 'escape pauses');
  check(await isVisible('screen-pause'), 'the pause overlay is shown');
  check(Number(String(await textOf('pause-score')).replace(/,/g, '')) >= 0, 'the pause screen shows the score');

  const frozen = await readState();
  await delay(700);
  const stillFrozen = await readState();
  check(Math.abs(stillFrozen.metres - frozen.metres) < 0.001, 'the world is frozen while paused');

  await tap('Escape');
  await waitFor(() => globalThis.__neonDrift.scene === 'playing', 'escape should resume');
  check(true, 'escape resumes');

  /* ------------------------------------------------- death + game over */
  await page.evaluate(() => {
    const app = globalThis.__neonDrift;
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
  });
  await waitFor(() => globalThis.__neonDrift.state.dead === true, 'a collision should kill the runner', 6000);
  check(true, 'a collision kills the runner');

  await waitFor(() => globalThis.__neonDrift.scene === 'over', 'the game-over screen should appear', 6000);
  check(await isVisible('screen-over'), 'the game-over overlay appears');
  check(
    Number(String(await textOf('over-score')).replace(/,/g, '')) > 0,
    'the game-over screen reports the score',
  );
  check(String(await textOf('over-reason')).length > 4, 'the game-over screen explains the cause');

  const saved = await page.evaluate(() => globalThis.localStorage.getItem('neon-drift.save.v1'));
  check(!!saved && JSON.parse(String(saved)).runs >= 1, 'the run is persisted to localStorage');

  /* ---------------------------------------------------------- restart */
  await tap('Space');
  await waitFor(() => globalThis.__neonDrift.scene === 'playing', 'space should restart the run');
  check(true, 'space restarts from the game-over screen');
  const restarted = await readState();
  check(restarted.score < 80, 'the restarted run starts from a fresh score', String(restarted.score));
  check((await isVisible('screen-over')) === false, 'the game-over overlay hides again');

  /* --------------------------------------------------------- no errors */
  check(consoleErrors.length === 0, 'no runtime errors in the browser', consoleErrors.slice(0, 5).join(' | '));
} catch (error) {
  fails.push(`exception: ${error.message}`);
  console.error(error);
  try {
    await page.screenshot({ path: `${SHOTS}/failure.png` });
    console.error(`screenshot: ${SHOTS}/failure.png`);
  } catch {
    /* ignore */
  }
} finally {
  await browser.close().catch(() => {});
  server.kill('SIGTERM');
}

console.log(`\n${fails.length === 0 ? 'smoke (chromium): PASS' : `smoke (chromium): FAIL (${fails.length})`}`);
for (const fail of fails) console.log(` - ${fail}`);
process.exit(fails.length === 0 ? 0 : 1);

