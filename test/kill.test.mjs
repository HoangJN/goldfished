import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, isolated } from '../scripts/oracle.mjs';
import { foldSession } from '../src/fold.mjs';
import { combine, curve, measurable, span, bootstrap } from '../src/stats.mjs';
import { prepare, score } from '../src/grade.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'gf-kill-'));
Object.assign(process.env, isolated(sandbox));
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
const row = (age, kept = 50, messages = 100, sessions = 10) => ({ age, kept, messages, sessions, reworded: 0, gone: messages - kept });
const tally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
test('span uses exact ratios, both sample floors, numeric ages and failures beyond gaps', () => {
  assert.equal(span([row(1, 45)]).span, 0);
  assert.equal(measurable(row(1, 30, 30)), false); assert.equal(measurable(row(1, 50, 50, 9)), false);
  assert.deepEqual(span(Array.from({ length: 12 }, (_, i) => row(i + 1))), { span: 12, censored: true, headlineAge: 12 });
  assert.deepEqual(span([row(1), row(3, 40)]), { span: 1, censored: false, headlineAge: 3 });
  const ages = combine([{ ages: new Map([[6, { kept: 1, reworded: 0, gone: 0 }]]) }]);
  assert.equal(curve(ages).length, 6); assert.equal(curve(ages)[5].messages, 1);
});
test('fold honours both character boundaries, opaque ages, later arrivals and reworded fates', () => {
  const lengths = [19, 20, 1500, 1501], typed = lengths.map(n => ({ epoch: 0, text: 'a'.repeat(n) }));
  typed.push({ epoch: 12, text: 'A turn after the last compaction.' });
  const session = { typed, compactions: Array.from({ length: 12 }, (_, i) => ({ epoch: i + 1, visible: i === 1 ? null : 'visible' })) };
  const f = foldSession(session, { prepare: x => x, score: () => ({ label: 'reworded', score: 0.5 }) }, { sampleSeed: 1 });
  assert.deepEqual(f.notCounted, { short: 1, pasted: 1 }); assert.equal(f.labelled, 2);
  assert.equal(f.ages.has(2), false);
  for (const age of [1, 3, 9, 10, 11, 12]) assert.deepEqual(f.ages.get(age), { kept: 0, reworded: 2, gone: 0 });
});
test('a missing tenth of a run differs from a missing fifth', () => {
  const words = 'amber birch cedar dahlia elder fern gorse hazel iris juniper'.split(' '), text = words.join(' ');
  assert.equal(score(text, prepare(words.slice(0, 9).join(' '))).label, 'kept');
  assert.equal(score(text, prepare(words.slice(0, 8).join(' '))).label, 'reworded');
});
test('bootstrap samples whole unequal sessions, with the specified percentile ranks', () => {
  const ages = combine([{ ages: new Map([[1, { kept: 1, reworded: 0, gone: 0 }]]) },
    { ages: new Map([[1, { kept: 0, reworded: 0, gone: 99 }]]) }]);
  assert.deepEqual(bootstrap(ages, 1), [0, 100]);
});
test('summaries and retained tails are not new turns; resumed histories count once', async () => {
  for (const agent of ['claude-code', 'codex']) {
    const directory = join(sandbox, 'resumed', agent), wanted = generate(agent, 3, directory);
    const file = join(directory, agent === 'codex' ? '2026/01/01/rollout-oracle.jsonl' : 'orchard/oracle.jsonl');
    cpSync(file, file.replace('oracle.jsonl', 'oracle-resumed.jsonl'));
    const adapter = (await import(`../src/agents/${agent}.mjs`)).default;
    const sessions = [];
    for await (const s of adapter.sessions(await adapter.listFiles(directory), tally())) sessions.push(s);
    assert.equal(sessions.reduce((n, s) => n + s.typed.length, 0), wanted.messages, agent);
  }
  const directory = join(sandbox, 'tail'), text = 'Keep the orchard files in plain text.';
  mkdirSync(directory);
  const human = { type: 'user', uuid: 'turn-one', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: text } };
  const records = [{ _synthetic: true }, human, { type: 'system', subtype: 'compact_boundary', uuid: 'boundary-one' },
    { type: 'user', uuid: 'summary-one', isCompactSummary: true, message: { role: 'user', content: 'Quiet water and distant hills.' } }, human];
  writeFileSync(join(directory, 'tail.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  const adapter = (await import('../src/agents/claude-code.mjs')).default, sessions = [];
  for await (const s of adapter.sessions(await adapter.listFiles(directory), tally())) sessions.push(s);
  assert.equal(sessions[0].typed.length, 1); assert.ok(sessions[0].compactions[0].visible.includes(text));
});
