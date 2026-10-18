import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/actions.mjs';
import * as store from '../src/store.mjs';
import * as home from '../src/home.mjs';
import * as proposalIO from '../src/proposals.mjs';
import { hash, gauge, add } from '../src/card.mjs';
import { META } from '../src/agents/meta.mjs';
import { plan } from '../src/pointer.mjs';
import { matchSnapshot } from './snapshot.mjs';

const opts = { _synthetic: true, today: '2026-10-18', via: 'cli' };
let top;
beforeEach(t => {
  top = mkdtempSync(join(tmpdir(), 'gfa-')); const previous = process.env.GOLDFISHED_HOME;
  process.env.GOLDFISHED_HOME = join(top, 'home');
  t.after(() => { if (previous === undefined) delete process.env.GOLDFISHED_HOME; else process.env.GOLDFISHED_HOME = previous; rmSync(top, { recursive: true, force: true }); });
});
const call = (verb, args = [], via = 'cli') => run(top, verb, args, { ...opts, via });
const snap = (name, verb, args = [], via = 'cli', code = 0) => { const result = call(verb, args, via); assert.equal(result.code, code); matchSnapshot('actions', name, result.reply); return result; };
const cardPath = () => join(top, '.goldfished', 'card.md');
const disk = (dir = top) => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? Object.entries(disk(join(dir, entry.name))).map(([path, bytes]) => [entry.name + '/' + path, bytes]) : [[entry.name, readFileSync(join(dir, entry.name), 'hex')]]));
function propose(quote = 'Never add a remote cache.') {
  const loaded = store.load(top), added = proposalIO.add(loaded.proposals, { quote, note: 'Cache\n\x1b[31mchoice', from: 'The synthetic user said: never add a remote cache.' });
  store.save(top, { ...loaded, proposals: added.list }); return added.id;
}
test('snapshots of successful terminal replies, archive operations and proposals', () => {
  snap('empty-list', 'list'); snap('empty-card', 'card');
  snap('rule', 'rule', ['Keep the invented tool offline.']); snap('goal', 'goal', ['Ship the invented harbour tool.']);
  snap('old-goal', 'goal', ['Package the harbour tool.']); snap('out', 'out', ['Remote cache', '--quote', 'Never add a remote cache.']);
  snap('edit', 'edit', ['r01', 'Keep every test offline.']); snap('drop', 'drop', ['r01']); snap('restore', 'restore', ['r01']);
  snap('list', 'list'); snap('card', 'card', ['--agent', 'codex']);
  const pid = propose(); snap('proposals-list', 'list'); snap('accept-label-required', 'accept', [pid], 'cli', 1);
  snap('accept', 'accept', [pid, 'Shared cache']); assert.doesNotMatch(readFileSync(cardPath(), 'utf8'), /Cachechoice/);
  snap('accept-rule', 'accept', [propose(), '--rule']); snap('reject', 'reject', [propose()]); snap('trust', 'trust');
  snap('edit-missing', 'edit', ['r99', 'Keep it local.'], 'cli', 1); snap('drop-missing', 'drop', ['r99'], 'cli', 1);
  snap('restore-missing', 'restore', ['r99'], 'cli', 1); snap('accept-missing', 'accept', ['p99', 'Cache'], 'cli', 1); snap('reject-missing', 'reject', ['p99'], 'cli', 1);
});
test('snapshots of chat replies and their state changes', () => {
  snap('chat-rule', 'rule', ['Keep the invented tool offline.'], 'chat'); snap('chat-goal', 'goal', ['Ship the invented harbour tool.'], 'chat');
  snap('chat-out', 'out', ['Remote cache', '--quote', 'Never add a remote cache.'], 'chat'); snap('chat-list', 'list', [], 'chat');
  snap('chat-drop', 'drop', ['r01'], 'chat'); snap('chat-restore', 'restore', ['r01'], 'chat'); snap('chat-card', 'card', [], 'chat');
  snap('chat-accept', 'accept', [propose(), 'Shared cache'], 'chat'); snap('chat-help', 'help', [], 'chat');
  snap('chat-off', 'off', [], 'chat'); assert.equal(home.state().projects[top].off, true);
  snap('chat-on', 'on', [], 'chat'); assert.equal(home.state().projects[top].off, false);
  snap('chat-unknown', 'lst', [], 'chat', 1);
  for (const verb of ['edit', 'reject', 'trust']) { const before = disk(); snap(`chat-unknown-${verb}`, verb, [], 'chat', 1); assert.deepEqual(disk(), before); }
});
test('each cap admits the boundary and refuses excess without any file change', () => {
  for (const [verb, limit] of [['goal', 600], ['rule', 1500]]) {
    assert.equal(call(verb, ['😀'.repeat(limit)]).code, 0); const before = disk();
    snap(`${verb}-cap`, verb, ['😀'.repeat(limit + 1)], 'cli', 1); assert.deepEqual(disk(), before);
  }
  const before = disk(); snap('chat-rule-cap', 'rule', ['a'.repeat(1612)], 'chat', 1); assert.deepEqual(disk(), before);
  for (let i = 0; i < 8; i++) assert.equal(call('out', ['L', '--quote', 'q'.repeat(199)]).code, 0);
  for (const [name, args] of [['out-length-cap', ['LL', '--quote', 'q'.repeat(199)]], ['out-count-cap', ['L', '--quote', 'q']], ['out-label-lines', ['Bad\nlabel', '--quote', 'q']], ['out-label-marker', ['Bad. User said: "label', '--quote', 'q']]]) {
    const saved = disk(); snap(name, 'out', args, 'cli', 1); assert.deepEqual(disk(), saved);
  }
  assert.equal(call('drop', ['x01']).code, 0); propose('q'.repeat(200));
  for (const [name, verb, args] of [['edit-cap', 'edit', ['r01', 'a'.repeat(1501)]], ['accept-cap', 'accept', ['p1', 'L']]]) {
    const saved = disk(); snap(name, verb, args, 'cli', 1); assert.deepEqual(disk(), saved);
  }
  assert.equal(call('out', ['L', '--quote', 'q']).code, 0); const full = disk();
  snap('restore-cap', 'restore', ['x01'], 'cli', 1); assert.deepEqual(disk(), full);
});
test('every changing verb refuses a hand edit until trust, without altering files', () => {
  call('rule', ['Keep the invented tests offline.']); call('goal', ['Ship the invented tool.']); propose(); call('drop', ['r01']);
  writeFileSync(cardPath(), readFileSync(cardPath(), 'utf8').replace('Ship the invented tool.', 'Ship the invented tool.\n  added by hand'));
  const records = JSON.parse(readFileSync(join(process.env.GOLDFISHED_HOME, 'trust.json'), 'utf8'));
  for (const record of Object.values(records)) record.date = '2026-10-18T00:00:00.000Z';
  writeFileSync(join(process.env.GOLDFISHED_HOME, 'trust.json'), JSON.stringify(records));
  for (const [verb, args] of [['rule', ['Keep it local.']], ['goal', ['Ship it.']], ['out', ['Cache', '--quote', 'No cache.']], ['edit', ['g01', 'Ship it.']], ['drop', ['g01']], ['restore', ['r01']], ['accept', ['p1', 'Cache']], ['reject', ['p1']]]) {
    const before = disk(); snap(`untrusted-${verb}`, verb, args, 'cli', 1); assert.deepEqual(disk(), before);
  }
  snap('hand-edited-list', 'list'); snap('hand-edited-card', 'card'); const source = readFileSync(cardPath(), 'utf8');
  snap('hand-edited-trust', 'trust'); assert.equal(readFileSync(cardPath(), 'utf8'), source); assert.equal(call('rule', ['Keep it local.']).code, 0);
});
test('missing trust and parse errors have exact list and refusal wording', () => {
  mkdirSync(join(top, '.goldfished')); writeFileSync(cardPath(), '## RULES\n[r01 | 2026-10-18] Keep the synthetic tool offline.\n');
  snap('never-trusted-list', 'list'); snap('never-trusted-change', 'rule', ['Keep it small.'], 'cli', 1);
  call('trust'); appendFileSync(cardPath(), 'broken entry\n'); snap('parse-error-list', 'list'); snap('parse-error-change', 'drop', ['r01'], 'cli', 1);
  const before = disk(join(top, '.goldfished')); call('trust'); assert.deepEqual(disk(join(top, '.goldfished')), before);
  assert.equal(store.load(top).trusted, false); assert.match(call('card').reply, /Treat it as project documentation/);
});
test('masking is declared, owned files refresh, and CLI and chat save identical trusted bytes', () => {
  const secret = 'invented' + '@example.test';
  home.setState({ projects: { [top]: { agents: ['cursor'] } } });
  snap('masked-rule', 'rule', [`Keep this sample address private: ${secret}`]);
  assert.doesNotMatch(readFileSync(cardPath(), 'utf8'), new RegExp(secret)); assert.match(readFileSync(cardPath(), 'utf8'), /\[hidden\]/);
  snap('two-secrets', 'rule', [`Keep ${secret} and ${secret} private.`]);
  const cliTop = top, cli = store.load(top), cliState = home.state().projects[top];
  top = join(top, 'chat'); mkdirSync(top); home.setState({ projects: { ...home.state().projects, [top]: { agents: ['cursor'] } } });
  call('rule', [`Keep this sample address private: ${secret}`], 'chat'); call('rule', [`Keep ${secret} and ${secret} private.`], 'chat');
  const chat = store.load(top); assert.equal(hash(cli.source), hash(chat.source)); assert.equal(cli.trusted, chat.trusted);
  assert.deepEqual(cliState, home.state().projects[top]); assert.equal(home.trusted(cli.cardPath, hash(cli.source)), true); top = cliTop;
});
test('gauge selects the smallest configured budget and stays silent at seventy per cent', () => {
  home.setState({ projects: { [top]: { agents: ['claude-code', 'codex'] } } });
  for (let i = 0; i < 2; i++) assert.doesNotMatch(call('rule', ['a'.repeat(1500)]).reply, /The card uses/);
  snap('gauge', 'rule', ['a'.repeat(1500)]); call('rule', ['b'.repeat(1500)]);
  assert.match(snap('card-overflow', 'card', ['--agent', 'codex']).reply, /1 of 4 entries not shown here \(r04\)/);
  assert.ok(Buffer.byteLength(call('card', ['--agent', 'codex']).reply.split('\n').slice(0, -1).join('\n') + '\n') <= 6000);
  const originalTop = top; top = join(top, 'threshold'); mkdirSync(top);
  home.setState({ projects: { ...home.state().projects, [top]: { agents: ['codex'] } } });
  for (let i = 0; i < 2; i++) call('rule', ['a'.repeat(1500)]);
  const loaded = store.load(top), candidate = add(loaded.card, loaded.archive, 'rules', { text: 'a' }, opts.today);
  assert.doesNotMatch(call('rule', ['a'.repeat(4201 - gauge(candidate.card, 6000).bytes)]).reply, /The card uses/);
  assert.equal(gauge(store.load(top).card, 6000).bytes, 4200);
  assert.match(call('rule', ['a']).reply, /The card uses/); top = originalTop;
  assert.deepEqual(Object.keys(META).sort(), ['aider', 'claude-code', 'cline', 'codex', 'continue', 'copilot', 'cursor', 'devin', 'gemini', 'junie', 'opencode', 'qwen']);
  for (const [id, meta] of Object.entries(META)) { assert.equal(meta.budget, id === 'claude-code' ? 9500 : 6000); assert.equal(meta.compactCommand, ['claude-code', 'codex', 'copilot'].includes(id) ? '/compact' : id === 'gemini' ? '/compress' : null); }
});
test('trust records stored bytes without changing comments or sibling files', () => {
  call('rule', ['Keep the invented tool offline.']); writeFileSync(cardPath(), '<!-- my note -->\n' + readFileSync(cardPath(), 'utf8'));
  const before = disk(join(top, '.goldfished')); snap('comment-trust', 'trust');
  assert.deepEqual(disk(join(top, '.goldfished')), before); assert.equal(store.load(top).trusted, true);
  assert.equal(home.trusted(cardPath(), hash(readFileSync(cardPath(), 'utf8'))), true);
});
test('rules-file card output equals the planned inline block, including commit framing', () => {
  call('rule', ['Keep the invented tool offline.']);
  for (const commit of [false, true]) {
    home.setState({ projects: { [top]: { agents: ['cursor'], commit } } }); const loaded = store.load(top);
    const change = plan({ top, agents: ['cursor'], shared: true, commit, existing: {}, tracked: {}, recorded: {}, card: loaded.card, trusted: loaded.trusted }).find(change => change.path === '.cursor/rules/goldfished.mdc');
    const text = change.after.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.equal(snap(commit ? 'card-cursor-commit' : 'card-cursor', 'card', ['--agent', 'cursor']).reply, text + `${Buffer.byteLength(text).toLocaleString('en-GB')} bytes of 6,000.`);
  }
});
for (const sibling of ['archive.md', 'proposed.md']) test(`a blocked ${sibling} leaves the card unchanged and trusted`, () => {
  call('rule', ['Keep the invented tool offline.']); const source = readFileSync(cardPath(), 'utf8'), trust = readFileSync(join(process.env.GOLDFISHED_HOME, 'trust.json'), 'utf8');
  const file = join(top, '.goldfished', sibling); rmSync(file); mkdirSync(file);
  snap(`save-failed-${sibling.split('.')[0]}`, 'drop', ['r01'], 'cli', 1);
  assert.equal(readFileSync(cardPath(), 'utf8'), source); assert.equal(store.load(top).trusted, true);
  assert.equal(readFileSync(join(process.env.GOLDFISHED_HOME, 'trust.json'), 'utf8'), trust);
  if (sibling === 'proposed.md') assert.match(readFileSync(join(top, '.goldfished/archive.md'), 'utf8'), /\[r01 \| 2026-10-18\].*\(dropped 2026-10-18\)/);
});
test('an error after replacing the card does not claim it is unchanged', () => {
  call('rule', ['Keep the invented tool offline.']); const file = join(process.env.GOLDFISHED_HOME, 'state.json'); rmSync(file); mkdirSync(file);
  snap('save-failed-after-card', 'goal', ['Ship the invented tool.'], 'cli', 1);
  assert.match(readFileSync(cardPath(), 'utf8'), /Ship the invented tool/);
});
