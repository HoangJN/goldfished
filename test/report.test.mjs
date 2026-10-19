import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSnapshot } from './snapshot.mjs';
process.env.TZ = 'UTC';
const { text, json } = await import('../src/report.mjs');
const { DEMO } = await import('../src/demo.mjs');
const day = n => Date.UTC(2025, 3, n, 12);
const row = (age, messages, sessions, kept, reworded) => ({ age, messages, sessions, kept, reworded, gone: messages - kept - reworded });
function result() {
  return {
    toolVersion: '9.8.7', grader: { id: 'synthetic', threshold: 0.87 },
    window: { days: 47, fromMs: day(1), toMs: day(30) }, files: 4567, bytes: 876500000, secs: 19,
    notGraded: { auto: 23, sub: 31 }, roots: ['~/synthetic-one', '~/synthetic-two'], cardTrusted: false, save: false,
    probes: [], headlineAgent: 'claude-code', agents: [{
      id: 'claude-code', label: 'Claude Code', status: 'ok', sessions: 2345, compacted: 123, messages: 9876,
      firstMs: day(3), lastMs: day(27), curve: [row(1, 1500, 43, 1350, 90), row(2, 1100, 35, 451, 220), row(3, 700, 17, 161, 154)],
      composition: [row(1, 200, 12, 176, 10), row(2, 200, 12, 112, 30), row(3, 200, 12, 68, 44)],
      span: 1, censored: false, headlineAge: 3,
      headline: { age: 3, keptPer100: 23, ci95: [16, 32], messages: 700, sessions: 17 },
      verdict: null, note: "Why so high after one: in our tests Claude Code's first summary quoted your messages. The next compaction summarises that summary.",
      card: { sessions: 15, age: 3, keptPer100: 79 }, drift: null, notCounted: { short: 567, pasted: 89 },
    }], show: null, audit: null, history: null,
  };
}
function snap(name, r, check = () => {}) {
  test(name, () => { const output = text(r, { tty: false, noColor: true }); matchSnapshot('report', name, output); check(output); assert.ok(output.split('\n').every(line => line.length <= 80)); });
}
const full = result();
full.agents.push({ ...structuredClone(full.agents[0]), id: 'codex', sessions: 654, compacted: 76, messages: 8765, span: 4, censored: true, curve: [row(3, 600, 28, 366, 96)] });
full.save = true;
full.probes = [{ agent: 'codex', date: day(8), kept: true }, { agent: 'cursor', date: day(9), kept: false }];
full.history = { 'claude-code': { date: day(10), span: 5, censored: true } };
full.show = [{ agent: 'codex', project: 'project-7', age: 4, text: 'synthetic shown words [hidden]' }];
full.audit = ['kept', 'reworded', 'gone'].map((label, i) => ({ agent: 'cursor', project: 'project-8', age: i + 1, label, score: 0.834, you: 'synthetic original [hidden]', summary: 'synthetic summary [hidden]' }));
snap('all-fields', full, output => {
  const flat = output.replace(/\n +/g, ' ');
  for (const placeholder of [
    'last 47 days', 'read 4,567 files (876.5 MB) in 19s', '23 automated sessions, 31 subagent files', '2,345', '123', '9,876', '654', '76', '8,765', 'at least 4', '61 in 100',
    'Memory span: 1 compaction', '23 in 100', 'after 3 compactions', '95% range 16 to 32', '700 messages, 17 sessions, claude-code, 3 Apr 2025 to 27 Apr 2025.',
    'Short memory. More than half your words are gone by the second compaction.',
    '15 sessions): 79 in 100 kept after 3 compactions.', 'Span last time (10 Apr 2025): at least 5. Now: 1.',
    '1,500', '1,100', '90%', '6%', '4%', 'Same messages throughout: kept after 1 / 2 / 3 = 88 / 56 / 34 in 100.',
    '567 short replies under 20 characters, 89 pastes over 1,500 characters',
    full.agents[0].note, 'Claude Code deletes session files after 30 days', 'npx goldfished init',
    'writes counts only to ~/.goldfished', 'codex kept the card (8 Apr 2025); cursor did not (9 Apr 2025).',
    '[codex project-7 age 4] synthetic shown words [hidden]', '[cursor project-8 age 2] partly there (score 0.83)',
    'you: synthetic original [hidden]', 'summary: synthetic summary [hidden]',
  ]) assert.ok(flat.includes(placeholder), placeholder);
});
const multi = result();
multi.agents.push({ ...structuredClone(multi.agents[0]), id: 'codex', messages: 12345, sessions: 765, compacted: 87, span: 4, censored: true });
multi.agents.push({ ...structuredClone(multi.agents[0]), id: 'cursor', status: 'too_few', messages: 432, sessions: 1, compacted: 1, span: null, headline: null, headlineAge: null, curve: [row(1, 12, 1, 7, 2)] });
multi.agents.push(...['not_recorded', 'drift', 'none'].map((status, i) => ({ ...structuredClone(multi.agents[0]), id: `synthetic-${i}`, status, messages: null, drift: status === 'drift' ? { files: 57, unread: 9 } : null })));
snap('agent-table', multi, output => {
  const table = output.slice(output.indexOf('agent         '));
  assert.ok(table.indexOf('codex') < table.indexOf('claude-code'));
  for (const word of ['12,345', '765', '87', '9,876', '2,345', '123', 'at least 4', 'too few', 'not recorded', 'format drift']) assert.ok(table.includes(word), word);
  assert.ok(!table.includes('synthetic-2'));
});
for (const [name, span, censored, expected] of [
  ['goldfish', 0, false, 'Goldfish.'], ['short', 1, false, 'Short memory.'], ['fair', 2, false, 'Fair memory.'],
  ['long', 4, false, 'Long memory. At least half your words survive 4 compactions.'],
  ['censored', 1, true, 'At least 1 compaction so far.'], ['no-span', null, false, 'Too early to say.'],
]) { const r = result(); Object.assign(r.agents[0], { span, censored }); snap(name, r, output => assert.ok(output.includes(expected))); }
const few = result(); Object.assign(few.agents[0], { span: null, headline: null, headlineAge: null, curve: [row(1, 12, 1, 7, 2), row(2, 0, 0, 0, 0)] });
snap('too-few', few, output => { assert.match(output, /Too few to give a rate yet: 7 of 12 messages \(1 session\)/); assert.ok(!output.includes('\n2 ')); assert.match(output, /too few +too few +too few/); });
const unlabelled = structuredClone(few); unlabelled.agents[0].curve = [];
snap('unlabelled', unlabelled, output => assert.ok(!output.includes('Too few to give a rate yet')));
const apart = result(); apart.agents[0].card = { sessions: 1, age: 3, keptPer100: null };
snap('card-apart', apart, output => assert.ok(output.includes('1 session had the card re-sent')));
const noCard = result(); noCard.agents[0].card = null; noCard.agents[0].composition = null;
snap('no-card', noCard, output => { assert.ok(!output.includes('With the card')); assert.ok(!output.includes('agent         sessions')); });
const codex = result(); codex.headlineAgent = codex.agents[0].id = 'codex'; codex.agents[0].note = 'Codex keeps your newest messages word for word by design, up to about 20,000 tokens.';
snap('codex', codex, output => { assert.ok(output.replace(/\n +/g, ' ').includes(codex.agents[0].note)); assert.ok(!output.includes('deletes session files')); });
const trusted = result(); trusted.cardTrusted = true;
snap('trusted', trusted, output => assert.ok(!output.includes('npx goldfished init')));
const empty = result(); empty.agents = []; empty.headlineAgent = null;
snap('no-sessions', empty, output => assert.ok(output.startsWith('goldfished found no sessions. It looked in: ~/synthetic-one,')));
const fresh = result(); Object.assign(fresh.agents[0], { sessions: 1, compacted: 0 });
snap('no-compaction', fresh, output => assert.ok(output.includes('1 session read, none compacted yet. Nothing has been lost yet.')));
const drift = result(); Object.assign(drift.agents[0], { status: 'drift', compacted: 0, drift: { files: 67, unread: 21 } }); drift.headlineAgent = null;
snap('drift', drift, output => { assert.ok(output.replace(/\n +/g, ' ').includes('read 67 files but could not understand 21 compaction records')); assert.ok(!output.includes('Nothing has been lost yet')); });
const all = result(); all.window.days = 0; all.bytes = 512; all.secs = 0.1; all.files = 1; all.notGraded = { auto: 1, sub: 1 }; all.agents[0].notCounted = { short: 1, pasted: 1 };
snap('singular-all', all, output => { for (const word of ['all sessions', '1 file (512 B) in under 1s', '1 automated session, 1 subagent file', '1 short reply', '1 paste']) assert.ok(output.replace(/\n +/g, ' ').includes(word)); });
const fish = result();
test('fish', () => { const output = text(fish, { tty: true, noColor: false }); matchSnapshot('report', 'fish', output); assert.ok(output.startsWith('><(((o>   ')); for (const options of [{ tty: false }, { tty: true, noColor: true }]) assert.ok(!text(fish, options).includes('><(((o>')); assert.ok(output.includes('\n  machine')); });
test('json-full', () => {
  const output = json(full); matchSnapshot('report', 'json-full', JSON.stringify(output, null, 2));
  assert.deepEqual(output.headline, { agent: 'claude-code', age: 3, kept_per_100: 23, ci95: [16, 32], messages: 700, sessions: 17 });
  assert.deepEqual(output.agents[0].curve, full.agents[0].curve);
  assert.equal(output.agents[0].not_counted.short, 567); assert.equal(output.agents[0].card.kept_per_100, 79);
  const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.ok(!['text', 'message', 'path', 'project', 'dir', 'cwd'].includes(key)); if (typeof child === 'string' && !['span_rule', 'tool_version'].includes(key)) assert.ok(child.length <= 40); walk(child); } };
  for (const r of [full, multi, empty, apart, DEMO]) walk(json(r));
});
for (const [name, r] of [['json-empty', empty], ['json-card-null', apart], ['json-statuses', multi]]) test(name, () => {
  const output = json(r); matchSnapshot('report', name, JSON.stringify(output, null, 2));
  if (r === empty) { assert.deepEqual(output.agents, []); assert.equal(output.headline, null); }
  if (r === apart) assert.equal(output.agents[0].card.kept_per_100, null);
  if (r === multi) for (const a of output.agents.filter(a => ['drift', 'not_recorded'].includes(a.status))) { assert.equal(a.messages, null); assert.deepEqual(a.curve, []); }
});
snap('demo', DEMO, output => { assert.equal(output, text(DEMO, { tty: false, noColor: true })); assert.ok(!output.includes('><(((o>')); for (const word of [' 98 in 100', ' 37 in 100', ' 20 in 100', '2,140', '1,204', '611 ', '402 ', '318 ']) assert.ok(!output.includes(word)); });
test('demo-json', () => { assert.ok(!Object.hasOwn(DEMO, 'grader')); matchSnapshot('report', 'demo-json', JSON.stringify(json(DEMO), null, 2)); });
