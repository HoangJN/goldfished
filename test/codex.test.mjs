import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import adapter from '../src/agents/codex.mjs';
import { adapters } from '../src/agents/index.mjs';
import { decode, mayNeed } from '../src/agents/codex.dialect.mjs';
import { writeGenerated } from './fixtures/codex/generated.mjs';

const root = resolve('test/fixtures/codex');
test('Codex follows Claude Code in the registry', () => {
  const first = adapters.findIndex(a => a.id === 'claude-code');
  assert.ok(first >= 0);
  assert.ok(adapters.indexOf(adapter) > first);
});
const tally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0,
  types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
async function load(files) {
  const counts = tally(), sessions = [];
  for await (const session of adapter.sessions(files.map(file => ({ file, group: root })), counts)) sessions.push(session);
  return { sessions, counts };
}
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'goldfished-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function actual(sessions, counts) {
  const rejected = Object.fromEntries(counts.rejects);
  for (const { typed } of sessions) for (const { text } of typed) {
    const reason = text.length < 20 ? 'short' : text.length > 1500 ? 'pasted' : null;
    if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
  }
  return {
    sessions: sessions.length, auto: sessions.filter(s => s.auto).length, sub: sessions.filter(s => s.sub).length,
    typed: sessions.reduce((sum, s) => sum + s.typed.length, 0), rejected,
    compactions: sessions.flatMap(s => s.compactions.map(c => ({ visible: c.visible === null ? 'null' : 'found',
      pre: c.pre ?? null, post: c.post ?? null, trigger: c.trigger ?? null }))),
    messages: sessions.flatMap(s => s.typed.map(m => ({ id: String(m.id), epoch: m.epoch,
      labels: s.compactions.slice(m.epoch).map(c => c.visible === null ? null : c.visible.includes(m.text) ? 'kept' : 'gone') }))),
    drift: !adapter.driftCheck(counts).ok,
    cardResent: sessions.some(s => s.cardResent),
  };
}

test('every Codex fixture agrees with its independent oracle', async t => {
  const oracle = JSON.parse(await readFile(join(root, 'expected.json'), 'utf8'));
  const generated = await writeGenerated(await scratch(t));
  for (const [name, expected] of Object.entries({ ...oracle.fixtures, ...oracle.generated })) {
    const { sessions, counts } = await load([generated[name] ?? join(root, name)]);
    assert.deepEqual(actual(sessions, counts), expected, name);
    for (const session of sessions) assert.equal(session.cardResent, expected.cardResent, name);
    assert.ok(sessions[0].project.startsWith(name.includes('large-compacted') ? 'large-kettle' : 'copper-kettle'));
    assert.equal(counts.malformed, 0);
    sessions[0].compactions.forEach((c, i) => assert.equal(c.epoch, i + 1));
  }
});
test('only a separate developer card item sets the re-send flag', async t => {
  const source = await readFile(join(root, 'sessions/2026/01/06/rollout-card-resent.jsonl'), 'utf8');
  const records = source.trim().split('\n').map(line => JSON.parse(line));
  const hooks = records.filter(record => record.type === 'response_item');
  const withoutHooks = records.filter(record => record.type !== 'response_item');
  const file = join(await scratch(t), 'card-variant.jsonl');
  const variants = [
    [[], false], [[hooks[0]], true], [[hooks[1]], true],
    [hooks.map(record => ({ ...record, payload: { ...record.payload, content: [{ type: 'input_text', text: 'another tool: context' }] } })), false],
    [hooks.map(record => ({ ...record, payload: { ...record.payload, role: 'assistant' } })), false],
    [hooks.map(record => ({ ...record, payload: { ...record.payload, type: 'other_item' } })), false],
  ];
  for (const [extra, expected] of variants) {
    await writeFile(file, [...withoutHooks, ...extra].map(record => JSON.stringify(record)).join('\n') + '\n');
    const { sessions, counts } = await load([file]);
    assert.equal(sessions[0].cardResent, expected);
    assert.equal(adapter.driftCheck(counts).ok, true);
  }
  for (const hook of hooks) assert.equal(mayNeed(JSON.stringify(hook)), true);
  for (const record of records.filter(record => record.type === 'compacted')) assert.equal(decode(JSON.stringify(record), 1).cardResent, false);
});

test('drift mutants are caught and unread compactions are counted', async t => {
  const dir = await scratch(t);
  const source = await readFile(join(root, 'sessions/2026/01/05/rollout-one-compaction.jsonl'), 'utf8');
  for (const [before, after] of [['compacted', 'compacted_future'], ['replacement_history', 'future_history']]) {
    const file = join(dir, 'mutant.jsonl');
    await writeFile(file, source.replaceAll(before, after));
    const { counts } = await load([file]);
    assert.equal(adapter.driftCheck(counts).ok, false);
    assert.equal(adapter.driftCheck(counts).unread, 1);
  }
});

test('discovery, time filter, newest cwd match, empty and missing sessions', async t => {
  const dir = await scratch(t), sessionsRoot = join(dir, 'sessions');
  const older = join(sessionsRoot, '2026/01/05/rollout-old.jsonl');
  const newer = join(dirname(older), 'rollout-new.jsonl');
  const source = await readFile(join(root, 'sessions/2026/01/05/rollout-exec.jsonl'), 'utf8');
  await mkdir(dirname(older), { recursive: true });
  await writeFile(older, source);
  await writeFile(newer, source.split('\n').slice(0, 2).join('\n') + '\n');
  await writeFile(join(dirname(older), 'ignored.jsonl'), source);
  await utimes(older, 1, 1); await utimes(newer, 2, 2);
  assert.equal((await adapter.listFiles(sessionsRoot)).length, 2);
  assert.deepEqual((await adapter.listFiles(sessionsRoot, { sinceMs: 1500 })).map(f => f.file), [newer]);
  assert.deepEqual(await adapter.findTyped('/srv/work/copper-kettle', [sessionsRoot]), []);
  assert.equal(await adapter.findTyped('/srv/work/absent', [sessionsRoot]), null);
  assert.deepEqual(await adapter.listFiles(join(dir, 'missing')), []);
  await utimes(older, 3, 3);
  assert.equal((await adapter.findTyped('/srv/work/copper-kettle', [sessionsRoot])).length, 1);
  assert.deepEqual(adapter.roots({ CODEX_HOME: dir }, 'unused'), [join(dir, 'sessions')]);
  assert.deepEqual(adapter.roots({}, dir), [join(dir, '.codex/sessions')]);
});

test('typed dedupe crosses files while compactions still age each session', async () => {
  const file = join(root, 'sessions/2026/01/05/rollout-after-compaction.jsonl');
  const { sessions } = await load([file, file]);
  assert.equal(sessions[0].typed.length, 2);
  assert.equal(sessions[1].typed.length, 0);
  assert.equal(sessions[1].compactions.length, 1);
});

test('dialect scans drift shapes without parsing irrelevant lines', () => {
  const record = decode('{"type":"renamed","payload":{"type":"future_message","role":"user"}}', 1);
  assert.equal(record.conversation, true);
  assert.equal(record.known, false);
  assert.equal(decode('{"type":"future_bookkeeping","payload":{"sequence":17}}', 1).conversation, false);
  assert.equal(decode('{"type":"session_meta","payload":{"source":"unknown","originator":"unknown"}}', 1).unknown.length, 2);
  assert.equal(mayNeed('{"type":"compacted"}'), true);
  assert.equal(mayNeed('{"type":"response_item"}'), false);
});

test('irrelevant long lines are skipped; blank and partial lines have no type', async t => {
  const file = join(await scratch(t), 'long.jsonl');
  await writeFile(file, '{"type":"response_item","payload":{"padding":"' + 'x'.repeat(17 * 1024 * 1024) + '"}}\n\n{"type":"event_msg","payload":');
  const { counts } = await load([file]);
  assert.equal(counts.skippedLong, 1);
  assert.equal(counts.malformed, 0);
  assert.equal(counts.types.size, 0);
});

test('I4 uses conversation share and malformed line share', async t => {
  const file = join(await scratch(t), 'drift.jsonl');
  for (const source of ['{"type":"renamed","payload":{"role":"user"}}\n', '{"type":"event_msg","payload":{"type":"user_message"}\n']) {
    await writeFile(file, source);
    const { counts } = await load([file]);
    assert.deepEqual(adapter.driftCheck(counts).reasons, ['I4']);
  }
});
