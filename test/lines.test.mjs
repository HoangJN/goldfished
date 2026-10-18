import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../src/lines.mjs';

async function read(text, mayNeed = () => true) {
  const dir = await mkdtemp(join(tmpdir(), 'goldfished-lines-'));
  try {
    const file = join(dir, 'lines');
    await writeFile(file, text);
    const reader = readLines(file, { mayNeed }), lines = [];
    for (;;) {
      const next = await reader.next();
      if (next.done) return { lines, totals: next.value };
      lines.push(next.value);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('BOM, CRLF, blank lines and a partial final line', async () => {
  const { lines, totals } = await read('\uFEFFfirst\r\n\r\nlast\r');
  assert.deepEqual(lines, [{ n: 1, text: 'first' }, { n: 2, text: '' }, { n: 3, text: 'last', partial: true }]);
  assert.equal(totals.lines, 3);
  assert.equal(totals.bytes, Buffer.byteLength('\uFEFFfirst\r\n\r\nlast\r'));
});
test('an empty file yields no lines', async () => {
  assert.deepEqual((await read('')).lines, []);
  assert.deepEqual((await read('one\n')).lines, [{ n: 1, text: 'one' }]);
});
test('the 16 MiB limit keeps needed lines and skips other lines', async () => {
  const long = 'keep' + 'x'.repeat(16 * 1024 * 1024), prefixes = [];
  const kept = await read(long + '\nnext\n', prefix => { prefixes.push(prefix); return prefix.startsWith('keep'); });
  assert.equal(kept.lines[0].text, long);
  assert.equal(kept.totals.skippedLong, 0);
  assert.equal(prefixes[0], long.slice(0, 4096));
  const skipped = await read(long + '\nnext\n' + long, () => false);
  assert.deepEqual(skipped.lines, [{ n: 2, text: 'next' }]);
  assert.equal(skipped.totals.skippedLong, 2);
  assert.equal(skipped.totals.lines, 3);
  assert.equal(skipped.totals.lineBuckets.reduce((a, b) => a + b, 0), 3);
  const exact = await read('x'.repeat(16 * 1024 * 1024), () => assert.fail('Limit is exclusive'));
  assert.equal(exact.lines[0].text.length, 16 * 1024 * 1024);
});
test('UTF-8 characters crossing stream chunks stay intact', async () => {
  const text = 'x'.repeat(65535) + '\u00a3\u96e8';
  assert.equal((await read(text)).lines[0].text, text);
});
