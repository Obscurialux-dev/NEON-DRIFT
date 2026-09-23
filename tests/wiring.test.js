import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Static "is the shell wired up?" checks. These need no browser: they verify
 * every id the JS looks up exists in index.html, every asset the HTML loads
 * exists on disk, and every relative import inside src/ resolves.
 */
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'src');

const read = (rel) => readFile(join(ROOT, rel), 'utf8');

const html = await read('index.html');

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const jsFiles = [];
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
};
await walk(SRC);

test('index.html loads the game as an ES module', () => {
  const script = html.match(/<script[^>]*src="([^"]+)"[^>]*>/);
  assert.ok(script, 'index.html should include a script tag');
  assert.ok(/\stype="module"/.test(script[0]), 'the entry script must be type="module"');
  assert.equal(script[1], './src/main.js');
});

test('every asset referenced by index.html exists', async () => {
  const refs = [
    ...[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*href="(\.\/[^"]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(refs.length >= 2, 'expected a script and a stylesheet reference');
  for (const ref of refs) {
    const info = await stat(join(ROOT, ref));
    assert.ok(info.isFile(), `${ref} should exist`);
  }
});

test('every element id the JS queries exists in index.html', async () => {
  const queried = new Set();
  for (const file of jsFiles) {
    const code = await readFile(file, 'utf8');
    for (const match of code.matchAll(/\bel\('([^']+)'\)/g)) queried.add(match[1]);
    for (const match of code.matchAll(/\bsetText\('([^']+)'/g)) queried.add(match[1]);
    for (const match of code.matchAll(/getElementById\('([^']+)'\)/g)) queried.add(match[1]);
  }
  assert.ok(queried.size > 10, `expected many element lookups, found ${queried.size}`);

  const missing = [...queried].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `ids missing from index.html: ${missing.join(', ')}`);
});

test('every relative import inside src/ resolves to a real file', async () => {
  const problems = [];
  let imports = 0;

  for (const file of jsFiles) {
    const code = await readFile(file, 'utf8');
    const specs = [
      ...[...code.matchAll(/\bfrom\s+'(\.[^']+)'/g)].map((m) => m[1]),
      ...[...code.matchAll(/\bimport\('(\.[^']+)'\)/g)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      imports++;
      const target = resolve(dirname(file), spec);
      try {
        const info = await stat(target);
        if (!info.isFile()) problems.push(`${file}: ${spec} is not a file`);
      } catch {
        problems.push(`${file}: cannot resolve ${spec}`);
      }
    }
  }

  assert.ok(imports > 15, `expected a real module graph, found ${imports} imports`);
  assert.deepEqual(problems, []);
});

test('no module mutates the DOM before the canvas exists', async () => {
  for (const file of jsFiles) {
    const code = await readFile(file, 'utf8');
    // Catch render/UI modules reaching for the document at import time.
    const topLevelLookup = /^(?:const|let|var)\s+\w+\s*=\s*document\./m.test(code);
    if (topLevelLookup) {
      assert.equal(
        file.endsWith('main.js'),
        true,
        `${file} looks up the DOM at module scope; only main.js may do that`,
      );
    }
  }
});
