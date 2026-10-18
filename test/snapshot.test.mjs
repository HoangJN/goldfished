import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchSnapshot } from './snapshot.mjs';

test('missing snapshot fails and a CRLF copy passes without updating', () => {
  const previous = process.env.UPDATE_SNAPSHOTS;
  delete process.env.UPDATE_SNAPSHOTS;
  try {
    assert.throws(() => matchSnapshot('card', 'missing', 'text'), { code: 'ENOENT' });
    const source = readFileSync(new URL('./snapshots/card/spec-example.txt', import.meta.url), 'utf8');
    matchSnapshot('card', 'spec-example', source.replace(/\n/g, '\r\n'));
    assert.throws(() => matchSnapshot('card', 'spec-example', 'changed'));
    assert.throws(() => matchSnapshot('..', 'escape', 'text'));
    assert.equal(readFileSync(new URL('./snapshots/card/spec-example.txt', import.meta.url), 'utf8'), source);
  } finally { if (previous === undefined) delete process.env.UPDATE_SNAPSHOTS; else process.env.UPDATE_SNAPSHOTS = previous; }
});
