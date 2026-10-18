import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { commands } from '../src/cli/card.mjs';
import { matchSnapshot } from './snapshot.mjs';

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'gfc-')), out = [], err = [];
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, '.git'));
  const io = { out: s => out.push(s), err: s => err.push(s), cwd, isTTY: true, today: '2026-10-18', nowMs: Date.now(),
    env: { GOLDFISHED_HOME: join(cwd, 'home'), CLAUDE_CONFIG_DIR: join(cwd, 'claude'), CODEX_HOME: join(cwd, 'codex') } };
  return { cwd, io, out, err, async run(name, positional = [], flags = {}) {
    out.length = err.length = 0;
    const code = await commands[name]({ positional, flags }, io);
    return `${code}\nout:\n${out.join('\n')}\nerr:\n${err.join('\n')}\n`;
  } };
}
test('every starred command refuses before creating any file', async t => {
  const s = setup(t); s.io.isTTY = false;
  for (const name of ['goal', 'rule', 'out', 'edit', 'drop', 'restore', 'accept', 'reject', 'trust']) {
    const before = readdirSync(s.cwd, { recursive: true });
    matchSnapshot('cli', `guard-${name}`, await s.run(name));
    assert.deepEqual(readdirSync(s.cwd, { recursive: true }), before);
  }
  s.io.env.MSYSTEM = 'MINGW64'; matchSnapshot('cli', 'git-bash', await s.run('rule', ['Never push to main.']));
});
test('card commands use actions and keep the replies', async t => {
  const s = setup(t), cases = [
    ['goal', ['Keep the harbour open.']], ['rule', ['Never push to main.']],
    ['out', ['Redis'], { quote: 'Never use Redis here.' }], ['edit', ['r01', 'Keep main protected.']],
    ['drop', ['r01']], ['restore', ['r01']], ['list'], ['card'], ['card', [], { agent: 'codex' }], ['trust'],
  ];
  for (const [name, positional, flags] of cases) matchSnapshot('cli', name === 'card' && flags ? 'card-codex' : name, await s.run(name, positional, flags));
  writeFileSync(join(s.cwd, '.goldfished/card.md'), readFileSync(join(s.cwd, '.goldfished/card.md'), 'utf8') + '\n');
  assert.equal((await s.run('rule', ['Keep the gate shut.'])).startsWith('1\n'), true);
  assert.match(s.err.join(''), /not trusted/);
});
function session(s, agent = 'claude-code') {
  const claude = agent === 'claude-code', folder = claude ? join(s.io.env.CLAUDE_CONFIG_DIR, 'projects', 'invented') : join(s.io.env.CODEX_HOME, 'sessions/2026/01/05');
  mkdirSync(folder, { recursive: true });
  const fixture = new URL(claude ? './fixtures/claude-code/plain.jsonl' : './fixtures/codex/sessions/2026/01/05/rollout-plain.jsonl', import.meta.url);
  const text = readFileSync(fixture, 'utf8').replaceAll(claude ? 'D:/work/tide-tables' : '/srv/work/copper-kettle', s.cwd.replaceAll('\\', '/'))
    .replaceAll('Keep the harbour timetable in plain text.', 'Never use Redis. Keep the harbour timetable in plain text!');
  const file = join(folder, claude ? 'plain.jsonl' : 'rollout-plain.jsonl'); writeFileSync(file, text); return file;
}
test('proposals check complete messages and sentences, then accept or reject', async t => {
  const s = setup(t), flags = { quote: 'Keep the gate shut.', note: 'a reason' };
  matchSnapshot('cli', 'propose-no-session', await s.run('propose', [], flags)); session(s);
  matchSnapshot('cli', 'propose-absent', await s.run('propose', [], flags));
  matchSnapshot('cli', 'propose-fragment', await s.run('propose', [], { ...flags, quote: 'use Redis' }));
  assert.equal(existsSync(join(s.cwd, '.goldfished')), false);
  matchSnapshot('cli', 'propose', await s.run('propose', [], { quote: '  KEEP the harbour\t timetable in plain text! ', note: '\u001b[31mKeep\n\u0000this' + 'x'.repeat(90) }));
  const saved = JSON.parse(readFileSync(join(s.cwd, '.goldfished/proposed.md'), 'utf8')).entries[0];
  assert.equal(saved.note.length, 80); assert.ok(saved.note.startsWith('Keepthis')); assert.equal(saved.from, saved.quote);
  assert.ok(!readFileSync(join(s.cwd, '.goldfished/proposed.md'), 'utf8').includes('Never use Redis'));
  matchSnapshot('cli', 'accept-no-label', await s.run('accept', ['p1']));
  matchSnapshot('cli', 'accept', await s.run('accept', ['p1', 'Timetable']));
  assert.ok(!readFileSync(join(s.cwd, '.goldfished/card.md'), 'utf8').includes('Keepthis'));
  await s.run('propose', [], { quote: 'Never use Redis.', note: 'Avoid it' });
  matchSnapshot('cli', 'accept-rule', await s.run('accept', ['p2'], { rule: true }));
  await s.run('propose', [], { quote: 'Never use Redis.', note: 'Avoid it' });
  matchSnapshot('cli', 'reject', await s.run('reject', ['p3']));
  matchSnapshot('cli', 'propose-partial-long', await s.run('propose', [], { quote: 'the harbour timetable in plain text', note: 'Avoid it' }));
});
test('quote lookup uses Codex too and excludes sessions older than two days', async t => {
  const s = setup(t), file = session(s, 'codex');
  const other = session(s);
  const text = readFileSync(file, 'utf8').match(/"message":"([^"]+)"/u)?.[1]; assert.ok(text);
  assert.match(await s.run('propose', [], { quote: text, note: 'Keep it' }), /^0\n/u);
  const old = new Date(s.io.nowMs - 3 * 86400000); utimesSync(file, old, old); utimesSync(other, old, old);
  matchSnapshot('cli', 'propose-old-session', await s.run('propose', [], { quote: text, note: 'Keep it' }));
});
test('proposing cannot trust a hand-edited or malformed card', async t => {
  const s = setup(t); session(s); await s.run('rule', ['Keep the harbour open.']);
  const path = join(s.cwd, '.goldfished/card.md'), flags = { quote: 'Never use Redis.', note: 'Keep it' };
  writeFileSync(path, readFileSync(path, 'utf8') + '\n');
  assert.match(await s.run('propose', [], flags), /^1\n/u); assert.match(s.err.join(''), /not trusted.*nothing was changed/u);
  writeFileSync(path, '## RULES\n[r01 | broken]\n');
  const before = readFileSync(path, 'utf8');
  assert.match(await s.run('propose', [], flags), /^1\n/u); assert.match(s.err.join(''), /Fix line/u);
  assert.equal(readFileSync(path, 'utf8'), before);
});
test('only the newest matching session supplies quotes', async t => {
  const s = setup(t), file = session(s), newer = join(dirname(file), 'newer.jsonl');
  writeFileSync(newer, readFileSync(file, 'utf8').replaceAll('Never use Redis.', 'Never use SQLite.'));
  utimesSync(file, new Date(s.io.nowMs - 3600000), new Date(s.io.nowMs - 3600000));
  matchSnapshot('cli', 'propose-older-quote', await s.run('propose', [], { quote: 'Never use Redis.', note: 'Keep it' }));
  assert.match(await s.run('propose', [], { quote: 'Never use SQLite.', note: 'Keep it' }), /^0\n/u);
});
test('a command from a nested directory saves at the project top', async t => {
  const s = setup(t); s.io.cwd = join(s.cwd, 'nested'); mkdirSync(s.io.cwd);
  assert.match(await s.run('rule', ['Keep the harbour open.']), /^0\n/u);
  assert.ok(existsSync(join(s.cwd, '.goldfished/card.md'))); assert.ok(!existsSync(join(s.io.cwd, '.goldfished')));
});
test('card flags, help and argument counts', async t => {
  const s = setup(t);
  for (const name of Object.keys(commands)) {
    matchSnapshot('cli', `help-${name}`, await s.run(name, [], { help: true }));
    matchSnapshot('cli', `flag-${name}`, await s.run(name, [], { bogus: true }));
  }
  assert.match(await s.run('out', ['Redis'], { quote: true }), /^1\n/u);
  assert.match(await s.run('trust', ['extra']), /^1\n/u);
  assert.match(await s.run('card', [], { agent: 'unknown' }), /^1\n/u);
});
