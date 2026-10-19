import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commands } from '../src/cli/probe.mjs';
import { commands as init } from '../src/cli/init.mjs';

const fixture = { _synthetic: true, agent: 'cursor' };
function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'gf-probe-')), out = [], err = [];
  t.after(() => rmSync(cwd, { recursive: true, force: true })); mkdirSync(join(cwd, '.git'));
  const io = { cwd, out: s => out.push(s), err: s => err.push(s), isTTY: true, env: { GOLDFISHED_HOME: join(cwd, 'home') }, today: '2026-10-19', nowMs: 0 };
  return { cwd, io, out, err, read: path => readFileSync(join(cwd, path), 'utf8'), async run(positional = [fixture.agent], flags = {}) {
    out.length = err.length = 0; const code = await commands.probe({ positional, flags }, io);
    return `${code}\nout:\n${out.join('\n')}\nerr:\n${err.join('\n')}\n`;
  } };
}
function snapshot(name, text) {
  text = text.replaceAll('\\', '\\\\').replaceAll('\uFEFF', '\\uFEFF');
  const file = new URL(`./snapshots/init/probe-${name}.txt`, import.meta.url);
  if (process.env.UPDATE_GOLDFISHED_SNAPSHOTS === '1') { mkdirSync(new URL('./snapshots/init/', import.meta.url), { recursive: true }); writeFileSync(file, text); }
  assert.equal(text, readFileSync(file, 'utf8'));
}
test('both probe forms refuse without a terminal before touching files', async t => {
  const s = setup(t); s.io.isTTY = false; const before = readdirSync(s.cwd, { recursive: true });
  snapshot('guard', await s.run()); snapshot('guard-saw', await s.run([fixture.agent], { saw: 'yes' }));
  s.io.env.MSYSTEM = 'MINGW64'; snapshot('git-bash', await s.run());
  assert.deepEqual(readdirSync(s.cwd, { recursive: true }), before);
});
test('probe adds the rule through actions, updates inline files and records both observations', async t => {
  for (const saw of ['yes', 'no']) {
    const s = setup(t); await init.init({ positional: [], flags: { yes: true, shared: true, agents: fixture.agent } }, s.io);
    snapshot(`start-${saw}`, await s.run()); assert.match(s.read('.goldfished/card.md'), /PELICAN/u);
    assert.match(s.read('.cursor/rules/goldfished.mdc'), /PELICAN/u);
    snapshot(`saw-${saw}`, await s.run([fixture.agent], { saw })); assert.ok(!s.read('.goldfished/card.md').includes('PELICAN'));
    assert.ok(!s.read('.cursor/rules/goldfished.mdc').includes('PELICAN'));
    assert.deepEqual(JSON.parse(s.read('home/state.json')).probes.cursor, { agent: fixture.agent, date: s.io.today, kept: saw === 'yes' });
    assert.match(s.read('.goldfished/archive.md'), /PELICAN/u);
  }
});
test('saw without a probe rule records nothing', async t => {
  const s = setup(t); snapshot('no-rule', await s.run([fixture.agent], { saw: 'yes' }));
  assert.ok(!existsSync(join(s.cwd, 'home/state.json'))); assert.ok(!existsSync(join(s.cwd, '.goldfished')));
});
test('probe never trusts a card edited by hand', async t => {
  const s = setup(t); await s.run();
  const file = join(s.cwd, '.goldfished/card.md'), edited = s.read('.goldfished/card.md') + '\n'; writeFileSync(file, edited);
  const state = s.read('home/state.json');
  snapshot('untrusted-start', await s.run()); snapshot('untrusted-saw', await s.run([fixture.agent], { saw: 'no' }));
  assert.equal(s.read('.goldfished/card.md'), edited); assert.equal(s.read('home/state.json'), state);
});
test('compact commands and validation replies', async t => {
  const s = setup(t);
  for (const agent of ['claude-code', 'codex', 'gemini', 'copilot']) snapshot(agent, await s.run([agent]));
  for (const [label, positional, flags] of [['help', [], { help: true }], ['flag', [], { bogus: true }], ['missing', [], {}], ['unknown', ['unknown'], {}], ['invalid-saw', [fixture.agent], { saw: 'maybe' }]])
    snapshot(label, await s.run(positional, flags));
});
