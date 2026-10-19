import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldSession } from '../src/fold.mjs';

const text = n => `Invented request ${n}: keep the brass lantern lit.`;
const message = (n, epoch = 0) => ({ id: String(n), epoch, text: text(n) });
const session = (typed, visible) => ({
  key: 'synthetic', group: 'synthetic', project: 'synthetic', auto: false, sub: false,
  firstMs: 0, lastMs: 123, versions: [], cardResent: false, typed,
  compactions: visible.map((visible, i) => ({ epoch: i + 1, visible })),
});
function grader() {
  return {
    prepares: 0, scores: 0,
    prepare(visible) { this.prepares++; return visible; },
    score(text, visible) {
      this.scores++;
      return visible.includes(text) ? { label: 'kept', score: 1 }
        : visible.includes('rewrite') ? { label: 'reworded', score: 0.5 }
          : { label: 'gone', score: 0 };
    },
  };
}
const fold = (s, seed = 1, g = grader()) => foldSession(s, g, { sampleSeed: seed });
const counts = (kept = 0, reworded = 0, gone = 0) => ({ kept, reworded, gone });
const oracle = JSON.parse(readFileSync(new URL('./fixtures/claude-code/expected.json', import.meta.url))).fixtures;

test('counts code points at both length limits and never grades excluded text', () => {
  const texts = [19, 20, 1500, 1501].flatMap(n => ['x'.repeat(n), 'x'.repeat(n - 1) + '\u{1F41F}']);
  const s = session(texts.map((text, i) => ({ id: String(i), epoch: 0, text })), ['rewrite']);
  const g = grader(), result = fold(s, 1, g);
  assert.equal(result.typed, 8);
  assert.equal(result.labelled, 4);
  assert.deepEqual(result.notCounted, { short: 2, pasted: 2 });
  assert.deepEqual(result.ages, new Map([[1, counts(0, 4)]]));
  assert.equal(g.scores, 4);
  assert.ok(result.auditPool.every(item => [20, 1500].includes([...item.text].length)));
});

test('six-compaction oracle has exact labels at ages 1 to 6', () => {
  const expected = oracle['six-compactions.jsonl'];
  const [{ id, epoch, labels }] = expected.messages;
  const s = session([{ id, epoch, text: text(id) }], labels.map(label => label === 'kept' ? text(id) : ''));
  assert.equal(s.compactions.length, expected.compactions.length);
  const result = fold(s);
  assert.equal(result.typed, expected.typed);
  assert.equal(result.labelled, 1);
  assert.deepEqual([...result.ages.keys()], [1, 2, 3, 4, 5, 6]);
  let previous = Infinity;
  for (const [i, label] of labels.entries()) {
    const row = { ...counts(), [label]: 1 };
    assert.deepEqual(result.ages.get(i + 1), row);
    const denominator = Object.values(row).reduce((a, b) => a + b, 0);
    assert.ok(denominator <= previous);
    previous = denominator;
  }
  assert.deepEqual(result.comp, result.ages);
  assert.deepEqual(result.goneSamples, [{ age: 6, text: text(id), lastMs: s.lastMs }]);
});

test('short-replies oracle counts typing without inventing ages', () => {
  const expected = oracle['short-replies.jsonl'];
  const s = session(expected.messages.map((m, i) => ({ ...m, text: i < 2 ? 'yes' : text(i) })), []);
  const result = fold(s);
  assert.equal(result.typed, expected.typed);
  assert.deepEqual(result.notCounted, { short: expected.rejected.short, pasted: 0 });
  assert.equal(result.labelled, 0);
  assert.equal(result.ages.size, 0);
  assert.equal(result.comp.size, 0);
  assert.deepEqual(result.auditPool, []);
  assert.deepEqual(result.goneSamples, []);
});

test('unmeasurable compactions leave gaps and prepare runs once per readable compaction', () => {
  const s = session([message('a'), message('b', 1), message('later', 3)], [text('a'), null, text('b')]);
  const g = grader(), result = fold(s, 1, g);
  assert.equal(g.prepares, 2);
  assert.equal(g.scores, 3);
  assert.equal(result.typed, 3);
  assert.equal(result.labelled, 2);
  assert.deepEqual(result.ages, new Map([[1, counts(1)], [3, counts(0, 0, 1)], [2, counts(1)]]));
  assert.equal(result.comp.size, 0);
  assert.ok(result.auditPool.every(item => item.text !== text('later') && item.visibleIdx !== 1));
  assert.deepEqual(result.goneSamples, [{ age: 3, text: text('a'), lastMs: s.lastMs }]);
  const unreadable = fold(session([message('a')], [null, null]));
  assert.equal(unreadable.labelled, 0);
  assert.equal(unreadable.ages.size, 0);
});

test('composition includes only messages labelled at all of ages 1, 2 and 3', () => {
  const s = session([message('a'), message('b', 1), message('c', 2)], [text('a'), 'rewrite', '', text('b')]);
  const result = fold(s);
  assert.deepEqual(result.ages, new Map([[1, counts(1, 1, 1)], [2, counts(0, 1, 2)], [3, counts(1, 0, 1)], [4, counts(0, 0, 1)]]));
  assert.deepEqual(result.comp, new Map([[1, counts(1, 1)], [2, counts(0, 1, 1)], [3, counts(1, 0, 1)], [4, counts(0, 0, 1)]]));
  const missingFirst = fold(session([message('a')], [null, '', '', '']));
  assert.equal(missingFirst.comp.size, 0);
  assert.equal(missingFirst.ages.size, 3);
});

test('gone samples use the highest labelled age and newest typing, capped at twenty', () => {
  const typed = Array.from({ length: 30 }, (_, i) => message(i, Math.floor(i / 10)));
  const s = session(typed, ['', '', '', '', null]);
  const result = fold(s);
  assert.deepEqual(result.goneSamples, typed.slice(10).reverse().map(m => ({
    age: 4 - m.epoch, text: m.text, lastMs: s.lastMs,
  })));
  const returned = fold(session([message('back'), message('new', 1)], ['', text('back')]));
  assert.deepEqual(returned.goneSamples, []);
});

test('audit reservoir is seeded, bounded and contains labelled pairs with their scores', () => {
  const s = session(Array.from({ length: 10 }, (_, i) => message(i)), [
    Array.from({ length: 10 }, (_, i) => text(i)).join('\n'), 'rewrite', '',
  ]);
  const result = fold(s);
  assert.equal(result.auditPool.length, 5);
  assert.deepEqual(result.auditPool, fold(s).auditPool);
  assert.notDeepEqual(result.auditPool, fold(s, 2).auditPool);
  assert.deepEqual(result.auditPool.map(item => [s.typed.findIndex(m => m.text === item.text), item.age]),
    [[2, 1], [9, 1], [5, 3], [6, 3], [6, 2]]);
  for (const item of result.auditPool) {
    assert.equal(item.visibleIdx, item.age - 1);
    assert.equal(item.label, ['kept', 'reworded', 'gone'][item.visibleIdx]);
    assert.equal(item.score, [1, 0.5, 0][item.visibleIdx]);
    assert.ok(s.typed.some(m => m.text === item.text));
  }
  const small = fold(session([message('a')], [text('a'), 'rewrite']));
  assert.deepEqual(small.auditPool, [
    { age: 1, label: 'kept', score: 1, text: text('a'), visibleIdx: 0 },
    { age: 2, label: 'reworded', score: 0.5, text: text('a'), visibleIdx: 1 },
  ]);
});

test('empty visible text is measurable, including compactions before any counted typing', () => {
  const g = grader(), result = fold(session([message('later', 1)], ['']), 1, g);
  assert.equal(g.prepares, 1);
  assert.equal(g.scores, 0);
  assert.equal(result.labelled, 0);
  assert.equal(result.ages.size, 0);
});

test('automated and subagent sessions are never graded', () => {
  for (const flag of ['auto', 'sub']) {
    const g = grader(), result = fold({ ...session([message('a')], [text('a')]), [flag]: true }, 1, g);
    assert.equal(result.typed, 1);
    assert.equal(result.labelled, 0);
    assert.equal(g.prepares, 0);
    assert.equal(g.scores, 0);
  }
});
