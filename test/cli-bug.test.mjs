import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commands } from '../src/cli/misc.mjs';
import { commands as card } from '../src/cli/card.mjs';
import { matchSnapshot } from './snapshot.mjs';

const folderWord = 'FOLDERCANARY-91c4', typedWord = 'TYPEDCANARY-5d2e', originWord = 'acmebillingcanary', cardWord = 'CARDCANARY-77b0';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function setup(t, fixtures = true) {
  const cwd = mkdtempSync(join(tmpdir(), 'gfb-')), out = [], err = [];
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const io = { out: s => out.push(s), err: s => err.push(s), cwd, isTTY: false, today: '2026-10-18', nowMs: Date.now(),
    env: { GOLDFISHED_HOME: join(cwd, 'home'), CLAUDE_CONFIG_DIR: join(cwd, 'claude'), CODEX_HOME: join(cwd, 'codex') } };
  mkdirSync(join(cwd, 'claude/projects'), { recursive: true });
  if (fixtures) cpSync(new URL('./fixtures/claude-code', import.meta.url), join(cwd, 'claude/projects'), { recursive: true });
  return { cwd, io, out, err, async shapes(flags = {}) {
    out.length = err.length = 0; const code = await commands.shapes({ positional: [], flags }, io);
    return { code, text: out.join('\n'), err: err.join('\n') };
  }, async bug(flags = {}) {
    out.length = err.length = 0; const code = await commands.bug({ positional: [], flags }, io);
    return { code, text: out.join('\n'), err: err.join('\n') };
  } };
}

test('bug prints counts and fixed words only', async t => {
  const s = setup(t), session = join(s.cwd, 'claude/projects', folderWord);
  mkdirSync(session);
  writeFileSync(join(session, 'canary.jsonl'), [
    '{"_synthetic":true,"note":"Canary in a typed message."}',
    JSON.stringify({ type: 'user', uuid: 'c-a', timestamp: '2026-01-01T10:00:00Z', sessionId: 'c', cwd: `/srv/${folderWord}`,
      message: { role: 'user', content: `Keep ${typedWord} on the quay.` } }),
  ].join('\n') + '\n');
  s.io.isTTY = true; await card.goal({ positional: [`Never lose ${cardWord}.`], flags: {} }, s.io); s.io.isTTY = false;
  const { code, text, err } = await s.bug();
  assert.equal(code, 0); assert.equal(err, '');
  for (const word of [folderWord, typedWord, cardWord, s.cwd]) assert.ok(!text.includes(word), text);
  const [url] = text.split('\n').slice(-1);
  assert.equal(url, 'Paste this into a new issue: https://github.com/JNevermind/goldfished/issues/new/choose');
  assert.ok(!/[\/]/u.test(text.slice(0, text.length - url.length)), text);
  assert.ok(!/\d{4}-\d{2}-\d{2}|\d{8}|\d{2}[:.]\d{2}[:.]\d{2}/u.test(text), text);
  const lines = text.split('\n');
  assert.equal(lines[1], `goldfished ${pkg.version}`);
  assert.match(lines[2], /^node \d+$/u);
  assert.equal(lines[3], `platform ${process.platform} ${process.arch}`);
  assert.match(text, /^claude-code: files \d+, compaction records understood \d+ of \d+, malformed lines \d+, drift (?:yes|no), rejects .+$/mu);
  assert.match(text, /^codex: no folder$/mu);
  assert.match(text, /^card: trusted$/mu);
  assert.match(text, /^probe results: 0$/mu);
  assert.match(text, /rejects [^\n]*summary \d+, [^\n]*tool_result \d+/u);
  const sorted = text.match(/rejects (.+)$/mu)[1].split(', ').map(part => part.split(' ')[0]);
  assert.deepEqual(sorted, [...sorted].sort());
  matchSnapshot('cli', 'bug', text.replace(pkg.version, '<version>').replace(/^node \d+$/mu, 'node <major>')
    .replace(/^platform .*$/mu, 'platform <platform>'));
});

test('bug takes one agent, counts probes and card states, and refuses an unknown agent', async t => {
  const s = setup(t);
  const one = await s.bug({ agent: 'codex' });
  assert.equal(one.code, 0); assert.ok(!one.text.includes('claude-code:'), one.text);
  assert.match(one.text, /^card: none$/mu);
  mkdirSync(join(s.io.env.CODEX_HOME, 'sessions'), { recursive: true });
  assert.match((await s.bug({ agent: 'codex' })).text, /^codex: files 0, compaction records understood 0 of 0, malformed lines 0, drift no, rejects none$/mu);
  mkdirSync(s.io.env.GOLDFISHED_HOME, { recursive: true });
  writeFileSync(join(s.io.env.GOLDFISHED_HOME, 'state.json'), JSON.stringify({ probes: { codex: { date: '2026-10-18', kept: true }, junk: { kept: 'x' } } }));
  assert.match((await s.bug({ agent: 'codex' })).text, /^probe results: 1$/mu);
  s.io.isTTY = true; await card.rule({ positional: ['Keep the harbour open.'], flags: {} }, s.io);
  writeFileSync(join(s.cwd, '.goldfished/card.md'), '## RULES\n[r01 | broken]\n');
  assert.match((await s.bug({ agent: 'codex' })).text, /^card: not trusted$/mu);
  const bad = await s.bug({ agent: 'unknown' });
  assert.equal(bad.code, 1); assert.equal(bad.err, 'goldfished: unknown agent "unknown".'); assert.equal(bad.text, '');
});

test('a reject reason built from session data prints as other, in bug and in shapes', async t => {
  const s = setup(t, false), session = join(s.cwd, 'claude/projects', folderWord);
  mkdirSync(session);
  writeFileSync(join(session, 'origin.jsonl'), [
    '{"_synthetic":true,"note":"Canary in a turn origin."}',
    JSON.stringify({ type: 'user', uuid: 'o-a', timestamp: '2026-01-01T10:00:00Z', sessionId: 'o', cwd: '/srv/quay', turnOrigin: originWord,
      message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'user', uuid: 'o-b', timestamp: '2026-01-01T10:01:00Z', sessionId: 'o', cwd: '/srv/quay', turnOrigin: 'sdk',
      message: { role: 'user', content: 'hi again' } }),
  ].join('\n') + '\n');
  const bug = await s.bug({ agent: 'claude-code' });
  assert.equal(bug.code, 0);
  assert.ok(!bug.text.includes(originWord), bug.text);
  assert.match(bug.text, /^claude-code: files 1, .*, rejects origin_sdk 1, other 1$/mu);
  const shapes = await s.shapes({ agent: 'claude-code' });
  assert.equal(shapes.code, 0);
  assert.ok(!shapes.text.includes(originWord), shapes.text);
  const shape = JSON.parse(shapes.text);
  assert.equal(shape.files, 1);
  assert.deepEqual(shape.rejects, { origin_sdk: 1, other: 1 });
});
