import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { b1, b2, b3, b4, b5, b6, b7, b7n, b8, wilson } from '../scripts/bars.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'goldfished bars '));
after(() => rmSync(scratch, { recursive: true, force: true }));
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const repeat = (n, label, predicted) => Array.from({ length: n }, () => [label, predicted]);
const result = (bar, expected) => assert.equal(bar.result, expected, bar.id);
test('95% Wilson limits match published score interval figures for n=10', () => {
  for (const [k, lo, hi] of [[0, 0, 0.277533], [10, 0.722467, 1], [5, 0.236593, 0.763407]]) {
    const bounds = wilson(k, 10);
    close(bounds[0], lo); close(bounds[1], hi);
  }
  assert.ok(wilson(0, 0).every(Number.isNaN));
  assert.throws(() => wilson(11, 10), /invalid Wilson/);
});
test('B1 and B2 clear their boundary and fail below it', () => {
  result(b1([[17, 3, 0], [0, 0, 0], [0, 0, 0]]), 'pass');
  result(b1([[16, 4, 0], [0, 0, 0], [0, 0, 0]]), 'fail');
  const pass = b2([[7, 1, 0], [1, 7, 0], [0, 0, 0]]);
  close(pass.value, 0.75); result(pass, 'pass');
  result(b2([[7, 2, 0], [1, 6, 0], [0, 0, 0]]), 'fail');
  close(pass.lo, 2 * wilson(14, 16)[0] - 1);
});
test('B3 precision and recall each require nine tenths', () => {
  b3([[9, 1, 0], [1, 9, 0], [0, 0, 0]]).forEach(b => { close(b.value, 0.9); result(b, 'pass'); });
  const precision = b3([[9, 1, 0], [2, 8, 0], [0, 0, 0]]);
  result(precision[0], 'fail'); result(precision[1], 'pass');
  const recall = b3([[9, 2, 0], [1, 8, 0], [0, 0, 0]]);
  result(recall[0], 'pass'); result(recall[1], 'fail');
});
test('B4 counts swaps in both directions, B5 measures only the supplied short pairs', () => {
  const pass = b4([[5, 0, 1], [0, 5, 0], [2, 0, 5]]);
  assert.equal(pass.value, 3); result(pass, 'pass');
  result(b4([[5, 0, 2], [0, 5, 0], [2, 0, 5]]), 'fail');
  result(b5([...repeat(4, 'kept', 'kept'), ['gone', 'kept']]), 'pass');
  result(b5([...repeat(3, 'kept', 'kept'), ...repeat(2, 'gone', 'kept')]), 'fail');
});
test('B6 and B7n allow one false kept and do not count a true kept', () => {
  for (const bar of [b6, b7n]) {
    const pairs = [...repeat(8, 'gone', 'gone'), ['kept', 'kept'], ['reworded', 'kept']];
    assert.equal(bar(pairs).value, 1); result(bar(pairs), 'pass');
    pairs[0] = ['gone', 'kept']; result(bar(pairs), 'fail');
  }
});
test('B7 permits one percent kept and five percent reworded, independently', () => {
  const pairs = [...repeat(94, 'gone', 'gone'), ...repeat(5, 'gone', 'reworded'), ['gone', 'kept']];
  b7(pairs).forEach(b => result(b, 'pass'));
  pairs[0] = ['gone', 'kept']; result(b7(pairs)[0], 'fail');
  pairs[0] = ['gone', 'reworded']; result(b7(pairs)[1], 'fail');
});
test('B8 reports signed kept share drift; unsupported gated bars fail', () => {
  const m = [[4, 0, 0], [1, 2, 0], [0, 0, 3]];
  close(b8(m).value, 0.1); result(b8(m), 'report');
  close(b8(m).lo, wilson(5, 10)[0] - 0.4); close(b8(m).hi, wilson(5, 10)[1] - 0.4);
  close(b8([[4, 1, 0], [0, 2, 0], [0, 0, 3]]).value, -0.1);
  for (const bar of [b1([[0, 0, 0], [0, 0, 0], [0, 0, 0]]), b5([]), b6([]), b7n([]), ...b7([])]) result(bar, 'fail');
});
test('CLI runs a stub grader, evaluates every directed cross pair, and gates the results', () => {
  const file = join(scratch, 'pairs.jsonl'), stub = join(scratch, 'stub.mjs');
  const rows = ['kept', 'reworded', 'gone'].map((label, i) => ({ id: String(i), band: 'short',
    stratum: ['exact', 'condition', 'near_miss'][i], message: String(i), summary: `${i}:${label}`, label, _synthetic: true }));
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const code = "export const prepare = text => text.split(':');\nexport const score = (text, index) => ({label: text === index[0] ? index[1] : 'gone', score: 1});\n";
  const run = () => spawnSync(process.execPath, ['--import', './test/no-network.mjs', 'scripts/bars.mjs', file, '--grader', stub], { encoding: 'utf8' });
  writeFileSync(stub, code);
  let r = run();
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /bars=pass\n$/);
  const lines = r.stdout.split('\n').filter(line => line.startsWith('bar='));
  assert.equal(lines.length, 11);
  for (const line of lines) assert.match(line, /^bar=\w+ value=\S+ lo=\S+ hi=\S+ threshold=\S+ result=(pass|fail|report)$/);
  for (const id of ['B1', 'B2', 'B3p', 'B3r', 'B4', 'B5', 'B6', 'B7k', 'B7r', 'B7n', 'B8']) assert.ok(lines.some(line => line.startsWith(`bar=${id} `)));
  writeFileSync(stub, code.replace(": 'gone'", ": text === '0' && index[0] === '1' ? 'kept' : 'gone'"));
  r = run();
  assert.equal(r.status, 2, r.stderr); assert.match(r.stdout, /bars=fail\n$/);
  const cross = r.stdout.split('\n').find(line => line.startsWith('bar=B7k '));
  close(Number(/value=(\S+)/.exec(cross)[1]), 1 / 6);
  assert.match(cross, /result=fail$/);
});
