import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGenerated } from './fixtures/claude-code/generated.mjs';

const root = fileURLToPath(new URL('./fixtures/claude-code/', import.meta.url));
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

function checkOracle(entry, name) {
  assert.equal(entry.messages.length, entry.typed, name);
  assert.equal(new Set(entry.messages.map(message => message.id)).size, entry.typed, name);
  for (const message of entry.messages) {
    assert.equal(message.labels.length, entry.compactions.length - message.epoch, name);
    for (const label of message.labels) assert.ok(['kept', 'gone', null].includes(label), name);
  }
}

test('fixture listing and hand-written oracle agree in both directions', async () => {
  assert.equal(oracle._synthetic, true);
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.filter(e => e.isDirectory() || e.name.endsWith('.jsonl'))
    .map(e => e.name).sort();
  assert.deepEqual(Object.keys(oracle.fixtures).sort(), names);
  assert.ok(names.length >= 26);
  for (const name of names) {
    checkOracle(oracle.fixtures[name], name);
    const path = join(root, name);
    if ((await stat(path)).isDirectory()) assert.ok((await files(path)).length, name);
  }
});

test('each session has provenance and only named damaged fixtures have bad JSON', async () => {
  for (const path of await files(root)) {
    const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const header = JSON.parse(lines.shift());
    assert.equal(header._synthetic, true, path);
    assert.equal(typeof header.note, 'string', path);
    const damaged = /unknown-and-bad-json\.jsonl$|truncated-last-line\.jsonl$/.test(path);
    let bad = 0;
    for (const line of lines) {
      try { JSON.parse(line); } catch { bad++; }
    }
    assert.equal(bad, damaged ? 1 : 0, path);
    if (damaged) assert.match(header.note, /bad JSON|truncated/i);
  }
});

test('canary fixture contains both masking probes and its gate marker', async () => {
  const text = await readFile(join(root, 'secret-canary.jsonl'), 'utf8');
  assert.equal(JSON.parse(text.split('\n')[0])._canary, true);
  assert.ok(text.includes('GOLDFISHED-CANARY-7f3a'));
  assert.ok(text.includes(['sk-ant', 'canary0000000000000000'].join('-')));
});

test('runtime fixtures match the generated keys, size and old modified time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goldfished-fixtures-'));
  try {
    const paths = await writeGenerated(dir);
    assert.deepEqual(Object.keys(paths).sort(), Object.keys(oracle.generated).sort());
    assert.deepEqual((await readdir(dir)).sort(), Object.keys(oracle.generated).sort());
    for (const [name, path] of Object.entries(paths)) {
      assert.equal(dirname(path), dir);
      checkOracle(oracle.generated[name], name);
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const prefix = buffer.toString('utf8', 0, bytesRead);
        const newline = prefix.indexOf('\n');
        assert.equal(JSON.parse(prefix.slice(0, newline))._synthetic, true);
        assert.ok(prefix.slice(newline + 1).includes('"type":"user"'));
      } finally { await handle.close(); }
    }
    assert.ok((await stat(paths['large-line.jsonl'])).size >= 64 * 1024 * 1024);
    assert.equal((await stat(paths['modified-time.jsonl'])).mtime.toISOString(),
      '2000-01-01T12:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
