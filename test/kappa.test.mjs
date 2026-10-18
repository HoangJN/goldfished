import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { agreement, confusion, kappa } from '../scripts/kappa.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'goldfished-kappa-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
test('hand counts: perfect, chance and one quarter beyond chance', () => {
  assert.deepEqual(confusion([['kept', 'gone'], ['gone', 'kept'], ['reworded', 'reworded']]), [[0, 0, 1], [0, 1, 0], [1, 0, 0]]);
  assert.equal(kappa([[2, 0, 0], [0, 2, 0], [0, 0, 2]]), 1);
  assert.equal(kappa([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), 0);
  const middle = [[2, 1, 1], [1, 2, 1], [1, 1, 2]];
  assert.equal(agreement(middle), 0.5);
  assert.ok(Math.abs(kappa(middle) - 0.25) < 1e-12);
  assert.ok(Number.isNaN(kappa([[1, 0, 0], [0, 0, 0], [0, 0, 0]])));
  assert.throws(() => confusion([['bad', 'kept']]), /invalid labels/);
});
test('CLI matches shuffled ids, ignores extra fields and never gates kappa', () => {
  const a = join(scratch, 'a.jsonl'), b = join(scratch, 'b.jsonl');
  const write = (path, rows) => writeFileSync(path, rows.map(row => JSON.stringify({ ...row, _synthetic: true })).join('\n') + '\n');
  const run = () => spawnSync(process.execPath, ['scripts/kappa.mjs', a, b], { encoding: 'utf8' });
  write(a, [{ id: 'a', label: 'kept' }, { id: 'b', label: 'gone' }]);
  write(b, [{ id: 'b', label: 'gone', extra: 4 }, { id: 'a', label: 'kept' }]);
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kappa=1\n$/);
  write(b, [{ id: 'b', label: 'kept' }, { id: 'a', label: 'gone' }]);
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /disagreeing ids: a b\nkappa=-1\n$/);
  for (const rows of [[{ id: 'b', label: 'gone' }], [{ id: 'a', label: 'kept' }, { id: 'b', label: 'gone' }, { id: 'c', label: 'gone' }]]) {
    write(b, rows);
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, rows.length === 1 ? /id mismatch: a/ : /id mismatch: c/);
  }
  write(b, [{ id: 'a', label: 'kept' }, { id: 'a', label: 'gone' }]);
  assert.match(run().stderr, /duplicate id a/);
});
