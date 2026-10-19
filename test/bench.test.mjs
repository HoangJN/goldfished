import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { generateBench } from '../scripts/gen-bench.mjs';
import { bars, measure } from '../scripts/bench.mjs';
import { root } from '../scripts/oracle.mjs';
import { readLines } from '../src/lines.mjs';

async function* referenceLines(file, { mayNeed } = {}) {
  const data = readFileSync(file), totals = { bytes: data.length, lines: 0, skippedLong: 0, lineBuckets: [] };
  for (let start = 0; start < data.length;) {
    const end = data.indexOf(10, start), part = data.subarray(start, end < 0 ? data.length : end);
    const n = ++totals.lines, bucket = Math.floor(Math.log2(Math.max(1, part.length)));
    totals.lineBuckets[bucket] = (totals.lineBuckets[bucket] ?? 0) + 1;
    if (part.length > 16 * 2 ** 20 && mayNeed && !mayNeed(part.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/u, ''))) totals.skippedLong++;
    else {
      let text = part.toString('utf8');
      if (n === 1) text = text.replace(/^\uFEFF/u, '');
      text = text.replace(/\r$/u, '');
      yield end < 0 ? { n, text, partial: true } : { n, text };
    }
    start = end < 0 ? data.length : end + 1;
  }
  return totals;
}
async function collect(reader) {
  const rows = [];
  for (;;) { const { value, done } = await reader.next(); if (done) return { rows, totals: value }; rows.push(value); }
}

test('200 MiB per adapter finishes under a 100 MiB heap without long lines', { timeout: 300000 }, () => {
  const base = mkdtempSync(join(tmpdir(), 'gf-bench-smoke-'));
  try {
    const data = join(base, 'data'), expected = generateBench({ gib: 200 / 1024, seed: 1, out: data, longLines: false });
    for (const agent of ['claude-code', 'codex']) {
      assert.equal(expected[agent].bytes, 200 * 2 ** 20);
      assert.equal(expected[agent].longLines, 0);
      const got = measure(join(base, 'isolated'), agent, join(data, agent), { nodeArgs: ['--max-old-space-size=100'] });
      assert.equal(got.actual.sessions, expected[agent].files);
      assert.equal(got.actual.messages, expected[agent].typed);
      assert.equal(got.actual.compacted, agent === 'claude-code' ? 540 : 40);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('benchmark bars reject each limit independently', () => {
  const row = (seconds, peakBytes = 100000000) => ({ seconds, peakBytes });
  const warm = Array.from({ length: 5 }, () => row(30)), fresh = row(40);
  const scale = [0.5, 1, 2].flatMap(gib => [4, 5, 50].map(rate => ({ ...row(rate * gib), gib })));
  assert.ok(bars(warm, fresh, scale).every(([, pass]) => pass));
  assert.equal(bars(warm.map(() => row(61)), fresh, scale)[0][1], false);
  assert.equal(bars(warm, row(91), scale)[1][1], false);
  assert.equal(bars(warm, row(40, 400000001), scale)[2][1], false);
  assert.equal(bars(warm, fresh, scale.map(r => r.gib === 1 ? { ...r, seconds: r.seconds * 2 } : r))[3][1], false);
  assert.equal(bars(warm, fresh, scale.map(r => r.gib === 0.5 ? { ...r, seconds: r.seconds * 10 } : r))[3][1], true);
  assert.equal(bars([row(30), row(30), row(300), row(300), row(300)], fresh, scale)[3][1], true);
});

test('line reading preserves split and invalid UTF-8, BOM, CRLF and partial lines', async () => {
  const base = mkdtempSync(join(tmpdir(), 'gf-bench-lines-')), file = join(base, 'invented.jsonl');
  try {
    writeFileSync(file, Buffer.concat([Buffer.from('\uFEFF' + 'x'.repeat(65531) + '🐟\r\n'),
      Buffer.from([0xf0, 0x9f, 10, 0x80, 0xff, 13, 10]), Buffer.from('truncated')]));
    assert.deepEqual(await collect(readLines(file)), await collect(referenceLines(file)));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('every fixture keeps its sessions, complete Tally and drift verdict with fewer copies', async () => {
  const base = mkdtempSync(join(tmpdir(), 'gf-bench-counts-'));
  try {
    mkdirSync(join(base, 'agents'));
    writeFileSync(join(base, 'lines.mjs'), `import { readFileSync } from 'node:fs'; export ${referenceLines.toString().replace('referenceLines', 'readLines')}`);
    for (const id of ['claude-code', 'codex']) {
      for (const name of [id + '.mjs', id + '.dialect.mjs']) writeFileSync(join(base, 'agents', name), readFileSync(join(root, 'src/agents', name)));
      const before = (await import(pathToFileURL(join(base, 'agents', id + '.mjs')))).default;
      const after = (await import(pathToFileURL(join(root, 'src/agents', id + '.mjs')))).default;
      const fixtures = join(root, 'test/fixtures', id), expected = JSON.parse(readFileSync(join(fixtures, 'expected.json')));
      for (const name of Object.keys(expected.fixtures)) {
        const path = join(fixtures, name), info = statSync(path);
        const files = info.isFile() ? [{ file: path, size: info.size, mtimeMs: info.mtimeMs, group: dirname(path) }] : await after.listFiles(path);
        const inspect = async adapter => {
          const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
          const sessions = []; for await (const session of adapter.sessions(files, tally)) sessions.push(session);
          return { sessions, tally, drift: adapter.driftCheck(tally) };
        };
        assert.deepEqual(await inspect(after), await inspect(before), `${id} ${name}`);
      }
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});
