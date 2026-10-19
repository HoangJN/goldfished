import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combine, curve, bootstrap, span, shifted, measurable } from '../src/stats.mjs';
import { mulberry32 } from '../src/prng.mjs';
import { verdict } from '../src/fun.mjs';

const counts = (kept, gone, reworded = 0) => ({ kept, reworded, gone });
const fold = (ages, comp = []) => ({ ages: new Map(ages), comp: new Map(comp),
  notCounted: { short: 0, pasted: 0 }, typed: 0, labelled: 0, goneSamples: [], auditPool: [] });
const row = (age, kept, messages = 100, sessions = 10) =>
  ({ age, kept, messages, sessions, reworded: 0, gone: messages - kept });

function independently(rows) {
  let headlineAge = null, firstMissing = null, failed = false;
  for (let age = 1; age <= 6; age++) {
    const r = rows.find(item => item.age === age);
    const enough = r && r.sessions >= 10 && r.messages >= 50;
    if (enough && age >= 2) headlineAge = age;
    const passes = enough && r.kept * 2 >= r.messages;
    if (!passes && firstMissing === null) firstMissing = age;
    if (enough && !passes) failed = true;
  }
  const first = rows.find(r => r.age === 1);
  const value = !first || first.messages < 50 || first.sessions < 10 ? null : (firstMissing ?? 7) - 1;
  return { span: value, censored: value !== null && !failed, headlineAge };
}

test('200 seeded curves agree with a separate reading of the span rules', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed), rows = [];
    let d = 300;
    for (let age = 1; age <= 6; age++) {
      d = Math.floor(d * (0.5 + rng() / 2));
      rows.push(row(age, Math.floor(rng() * (d + 1)), d, Math.min(d, Math.floor(rng() * 19))));
    }
    const expected = independently(rows), actual = span(rows), v = verdict(actual);
    assert.deepEqual(actual, expected, `seed ${seed}`);
    const tier = expected.span === null ? 'too_early' : expected.censored ? 'at_least' :
      ['goldfish', 'short', 'fair'][expected.span] ?? 'long';
    assert.equal(v.id, tier);
    if (v.line.startsWith('Long')) assert.ok(actual.span >= 3 && !actual.censored);
    if (actual.censored) assert.equal(v.line, `At least ${actual.span} compactions so far.`);
  }
});

test('span, censoring, headline and the gate use exact ratios', () => {
  assert.equal(measurable(row(1, 49, 49, 10)), false);
  assert.equal(measurable(row(1, 50, 50, 9)), false);
  assert.equal(measurable(row(1, 50, 50, 10)), true);
  assert.deepEqual(span([row(1, 499, 1000)]), { span: 0, censored: false, headlineAge: null });
  assert.deepEqual(span([row(1, 25, 50)]), { span: 1, censored: true, headlineAge: null });
  assert.deepEqual(span([row(1, 50), row(2, 0, 49), row(3, 60)]),
    { span: 1, censored: true, headlineAge: 3 });
  assert.deepEqual(span([row(1, 0, 49), row(2, 60)]),
    { span: null, censored: false, headlineAge: 2 });
  assert.deepEqual(span([]), { span: null, censored: false, headlineAge: null });
});

test('composition compares exact fractions and uses the comp maps', () => {
  const main = [row(1, 1, 2)], comp = [row(1, 11, 20)];
  assert.equal(shifted(main, comp), false);
  assert.equal(shifted(main, [row(1, 551, 1000)]), true);
  assert.equal(shifted(main, [row(1, 449, 1000)]), true);
  assert.equal(shifted(main, [row(1, 45, 100)]), false);
  assert.equal(shifted([], comp), false);
  const f = fold([[1, counts(8, 2)]], [[1, counts(2, 8)]]);
  assert.equal(curve(combine([f], 'comp'))[0].kept, 2);
  assert.equal(curve(combine([f]))[0].kept, 8);
});

test('oracle labels produce six exact-age rows without summing ages', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/claude-code/expected.json', import.meta.url), 'utf8'));
  function find(x) {
    if (!x || typeof x !== 'object') return;
    return x['six-compactions.jsonl'] ?? Object.values(x).map(find).find(Boolean);
  }
  const oracle = find(json), ages = new Map();
  for (const m of oracle.messages) m.labels.forEach((label, i) => {
    const c = ages.get(i + 1) ?? counts(0, 0);
    c[label]++;
    ages.set(i + 1, c);
  });
  const result = curve(combine([fold(ages)]));
  assert.deepEqual(result.map(r => r.age), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.map(r => r.messages), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(result.map(r => r.kept), [1, 0, 1, 0, 1, 0]);
  assert.ok(result.every((r, i) => !i || r.messages <= result[i - 1].messages));
  assert.ok(result.every(r => !measurable(r) && r.sessions === 1));
});

test('combine counts contributing sessions, fills gaps and stops at six', () => {
  const f = fold([[1, counts(2, 3, 1)], [3, counts(1, 0)], [7, counts(1, 0)]]);
  const ages = combine([f, fold([[1, counts(0, 0)]])]);
  assert.equal(curve(ages)[0].messages, 6);
  assert.equal(curve(ages)[0].sessions, 1);
  assert.deepEqual(curve(ages)[1], row(2, 0, 0, 0));
  assert.equal(curve(ages).length, 6);
  assert.deepEqual(curve(combine([])), []);
  assert.equal(f.ages.get(1).kept, 2);
});

test('mulberry32 seed 1 has five fixed outputs', () => {
  const rng = mulberry32(1);
  assert.deepEqual(Array.from({ length: 5 }, () => rng()), [0.6270739405881613,
    0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]);
});

test('bootstrap has three pinned ranges and ignores empty sessions', () => {
  assert.deepEqual(bootstrap(combine([]), 1), [null, null]);
  assert.deepEqual(bootstrap(combine([fold([[1, counts(0, 0)]])]), 1), [null, null]);
  const inputs = [[[2, 8], [8, 2]], [[0, 10], [5, 5], [10, 0]],
    [[1, 2], [7, 4], [4, 16], [9, 1], [0, 9]]];
  const ranges = [[20, 80], [0, 83.33333333333333], [13.636363636363637, 73.33333333333333]];
  inputs.forEach((input, i) => {
    const folds = input.map(([k, g]) => fold([[1, counts(k, g)]]));
    const ages = combine(folds);
    assert.deepEqual(bootstrap(ages, 1), ranges[i]);
    assert.deepEqual(bootstrap(ages, 1, { B: 1000, seed: 1 }), ranges[i]);
    assert.deepEqual(bootstrap(combine([...folds, fold([]), fold([[1, counts(0, 0)]])]), 1), ranges[i]);
  });
});

test('bootstrap agrees with separate session sampling and percentile indexing', () => {
  const input = [[1, counts(1, 2)], [1, counts(7, 4)], [1, counts(4, 16)],
    [1, counts(9, 1)], [1, counts(0, 9)]];
  const rng = mulberry32(1), draws = [];
  for (let i = 0; i < 1000; i++) {
    const sample = Array.from({ length: input.length }, () => input[Math.trunc(rng() * input.length)][1]);
    const numerator = sample.reduce((n, c) => n + c.kept, 0);
    const denominator = sample.reduce((n, c) => n + c.kept + c.gone + c.reworded, 0);
    draws.push(numerator / denominator);
  }
  draws.sort((a, b) => a - b);
  const expected = [100 * draws[24], 100 * draws[974]];
  const actual = bootstrap(combine(input.map(entry => fold([entry]))), 1);
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-12));
});

test('95% bootstrap coverage at ten and twenty sessions', t => {
  const coverage = [10, 20].map(sessions => {
    const rng = mulberry32(7021);
    let covered = 0;
    for (let user = 0; user < 500; user++) {
      const folds = Array.from({ length: sessions }, () => {
        const probability = 0.2 + 0.6 * rng();
        let kept = 0;
        for (let m = 0; m < 10; m++) if (rng() < probability) kept++;
        return fold([[1, counts(kept, 10 - kept)]]);
      });
      const [lo, hi] = bootstrap(combine(folds), 1);
      if (lo <= 50 && hi >= 50) covered++;
    }
    t.diagnostic(`${sessions} sessions: ${covered}/500 (${covered / 5}%)`);
    return covered;
  });
  assert.ok(coverage.every(n => n >= 450), `coverage: ${coverage.map(n => n / 5 + '%').join(', ')}`);
});
