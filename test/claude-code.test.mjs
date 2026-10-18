import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import adapter from '../src/agents/claude-code.mjs';
import { adapters } from '../src/agents/index.mjs';
import { decode, mayNeed } from '../src/agents/claude-code.dialect.mjs';
import { writeGenerated } from './fixtures/claude-code/generated.mjs';

const root = new URL('./fixtures/claude-code/', import.meta.url);
const oracle = JSON.parse(await readFile(new URL('expected.json', root), 'utf8'));
const deferred = [
  ['preserved-tail.jsonl', 'B08b removes the kept tail and joins its text to the summary.'],
  ['forked-project', 'B08b deduplicates copied history across project files.'],
];
const tally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
async function collect(files, counts = tally()) {
  const sessions = [];
  for await (const session of adapter.sessions(files, counts)) sessions.push(session);
  return { sessions, counts };
}
async function fixtureFiles(name) {
  const path = new URL(name, root), info = await stat(path);
  if (info.isDirectory()) return adapter.listFiles(fileURLToPath(path));
  return [{ file: fileURLToPath(path), size: info.size, mtimeMs: info.mtimeMs, group: 'fixture' }];
}
function check({ sessions, counts }, expected) {
  const typed = sessions.flatMap(session => session.typed);
  const rejected = Object.fromEntries([...counts.rejects].filter(([reason]) => reason !== 'not_user'));
  for (const { text } of typed) {
    const reason = text.length < 20 ? 'short' : text.length > 1500 ? 'pasted' : null;
    if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
  }
  assert.deepEqual({ sessions: sessions.length, auto: sessions.filter(s => s.auto).length,
    sub: sessions.filter(s => s.sub).length, typed: typed.length, rejected,
    compactions: sessions.flatMap(s => s.compactions.map(c => ({ visible: c.visible === null ? 'null' : 'found', pre: c.pre ?? null, post: c.post ?? null, trigger: c.trigger ?? null }))),
    messages: typed.map(({ id, epoch }) => ({ id, epoch })) },
  { ...Object.fromEntries(['sessions', 'auto', 'sub', 'typed', 'rejected', 'compactions'].map(key => [key, expected[key]])),
    messages: expected.messages.map(({ id, epoch }) => ({ id, epoch })) });
  for (const session of sessions) {
    session.compactions.forEach((compaction, i) => assert.equal(compaction.epoch, i + 1));
    for (const message of session.typed) {
      const labels = expected.messages.find(item => item.id === message.id).labels;
      labels.forEach((label, i) => {
        const visible = session.compactions[message.epoch + i].visible;
        if (label === null) assert.equal(visible, null);
        else assert.equal(visible.includes(message.text), label === 'kept');
      });
    }
  }
}
for (const [name, expected] of Object.entries(oracle.fixtures)) {
  const reason = deferred.find(([file]) => file === name)?.[1];
  test('oracle: ' + name, { skip: reason }, async () => check(await collect(await fixtureFiles(name)), expected));
}
let scratch, generated;
before(async () => { scratch = await mkdtemp(join(tmpdir(), 'goldfished-adapter-')); generated = await writeGenerated(scratch); });
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });
for (const [name, expected] of Object.entries(oracle.generated)) {
  test('generated oracle: ' + name, async () => {
    const info = await stat(generated[name]);
    const result = await collect([{ file: generated[name], group: scratch, ...info }]);
    check(result, expected);
    if (name === 'large-line.jsonl') { assert.equal(result.counts.skippedLong, 0); assert.ok(result.counts.bytes > 64 * 1024 * 1024); }
  });
}
test('modified time filters files and preserves project groups', async () => {
  const all = await adapter.listFiles(scratch), recent = await adapter.listFiles(scratch, { sinceMs: Date.now() - 86400000 });
  assert.equal(all.length, 2);
  assert.deepEqual(recent.map(item => item.file), [generated['large-line.jsonl']]);
  assert.ok(all.every(item => item.group === scratch && item.size > 0));
  assert.deepEqual(await adapter.listFiles(join(scratch, 'absent')), []);
});
test('registry, roots, newest matching cwd, metadata and drift placeholder', async () => {
  assert.deepEqual(adapters, [adapter]);
  assert.deepEqual(adapter.roots({}, scratch), [join(scratch, '.claude', 'projects')]);
  assert.deepEqual(adapter.roots({ CLAUDE_CONFIG_DIR: '/settings' }, scratch), [join('/settings', 'projects')]);
  const old = await collect([{ file: generated['modified-time.jsonl'], group: scratch }]);
  const session = old.sessions[0];
  assert.equal(session.project, 'kettle.app');
  assert.equal(session.firstMs, Date.parse('2000-01-01T12:00:00Z'));
  assert.equal(session.lastMs, session.firstMs);
  assert.deepEqual(session.versions, ['2.1.7']);
  const current = await adapter.findTyped('/srv/work/kettle.app', [scratch], {});
  assert.equal(current[0].length, 64 * 1024 * 1024);
  assert.equal(await adapter.findTyped('/elsewhere', [scratch], {}), null);
  assert.equal(await adapter.findTyped('/srv/work/kettle.app', [scratch], { sinceMs: Date.now() + 60000 }), null);
  assert.deepEqual(adapter.driftCheck(tally()), { ok: true, reasons: [], unread: 0 });
});
test('substring filter precedes parsing; fallback IDs use physical lines', async () => {
  assert.equal(mayNeed('{broken'), false);
  assert.equal(decode('{broken', 7).reason, 'not_user');
  const plain = (await readFile(new URL('plain.jsonl', root), 'utf8')).split('\n');
  assert.equal(decode(plain[3], 4).reason, 'not_user');
  assert.equal(decode(plain[1].replace(/"[^"]+":"plain-a",/u, ''), 2).identity, 2);
  assert.equal(decode(plain[1].replace(/:/gu, ': '), 2).reason, undefined);
});
test('rejection precedence and metadata on records outside the parsing filter', async () => {
  const records = async name => (await readFile(new URL(name, root), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const summary = (await records('adjacent.jsonl')).at(-1);
  const meta = (await records('slash-command-wrapper.jsonl'))[4];
  const origin = (await records('sdk-session.jsonl'))[2];
  const tool = (await records('tool-result.jsonl'))[1];
  for (const [record, reason] of [[{ ...tool, ...origin, ...meta, ...summary }, 'summary'],
    [{ ...tool, ...origin, ...meta }, 'meta'], [{ ...tool, ...origin }, 'origin_sdk'], [tool, 'tool_result']]) {
    assert.equal(decode(JSON.stringify(record), 1).reason, reason);
  }
  const assistant = (await records('plain.jsonl'))[3];
  const combined = JSON.stringify({ ...origin, ...assistant });
  assert.equal(mayNeed(combined), false);
  assert.equal(decode(combined, 1).automated, true);
  const file = join(scratch, 'metadata.tmp');
  await writeFile(file, combined + '\n');
  const { sessions, counts } = await collect([{ file, group: scratch }]);
  assert.equal(sessions[0].auto, true);
  assert.equal(sessions[0].project, 'tide-tables');
  assert.equal(counts.rejects.get('not_user'), 1);
  await writeFile(file, 'x'.repeat(16 * 1024 * 1024 + 1) + '\n' + JSON.stringify(tool) + '\n');
  const skipped = await collect([{ file, group: scratch }]);
  assert.equal(skipped.counts.skippedLong, 1);
  assert.equal(skipped.counts.lines, 2);
  assert.equal(skipped.counts.rejects.get('tool_result'), 1);
});
test('compaction tallies inspect record fields, never message text', async () => {
  const plain = (await readFile(new URL('plain.jsonl', root), 'utf8')).trim().split('\n');
  const assistant = plain[3].replace('The kettle is ready.', 'compact the data');
  const user = plain[1].replace('Keep the harbour timetable in plain text.', 'compact the data');
  const file = join(scratch, 'compaction-tally.tmp');
  await writeFile(file, [assistant, user].join('\n') + '\n');
  const ordinary = await collect([{ file, group: scratch }]);
  assert.equal(ordinary.counts.compactLike, 0);
  assert.equal(ordinary.counts.understood, 0);
  const adjacent = (await readFile(new URL('adjacent.jsonl', root), 'utf8')).trim().split('\n');
  await writeFile(file, [assistant, user, adjacent[3], adjacent[4], assistant.replaceAll('assistant', 'compact_future')].join('\n') + '\n');
  const compacted = await collect([{ file, group: scratch }]);
  assert.equal(compacted.counts.compactLike, 3);
  assert.equal(compacted.counts.understood, 2);
});
test('a partial final line is skipped without a malformed record or type', async () => {
  const { counts } = await collect(await fixtureFiles('truncated-last-line.jsonl'));
  assert.equal(counts.malformed, 0);
  assert.deepEqual([...counts.types], [['user', 1]]);
  assert.equal(counts.rejects.size, 0);
});
test('blank lines reach neither types nor rejection counts', async () => {
  const file = join(scratch, 'blank.tmp');
  await writeFile(file, '\n \t\r\n');
  const { counts } = await collect([{ file, group: scratch }]);
  assert.equal(counts.lines, 2);
  assert.equal(counts.malformed, 0);
  assert.equal(counts.types.size, 0);
  assert.equal(counts.rejects.size, 0);
});
test('the newest matching session returns its empty typed list', async () => {
  const dir = await mkdtemp(join(scratch, 'newest-'));
  const plain = (await readFile(new URL('plain.jsonl', root), 'utf8')).trim().split('\n');
  const sdk = (await readFile(new URL('sdk-session.jsonl', root), 'utf8')).trim().split('\n');
  const older = join(dir, 'older.jsonl'), newer = join(dir, 'newer.jsonl');
  await writeFile(older, plain[1] + '\n');
  await writeFile(newer, JSON.stringify({ ...JSON.parse(sdk[1]), ...JSON.parse(plain[3]) }) + '\n');
  await utimes(older, new Date('2000-01-01'), new Date('2000-01-01'));
  await utimes(newer, new Date('2001-01-01'), new Date('2001-01-01'));
  assert.deepEqual(await adapter.findTyped(decode(plain[1], 2).directory, [dir], {}), []);
});
