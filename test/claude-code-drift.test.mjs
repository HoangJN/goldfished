import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '../src/agents/claude-code.mjs';
import { writeGenerated } from './fixtures/claude-code/generated.mjs';

const root = new URL('./fixtures/claude-code/', import.meta.url);
const oracle = JSON.parse(await readFile(new URL('expected.json', root), 'utf8'));
const tally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0,
  types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
let scratch, generated;
before(async () => { scratch = await mkdtemp(join(tmpdir(), 'goldfished-drift-')); generated = await writeGenerated(scratch); });
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });
async function collect(files) {
  const counts = tally(), sessions = [];
  for await (const session of adapter.sessions(files, counts)) sessions.push(session);
  return { sessions, counts };
}
async function filesAt(file) {
  const info = await stat(file);
  return info.isDirectory() ? adapter.listFiles(file) : [{ file, group: 'fixture', ...info }];
}
function check({ sessions, counts }, expected) {
  const typed = sessions.flatMap(s => s.typed);
  const rejected = Object.fromEntries([...counts.rejects].filter(([reason]) => reason !== 'not_user'));
  for (const { text } of typed) {
    const reason = text.length < 20 ? 'short' : text.length > 1500 ? 'pasted' : null;
    if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
  }
  assert.deepEqual({ sessions: sessions.length, auto: sessions.filter(s => s.auto).length,
    sub: sessions.filter(s => s.sub).length, typed: typed.length, rejected,
    compactions: sessions.flatMap(s => s.compactions.map(c => ({ visible: c.visible === null ? 'null' : 'found',
      pre: c.pre ?? null, post: c.post ?? null, trigger: c.trigger ?? null }))),
    messages: typed.map(({ id, epoch }) => ({ id, epoch })), drift: !adapter.driftCheck(counts).ok,
    cardResent: sessions.some(s => s.cardResent) },
  { ...expected, messages: expected.messages.map(({ id, epoch }) => ({ id, epoch })) });
  for (const session of sessions) {
    session.compactions.forEach((c, i) => assert.equal(c.epoch, i + 1));
    for (const message of session.typed) {
      expected.messages.find(item => item.id === message.id).labels.forEach((label, i) => {
        const visible = session.compactions[message.epoch + i].visible;
        if (label === null) assert.equal(visible, null);
        else assert.equal(visible.includes(message.text), label === 'kept');
      });
    }
  }
}
for (const [name, expected] of Object.entries(oracle.fixtures)) {
  test('full oracle: ' + name, async () => check(await collect(await filesAt(fileURLToPath(new URL(name, root)))), expected));
}
for (const [name, expected] of Object.entries(oracle.generated)) {
  test('full generated oracle: ' + name, async () => check(await collect(await filesAt(generated[name])), expected));
}

const records = async () => (await readFile(new URL('adjacent.jsonl', root), 'utf8')).trim().split('\n').map(JSON.parse);
async function inMemory(rows, copies = 1, separate = false) {
  const files = [];
  for (let i = 0; i < copies; i++) {
    const file = join(scratch, `probe-${i}.jsonl`);
    await writeFile(file, rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
    files.push({ file, group: separate ? file : scratch });
  }
  return collect(files);
}
const mutants = {
  'summary flag': row => { if (row.isCompactSummary) { row.isCondensed = true; delete row.isCompactSummary; } },
  'boundary subtype': row => { if (row.subtype) row.subtype = 'compact_future'; },
  'metadata object': row => { if (row.compactMetadata) { row.tokenMetadata = row.compactMetadata; delete row.compactMetadata; } },
  'user type': row => { if (row.type === 'user') row.type = 'human_future'; },
  'object content': row => { if (row.message) row.message.content = { value: row.message.content }; },
  'string preTokens': row => { if (row.compactMetadata) row.compactMetadata.preTokens = '120000'; },
  'missing uuid': row => { delete row.uuid; },
};
for (const [name, mutate] of Object.entries(mutants)) {
  test('drift mutant: ' + name, async () => {
    const rows = await records();
    rows.forEach(mutate);
    const { counts } = await inMemory(rows), result = adapter.driftCheck(counts);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.length > 0);
    assert.equal(result.unread, counts.compactLike - counts.understood);
    if (name === 'boundary subtype') assert.equal(result.unread, 1);
  });
}
test('project dedupe includes every record type and keeps other groups independent', async () => {
  const rows = await records();
  rows.push({ type: 'assistant', uuid: 'reply-copy', message: { role: 'assistant', content: 'The kettle is ready.' } });
  const one = await inMemory(rows), copied = await inMemory(rows, 2), independent = await inMemory(rows, 2, true);
  assert.deepEqual(copied.counts.types, one.counts.types);
  assert.deepEqual(copied.counts.rejects, one.counts.rejects);
  assert.equal(copied.sessions.flatMap(s => s.compactions).length, 1);
  assert.equal(copied.sessions.flatMap(s => s.typed).length, 2);
  assert.equal(independent.sessions.flatMap(s => s.compactions).length, 2);
  assert.equal(independent.sessions.flatMap(s => s.typed).length, 4);
});
test('fallback dedupe hashes timestamp and text rather than physical lines', async () => {
  const rows = await records();
  rows.forEach((row, i) => { delete row.uuid; row.timestamp = `2026-01-01T10:00:0${i}Z`; });
  const one = await inMemory(rows), copied = await inMemory(rows, 2);
  assert.deepEqual(copied.counts.types, one.counts.types);
  assert.deepEqual(copied.counts.rejects, one.counts.rejects);
  assert.equal(copied.sessions.flatMap(s => s.compactions).length, 1);
  assert.equal(copied.sessions.flatMap(s => s.typed).length, 2);
});
test('tail before the summary survives; normalised text with a fresh id is tail', async () => {
  const [header, a, b, boundary, summary] = await records();
  const tail = { ...b, uuid: 'fresh-tail', message: { ...b.message, content: '  ' + b.message.content.replaceAll(' ', '\n ') + '  ' } };
  const { sessions, counts } = await inMemory([header, a, b, boundary, a, tail, summary]);
  assert.equal(sessions[0].typed.length, 2);
  assert.ok(sessions[0].compactions[0].visible.includes(a.message.content));
  assert.ok(sessions[0].compactions[0].visible.includes(tail.message.content));
  assert.equal(adapter.driftCheck(counts).ok, true);
});
test('I1 and I4 thresholds are strict; I3 does not fail', async () => {
  const [header, a, , boundary, summary] = await records();
  const rows = [header, a];
  for (let i = 0; i < 5; i++) {
    rows.push({ ...boundary, uuid: 'boundary-' + i });
    if (i) rows.push({ ...summary, uuid: 'summary-' + i });
  }
  assert.equal(adapter.driftCheck((await inMemory(rows)).counts).ok, true);
  rows.push({ ...boundary, uuid: 'unmatched-extra' });
  assert.deepEqual(adapter.driftCheck((await inMemory(rows)).counts).reasons, ['I1']);
  const conversation = Array.from({ length: 10 }, (_, i) => ({ ...a, uuid: 'speaker-' + i, type: i ? 'assistant' : 'future_speaker' }));
  assert.equal(adapter.driftCheck((await inMemory([header, ...conversation])).counts).ok, true);
  conversation[1].type = 'future_speaker';
  assert.deepEqual(adapter.driftCheck((await inMemory([header, ...conversation])).counts).reasons, ['I4']);
  const counts = tally(); counts.lines = 100; counts.malformed = 5;
  assert.equal(adapter.driftCheck(counts).ok, true);
  counts.malformed++;
  assert.deepEqual(adapter.driftCheck(counts).reasons, ['I4']);
});

test('tail ids stay known at later boundaries and each tail record joins once', async () => {
  const [header, a, b, boundary, summary] = await records();
  const tail = { ...b, uuid: 'tail-copy' }, changed = { ...tail,
    message: { ...b.message, content: 'Store the spare rope beside the blue shed.' } };
  const { sessions, counts } = await inMemory([header, a, b, boundary, tail, tail, summary,
    { ...boundary, uuid: 'next-boundary' }, { ...summary, uuid: 'next-summary' }, changed]);
  assert.equal(sessions[0].typed.length, 2);
  assert.equal(sessions[0].compactions[0].visible.split(b.message.content).length, 2);
  assert.ok(sessions[0].compactions[1].visible.includes(changed.message.content));
  assert.equal(adapter.driftCheck(counts).ok, true);
});
