import test from 'node:test';
import assert from 'node:assert/strict';
import { wrap, number, plural, per100, size, secs, date } from '../src/wrap.mjs';

test('wrap uses 80 columns, two-space continuations and keeps line breaks', () => {
  assert.equal(wrap('x '.repeat(60).trim()), 'x '.repeat(39) + 'x\n  ' + 'x '.repeat(19) + 'x');
  assert.equal(wrap('one two three four', 10), 'one two\n  three\n  four');
  assert.equal(wrap('a abcdefghi z', 8), 'a\n  abcdefghi\n  z');
  assert.equal(wrap('abcdefghijk next', 8), 'abcdefghijk\n  next');
  assert.equal(wrap('first\nsecond\n\nlast\n'), 'first\nsecond\n\nlast\n');
  assert.equal(wrap(''), '');
});

test('counts, nouns and per-100 half-up rounding', () => {
  assert.equal(number(1204), '1,204');
  assert.equal(number(1234567), '1,234,567');
  assert.equal(plural(1, 'session'), '1 session');
  assert.equal(plural(2, 'session'), '2 sessions');
  assert.equal(plural(1204, 'message'), '1,204 messages');
  assert.equal(plural(0, 'child', 'children'), '0 children');
  assert.equal(per100(1, 8), 13);
  assert.equal(per100(3, 8), 38);
  for (let d = 1; d <= 200; d++) for (let k = 0; k <= d; k++)
    assert.equal(per100(k, d), Number((BigInt(k) * 200n + BigInt(d)) / (2n * BigInt(d))));
});

test('decimal sizes, seconds and local dates', () => {
  assert.equal(size(0), '0 B');
  assert.equal(size(512), '512 B');
  for (const [i, unit] of ['kB', 'MB', 'GB', 'TB', 'PB'].entries())
    assert.equal(size(1000 ** (i + 1)), `1.0 ${unit}`);
  assert.equal(size(999), '999 B');
  assert.equal(size(812400000), '812.4 MB');
  assert.equal(size(5700000000), '5.7 GB');
  assert.equal(secs(0.4), 'under 1s');
  assert.equal(secs(0.999), 'under 1s');
  assert.equal(secs(1), '1s');
  assert.equal(secs(11.5), '12s');
  const previous = process.env.TZ;
  try { process.env.TZ = 'UTC'; assert.equal(date(Date.UTC(2026, 8, 18, 23, 59)), '18 Sep 2026'); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
