import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands } from '../src/cli/misc.mjs';
import { commands as card } from '../src/cli/card.mjs';
import * as pointer from '../src/pointer.mjs';
import { matchSnapshot } from './snapshot.mjs';

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'gfm-')), out = [], err = [];
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const io = { out: s => out.push(s), err: s => err.push(s), cwd, isTTY: false, today: '2026-10-18', nowMs: Date.now(),
    env: { GOLDFISHED_HOME: join(cwd, 'home'), CLAUDE_CONFIG_DIR: join(cwd, 'claude'), CODEX_HOME: join(cwd, 'codex') } };
  mkdirSync(join(cwd, 'claude/projects'), { recursive: true }); mkdirSync(join(cwd, 'codex'), { recursive: true });
  cpSync(new URL('./fixtures/claude-code', import.meta.url), join(cwd, 'claude/projects'), { recursive: true });
  cpSync(new URL('./fixtures/codex/sessions', import.meta.url), join(cwd, 'codex/sessions'), { recursive: true });
  return { cwd, io, out, err, async run(name, positional = [], flags = {}) {
    out.length = err.length = 0; const code = await (commands[name] ?? card[name])({ positional, flags }, io);
    const text = `${code}\nout:\n${out.join('\n')}\nerr:\n${err.join('\n')}\n`;
    assert.ok(!text.includes('GOLDFISHED-CANARY-7f3a'));
    return text.replaceAll(cwd, '<project>').replaceAll(process.execPath, '<node>').replaceAll(process.version, '<version>')
      .replaceAll(fileURLToPath(new URL('../hooks/run.mjs', import.meta.url)).replaceAll('\\', '/'), '<installed>/hooks/run.mjs').replaceAll('<project>\\', '<project>/');
  } };
}
test('shapes tallies every fixture without exposing its messages or paths', async t => {
  const s = setup(t); matchSnapshot('cli', 'shapes', await s.run('shapes'));
  for (const flags of [{ dir: s.cwd }, { agent: 'all', dir: s.cwd }]) matchSnapshot('cli', 'shapes-dir-refused', await s.run('shapes', [], flags));
  assert.match(await s.run('shapes', [], { agent: 'unknown' }), /^1\n/u);
  assert.match(await s.run('shapes', [], { agent: 'claude-code', dir: 'claude/projects' }), /^0\n/u);
});
test('doctor, card and list keep the canary out of output', async t => {
  const s = setup(t);
  matchSnapshot('cli', 'doctor', await s.run('doctor')); await s.run('list'); await s.run('card');
  s.io.isTTY = true; await card.rule({ positional: ['Keep the harbour open.'], flags: {} }, s.io);
  assert.match(await s.run('doctor'), /Card: trusted/u);
  pointer.apply(pointer.plan({ top: s.cwd, agents: [], shared: true, commit: false, existing: {}, tracked: {}, recorded: {},
    card: { goal: null, rules: [], out: [], errors: [] }, trusted: true }));
  assert.match(await s.run('doctor'), /Pointer AGENTS.md: current/u);
  writeFileSync(join(s.cwd, 'AGENTS.md'), 'Keep this.'); assert.match(await s.run('doctor'), /Pointer AGENTS.md: changed/u);
  writeFileSync(join(s.io.env.GOLDFISHED_HOME, 'state.json'), JSON.stringify({ probes: { codex: { date: '2026-10-18', kept: true } } }));
  assert.match(await s.run('doctor'), /Probe codex: 2026-10-18, kept/u);
  writeFileSync(join(s.cwd, '.goldfished/card.md'), '## RULES\n[r01 | broken]\n');
  assert.match(await s.run('doctor'), /Parse error on line/u);
});
test('purge needs confirmation, deletes only its home, and never the card', async t => {
  const s = setup(t); mkdirSync(s.io.env.GOLDFISHED_HOME); writeFileSync(join(s.io.env.GOLDFISHED_HOME, 'trust.json'), '{}');
  const before = readdirSync(s.cwd, { recursive: true }); matchSnapshot('cli', 'purge-refused', await s.run('purge'));
  assert.deepEqual(readdirSync(s.cwd, { recursive: true }), before);
  mkdirSync(join(s.cwd, '.goldfished')); writeFileSync(join(s.cwd, '.goldfished/card.md'), 'Keep this.');
  matchSnapshot('cli', 'purge', await s.run('purge', [], { yes: true }));
  assert.equal(existsSync(s.io.env.GOLDFISHED_HOME), false); assert.ok(existsSync(join(s.cwd, '.goldfished/card.md')));
});
test('hooks only print instructions; all housekeeping commands check flags', async t => {
  const s = setup(t);
  for (const agent of ['claude-code', 'codex', 'cursor', 'gemini']) matchSnapshot('cli', `hooks-${agent}`, await s.run('hooks', [agent]));
  assert.equal(existsSync(s.io.env.GOLDFISHED_HOME), false);
  assert.match(await s.run('hooks', ['unknown']), /^1\n/u);
  for (const name of Object.keys(commands)) {
    matchSnapshot('cli', `help-${name}`, await s.run(name, [], { help: true }));
    matchSnapshot('cli', `flag-${name}`, await s.run(name, [], { bogus: true }));
    assert.match(await s.run(name, ['extra', 'arguments']), /^1\n/u);
  }
});
