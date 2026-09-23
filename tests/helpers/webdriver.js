/**
 * Minimal W3C WebDriver client + geckodriver supervisor.
 *
 * Used by tests/smoke.webdriver.mjs so the game can be exercised in a real
 * browser (system Firefox) without waiting for Playwright's browser download.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const W3C_KEYS = {
  Space: '\uE00D',
  Escape: '\uE00C',
  ArrowDown: '\uE015',
  ArrowUp: '\uE013',
  Enter: '\uE007',
  KeyR: 'r',
};

export class WebDriver {
  constructor(host, port, sessionId) {
    this.base = `http://${host}:${port}`;
    this.id = sessionId;
  }

  async request(method, path, body, timeoutMs = 30_000) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    const value = payload.value ?? payload;
    if (payload.value && typeof payload.value === 'object' && payload.value.error) {
      throw new Error(`${payload.value.error}: ${payload.value.message}`);
    }
    if (!res.ok) throw new Error(`webdriver ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return value;
  }

  async goto(url) {
    await this.request('POST', `/session/${this.id}/url`, { url });
  }

  /** Evaluate a function (or string body) in the page and return its value. */
  async eval(fn, args = [], timeoutMs = 15_000) {
    const body = typeof fn === 'function' ? `return (${fn}).apply(null, arguments);` : fn;
    return this.request('POST', `/session/${this.id}/execute/sync`, { script: body, args }, timeoutMs);
  }

  async waitFor(fn, { timeout = 10_000, interval = 100 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(fn, []);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      await delay(interval);
    }
    throw new Error(`waitFor timed out after ${timeout}ms (last: ${JSON.stringify(last)})`);
  }

  /** Send a real key press/release through the W3C actions endpoint. */
  async keySequence(keyName, durationMs) {
    const value = W3C_KEYS[keyName] ?? keyName;
    const body = {
      actions: [
        {
          type: 'key',
          id: 'keyboard',
          actions: [
            { type: 'keyDown', value },
            { type: 'pause', duration: Math.max(1, Math.round(durationMs)) },
            { type: 'keyUp', value },
          ],
        },
      ],
    };
    await this.request('POST', `/session/${this.id}/actions`, body);
  }

  /** Dispatch the same KeyboardEvent the app listens for (driver fallback). */
  async dispatchKey(keyName, durationMs = 50) {
    await this.eval(
      (code, holdMs) => {
        const fire = (type) =>
          window.dispatchEvent(
            new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }),
          );
        fire('keydown');
        setTimeout(() => fire('keyup'), Math.max(1, holdMs));
        return true;
      },
      [keyName, durationMs],
    );
  }

  /**
   * Press and release a key inside a single action sequence.
   *
   * W3C resets input state when a sequence ends, so a hold must carry its own
   * pause: keyDown -> pause -> keyUp.
   */
  async hold(keyName, durationMs = 50) {
    try {
      await this.keySequence(keyName, durationMs);
    } catch {
      this.usedFallback = true;
      await this.dispatchKey(keyName, durationMs);
    }
    await delay(durationMs + 40);
  }

  async tap(keyName, durationMs = 50) {
    await this.hold(keyName, durationMs);
  }

  async quit() {
    try {
      await this.request('DELETE', `/session/${this.id}`, undefined, 5000);
    } catch {
      /* already gone */
    }
  }
}

/** Boot geckodriver (if needed) and open a headless Firefox session. */
export async function launchFirefox({ host = '127.0.0.1', port = 0, headless = true } = {}) {
  const targetPort = port || (await freePort());
  let process_ = null;

  if (!(await probe(host, targetPort))) {
    process_ = spawn('geckodriver', ['--host', host, '--port', String(targetPort)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    process_.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/error/i.test(text)) process.stderr.write(text);
    });
    for (let i = 0; i < 100 && !(await probe(host, targetPort)); i++) await delay(100);
    if (!(await probe(host, targetPort))) {
      process_?.kill('SIGTERM');
      throw new Error('geckodriver did not start (install it with: sudo apt install firefox-geckodriver)');
    }
  }

  const res = await fetch(`http://${host}:${targetPort}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            args: headless ? ['-headless'] : [],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await res.json();
  if (!payload.value?.sessionId) {
    process_?.kill('SIGTERM');
    throw new Error(`could not start Firefox: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  const driver = new WebDriver(host, targetPort, payload.value.sessionId);
  driver.stopper = () => process_?.kill('SIGTERM');
  return driver;
}

/** Ask the OS for a free localhost port (keeps parallel runs from colliding). */
export async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe_ = createServer();
    probe_.unref();
    probe_.on('error', reject);
    probe_.listen(0, '127.0.0.1', () => {
      const { port } = probe_.address();
      probe_.close(() => resolve(port));
    });
  });
}

async function probe(host, port) {
  try {
    const res = await fetch(`http://${host}:${port}/status`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return false;
    const payload = await res.json();
    return payload?.value?.ready === true;
  } catch {
    return false;
  }
}
