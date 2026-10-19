import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { render } from '../scripts/gen-long.mjs';
import claude from '../src/agents/claude-code.mjs';
import codex from '../src/agents/codex.mjs';
import { prepare, score } from '../src/grade.mjs';
import { foldSession } from '../src/fold.mjs';
import { combine, curve, span, measurable } from '../src/stats.mjs';

const started = performance.now();
const load = async path => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
const story = await load(new URL('./long/saga-01.story.jsonl', import.meta.url));
const fateRoot = new URL('./long/fates/', import.meta.url);
const fates = await Promise.all((await readdir(fateRoot)).sort().map(name => load(new URL(name, fateRoot))));
const labelAt = (row, age) => row.labels ? row.labels[age - 1] :
  age <= row.keptTo ? 'kept' : age <= row.rewordedTo ? 'reworded' : 'gone';
const epochOf = turn => Math.floor((turn - 1) / story[0].compactEvery);
const tally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0,
  types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
async function sessions(adapter, root) {
  const result = [];
  for await (const session of adapter.sessions(await adapter.listFiles(root), tally())) result.push(session);
  return result;
}
function expected(cardResent) {
  return Array.from({ length: 30 }, (_, i) => {
    const age = i + 1, row = { age, messages: 0, sessions: 0, kept: 0, reworded: 0, gone: 0 };
    for (const [head, ...turns] of fates) {
      if (head.cardResent !== cardResent) continue;
      let messages = 0;
      for (const fate of turns) {
        if (epochOf(fate.turn) + age > 30) continue;
        row[labelAt(fate, age)] += 3;
        row.messages += 3;
        messages++;
      }
      if (messages) row.sessions += 3;
    }
    return row;
  });
}
function expectedSpan(rows) {
  const headlineAge = rows.filter(row => row.age >= 2 && measurable(row)).at(-1)?.age ?? null;
  if (!measurable(rows[0])) return { span: null, censored: false, headlineAge };
  const firstFailure = rows.findIndex(row => !measurable(row) || row.kept * 100 < 50 * row.messages);
  return { span: firstFailure < 0 ? rows.length : firstFailure,
    censored: rows.every(row => !measurable(row) || row.kept * 100 >= 50 * row.messages), headlineAge };
}
function checkRows(actual, wanted, context, t) {
  for (const row of wanted) {
    const got = actual.find(item => item.age === row.age);
    assert.ok(got, `${context} age ${row.age}`);
    for (const key of ['messages', 'sessions', 'kept']) assert.equal(got[key], row[key], `${context} age ${row.age} ${key}`);
    assert.equal(got.reworded + got.gone, row.reworded + row.gone);
    if (got.reworded === row.reworded && got.gone === row.gone) assert.deepEqual(got, row);
    else t.diagnostic(`${context} age ${row.age}: expected kept/reworded/gone ${row.kept}/${row.reworded}/${row.gone}; got ${got.kept}/${got.reworded}/${got.gone}`);
  }
}
function checkedFold(session, fate) {
  const rows = new Map(fate.slice(1).map(row => [row.turn, row]));
  const turns = new Map(story.slice(1).map(turn => [turn.text, turn]));
  const indices = new Map(), ages = new Map();
  let boundary = 0;
  const grader = {
    prepare(visible) { const index = prepare(visible); indices.set(index, { epoch: ++boundary, visible }); return index; },
    score(text, index) {
      const turn = turns.get(text), { epoch, visible } = indices.get(index), age = epoch - epochOf(turn.turn);
      const result = score(text, index), wanted = labelAt(rows.get(turn.turn), age);
      if ((wanted === 'kept') !== (result.label === 'kept')) {
        assert.fail(`STUCK ${fate[0].session} turn ${turn.turn} age ${age} score ${result.score}: expected ${wanted}, got ${result.label}`);
      }
      assert.equal(visible.includes(text), wanted === 'kept');
      assert.equal(visible.includes(turn.reworded), wanted === 'reworded');
      if (!ages.has(turn.turn)) ages.set(turn.turn, []);
      ages.get(turn.turn).push(age);
      return result;
    },
  };
  const fold = foldSession(session, grader, { sampleSeed: 1 });
  assert.equal(session.typed.length, story.length - 1);
  assert.deepEqual(fold.notCounted, {
    short: story.slice(1).filter(turn => Array.from(turn.text).length < 20).length,
    pasted: story.slice(1).filter(turn => Array.from(turn.text).length > 1500).length,
  });
  for (const turn of story.slice(1)) {
    const typed = session.typed.find(message => message.text === turn.text);
    assert.equal(typed.epoch, epochOf(turn.turn));
    const length = Array.from(turn.text).length;
    if (length < 20 || length > 1500) {
      for (const compaction of session.compactions) assert.ok(!compaction.visible.includes(turn.text));
    }
    const count = length < 20 || length > 1500 ? 0 : session.compactions.length - typed.epoch;
    assert.deepEqual(ages.get(turn.turn) ?? [], Array.from({ length: count }, (_, i) => i + 1));
  }
  return fold;
}

test('both agents retain exactly the fate counts through thirty compactions', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'goldfished-long-'));
  try {
    for (const adapter of [claude, codex]) {
      const directory = join(root, adapter.id), metadata = new Map();
      for (const fate of fates) for (const copy of [0, 1, 2]) {
        const path = await render(story, fate, { agent: adapter.id, copy, root: directory });
        metadata.set(path, fate);
      }
      const parsed = await sessions(adapter, directory);
      assert.equal(parsed.length, 36);
      assert.equal(parsed.filter(session => session.cardResent).length, 12);
      const plain = [], card = [];
      for (const session of parsed) {
        const fate = metadata.get(session.key);
        assert.equal(session.cardResent, fate[0].cardResent);
        assert.equal(session.compactions.length, 30);
        (session.cardResent ? card : plain).push(checkedFold(session, fate));
      }
      assert.equal(plain.length, 24);
      for (const [resent, folds] of [[false, plain], [true, card]]) {
        const combined = combine(folds);
        const allRows = [...combined.total].map(([age, c]) => ({ age, messages: c.kept + c.reworded + c.gone, ...c }));
        checkRows(allRows, expected(resent), `${adapter.id} ${resent ? 'card' : 'plain'}`, t);
        if (resent) continue;
        const rows = curve(combined), wanted = expected(false);
        checkRows(rows, wanted.slice(0, 6), `${adapter.id} curve`, t);
        assert.equal(rows.length, 6);
        assert.deepEqual(span(rows), expectedSpan(wanted.slice(0, 6)));
        assert.deepEqual(span(allRows), expectedSpan(wanted));
        assert.equal(measurable(allRows.find(row => row.age === 30)), false);
        t.diagnostic(`${adapter.id} plain kept: ` + [1, 2, 3, 6, 10, 20, 30]
          .map(age => `${age}=${combined.total.get(age).kept}`).join(', '));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resumed files dedupe and turns after the last compaction have no ages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'goldfished-long-resume-'));
  try {
    for (const adapter of [claude, codex]) {
      const directory = join(root, adapter.id), fate = fates[2], prefix = story.slice(0, 4);
      const first = await render(prefix, fate, { agent: adapter.id, copy: 0, root: directory });
      const original = await sessions(adapter, directory);
      const second = await render(prefix, fate, { agent: adapter.id, copy: 2, root: directory, resumedCopy: true });
      assert.deepEqual(await readFile(second), await readFile(first));
      const files = await adapter.listFiles(directory);
      assert.deepEqual(files.map(({ file }) => file).sort(), [first, second].sort());
      const resumed = [];
      for await (const session of adapter.sessions(files, tally())) resumed.push(session);
      assert.equal(resumed.length, 2);
      assert.deepEqual(resumed.map(({ key }) => key).sort(), [first, second].sort());
      assert.deepEqual(resumed.flatMap(s => s.typed), original.flatMap(s => s.typed));
      const session = original[0], seen = [];
      const fold = foldSession(session, { prepare, score(text, index) { seen.push(text); return score(text, index); } }, { sampleSeed: 1 });
      assert.equal(session.typed.at(-1).epoch, 1);
      assert.ok(!seen.includes(story[3].text));
      assert.equal(fold.labelled, 2);
      assert.deepEqual([...fold.ages.keys()], [1]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the committed eight-compaction fixture is the binary rendering of f03', async () => {
  const root = await mkdtemp(join(tmpdir(), 'goldfished-long-fixture-'));
  try {
    const file = await render(story.slice(0, 17), fates[2], { agent: 'claude-code', copy: 0, root, fixture: true });
    assert.deepEqual(await readFile(file), await readFile(new URL('./fixtures/claude-code/eight-compactions.jsonl', import.meta.url)));
    const [session] = await sessions(claude, root);
    for (const compaction of session.compactions) for (const turn of story.slice(1, 17)) {
      if (epochOf(turn.turn) >= compaction.epoch) continue;
      const row = fates[2].find(row => row.turn === turn.turn);
      const kept = row && labelAt(row, compaction.epoch - epochOf(turn.turn)) === 'kept';
      assert.equal(compaction.visible.includes(turn.text), Boolean(kept));
      if (turn.reworded) assert.equal(compaction.visible.includes(turn.reworded), false);
    }
    const words = text => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
    const padding = words(session.compactions.at(-1).visible.split('\n')[0]);
    const runs = padding.slice(4).map((_, i) => padding.slice(i, i + 5).join(' '));
    for (const turn of story.slice(1)) for (const text of [turn.text, turn.reworded ?? '']) {
      const tokens = ' ' + words(text).join(' ') + ' ';
      for (const run of runs) assert.ok(!tokens.includes(' ' + run + ' '));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the whole long session test file finishes within sixty seconds', () => {
  assert.ok(performance.now() - started < 60000);
});
