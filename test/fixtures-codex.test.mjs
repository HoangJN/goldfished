import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGenerated } from './fixtures/codex/generated.mjs';

const root = fileURLToPath(new URL('./fixtures/codex/', import.meta.url));
const oracle = JSON.parse(await readFile(join(root, 'expected.json'), 'utf8'));

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name.endsWith('.jsonl')) result.push(path);
  }
  return result;
}

function names(paths, dir) {
  return paths.map(path => relative(dir, path).replaceAll('\\', '/')).sort();
}

function checkOracle(entry, name) {
  assert.equal(entry.messages.length, entry.typed, name);
  assert.equal(new Set(entry.messages.map(message => message.id)).size, entry.typed, name);
  for (const message of entry.messages) {
    assert.equal(message.labels.length, entry.compactions.length - message.epoch, name);
    for (const label of message.labels) assert.ok(['kept', 'gone', null].includes(label), name);
  }
}

function checkSession(text, name) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const header = JSON.parse(lines.shift());
  assert.equal(header._synthetic, true, name);
  assert.equal(typeof header.note, 'string', name);
  const damaged = /truncated last line/i.test(header.note);
  let bad = 0;
  for (const [index, line] of lines.entries()) {
    try { JSON.parse(line); } catch {
      bad++;
      assert.ok(damaged, name);
      assert.equal(index, lines.length - 1, name);
      assert.ok(!text.endsWith('\n'), name);
    }
  }
  assert.equal(bad, damaged ? 1 : 0, name);
}

test('recursive fixture listing and hand-written oracle agree in both directions', async () => {
  assert.equal(oracle._synthetic, true);
  const listed = names(await files(root), root);
  assert.deepEqual(listed, Object.keys(oracle.fixtures).sort());
  assert.ok(listed.length >= 9);
  for (const name of listed) {
    assert.match(name, /^(?:cx4\/)?sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.+\.jsonl$/);
    checkOracle(oracle.fixtures[name], name);
    checkSession(await readFile(join(root, name), 'utf8'), name);
  }
});

test('canary fixture contains both probes and its gate marker', async () => {
  const text = await readFile(join(root, 'sessions/2026/01/05/rollout-secret-canary.jsonl'), 'utf8');
  assert.equal(JSON.parse(text.split('\n')[0])._canary, true);
  assert.ok(text.includes('GOLDFISHED-CANARY-7f3a'));
  assert.ok(text.includes(['sk-ant', 'canary0000000000000000'].join('-')));
});

test('runtime fixtures match generated keys and contain a compacted line of at least 64 MiB', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goldfished-codex-fixtures-'));
  try {
    const paths = await writeGenerated(dir);
    assert.deepEqual(Object.keys(paths).sort(), Object.keys(oracle.generated).sort());
    assert.deepEqual(names(await files(dir), dir), Object.keys(oracle.generated).sort());
    for (const [name, path] of Object.entries(paths)) {
      assert.equal(path, join(dir, name));
      checkOracle(oracle.generated[name], name);
      const text = await readFile(path, 'utf8');
      checkSession(text, name);
      const line = text.split('\n').find(line => line.includes('"type":"compacted"'));
      assert.ok(line, name);
      assert.ok(Buffer.byteLength(line) >= 64 * 1024 * 1024, name);
      assert.ok((await stat(path)).size >= 64 * 1024 * 1024, name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
