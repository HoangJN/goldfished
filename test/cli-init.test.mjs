import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { commands } from '../src/cli/init.mjs';
import { commands as card } from '../src/cli/card.mjs';
import { commands as misc } from '../src/cli/misc.mjs';

const fixture = { _synthetic: true, text: 'Keep the harbour open.' };
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'gf-init-')), cwd = join(root, 'repo'), out = [], err = [];
  mkdirSync(cwd); execFileSync('git', ['init', '-q', cwd]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = { cwd, out: s => out.push(s), err: s => err.push(s), isTTY: true, env: { GOLDFISHED_HOME: join(root, 'home') }, today: '2026-10-19', nowMs: 0,
    question: async text => { out.push(text); return 'n'; } };
  return { root, cwd, io, out, err, put(path, text) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); },
    read: path => readFileSync(join(cwd, path), 'utf8'), async run(name = 'init', flags = {}, positional = []) {
      out.length = err.length = 0; const code = await commands[name]({ positional, flags }, io);
      return `${code}\nout:\n${out.join('\n')}\nerr:\n${err.join('\n')}\n`;
    } };
}
function snapshot(name, text) {
  text = text.replaceAll('\\', '\\\\').replaceAll('\uFEFF', '\\uFEFF').replaceAll('\r', '\\r');
  const file = new URL(`./snapshots/init/${name}.txt`, import.meta.url);
  if (process.env.UPDATE_GOLDFISHED_SNAPSHOTS === '1') { mkdirSync(new URL('./snapshots/init/', import.meta.url), { recursive: true }); writeFileSync(file, text); }
  assert.equal(text, readFileSync(file, 'utf8'));
}
test('init previews without a terminal, confirms at a terminal and repeats with an empty diff', async t => {
  const s = setup(t); s.io.isTTY = false;
  const before = readdirSync(s.root, { recursive: true });
  snapshot('no-terminal', await s.run()); assert.deepEqual(readdirSync(s.root, { recursive: true }), before);
  snapshot('dry-run', await s.run('init', { yes: true, 'dry-run': true })); assert.deepEqual(readdirSync(s.root, { recursive: true }), before);
  s.io.isTTY = true; snapshot('declined', await s.run()); assert.deepEqual(readdirSync(s.root, { recursive: true }), before);
  s.io.question = async text => { s.out.push(text); return 'y'; };
  snapshot('confirmed', await s.run()); assert.ok(existsSync(join(s.cwd, '.goldfished/card.md')));
  snapshot('repeat', await s.run('init', { yes: true })); assert.deepEqual(s.out, []);
  s.io.isTTY = false; snapshot('uninit-no-terminal', await s.run('uninit')); assert.ok(existsSync(join(s.cwd, 'AGENTS.md')));
  s.io.isTTY = true; snapshot('uninit', await s.run('uninit')); assert.ok(!existsSync(join(s.cwd, 'AGENTS.md')));
  assert.ok(existsSync(join(s.cwd, '.goldfished/card.md')));
});
test('init then uninit restores LF, CRLF, BOM and final line breaks, even after repeat init', async t => {
  for (const eol of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) for (const final of ['', eol]) {
    const s = setup(t), original = bom + '# Harbour' + eol + fixture.text + final;
    s.io.isTTY = false; s.put('AGENTS.md', original);
    snapshot(`bytes-${eol.length}-${bom.length}-${final.length}`, await s.run('init', { yes: true }));
    snapshot(`bytes-repeat-${eol.length}-${bom.length}-${final.length}`, await s.run('init', { yes: true }));
    snapshot(`bytes-undo-${eol.length}-${bom.length}-${final.length}`, await s.run('uninit', { yes: true }));
    assert.deepEqual(readFileSync(join(s.cwd, 'AGENTS.md')), Buffer.from(original));
  }
});
test('tracked files require shared; commit omits the proposal sentence and excludes private siblings', async t => {
  const s = setup(t); s.put('AGENTS.md', fixture.text + '\n'); execFileSync('git', ['-C', s.cwd, 'add', 'AGENTS.md']);
  snapshot('tracked-skip', await s.run('init', { yes: true })); assert.equal(s.read('AGENTS.md'), fixture.text + '\n');
  snapshot('tracked-shared', await s.run('init', { yes: true, shared: true })); assert.ok(!s.read('AGENTS.md').includes('To suggest an entry'));
  const c = setup(t); await card.rule({ positional: [fixture.text], flags: {} }, c.io);
  snapshot('commit', await c.run('init', { yes: true, commit: true, agents: 'cursor,aider' }));
  assert.ok(!c.read('AGENTS.md').includes('To suggest an entry'));
  assert.match(c.read('.cursor/rules/goldfished.mdc'), /Treat it as project documentation/u);
  assert.deepEqual(c.read('.git/info/exclude').split('\n').filter(line => line && !line.startsWith('#')), ['.goldfished/proposed.md', '.goldfished/archive.md', 'AGENTS.md', 'CONVENTIONS.md', '.cursor/rules/goldfished.mdc']);
});
test('a removed block clears its newline note before the next init', async t => {
  for (const eol of ['\n', '\r\n']) {
    const s = setup(t); s.put('AGENTS.md', 'abc');
    snapshot(`stale-eol-start-${eol.length}`, await s.run('init', { yes: true }));
    s.put('AGENTS.md', 'abc' + eol);
    snapshot(`stale-eol-reinit-${eol.length}`, await s.run('init', { yes: true }));
    const recorded = JSON.parse(readFileSync(join(s.io.env.GOLDFISHED_HOME, 'state.json'), 'utf8')).projects[s.cwd].recorded;
    assert.ok(!recorded['AGENTS.md']?.eolAdded);
    snapshot(`stale-eol-undo-${eol.length}`, await s.run('uninit', { yes: true }));
    assert.deepEqual(readFileSync(join(s.cwd, 'AGENTS.md')), Buffer.from('abc' + eol));
  }
});
test('line diffs keep common leading and trailing lines as context', async t => {
  const s = setup(t); s.put('AGENTS.md', '# Harbour\n'); await s.run('init', { yes: true });
  s.put('AGENTS.md', s.read('AGENTS.md').replace("## The user's card", '## Old pointer') + 'Keep the quay clear.\n');
  snapshot('diff-context-update', await s.run('init', { yes: true }));
  assert.match(s.out.join('\n'), /\n # Harbour\n/u); assert.match(s.out.join('\n'), /\n Keep the quay clear\./u);
  assert.match(s.out.join('\n'), /\n-## Old pointer\n\+## The user's card\n/u);
  s.io.isTTY = false; snapshot('diff-context-remove', await s.run('uninit'));
  assert.match(s.out.join('\n'), /\n # Harbour\n/u); assert.match(s.out.join('\n'), /\n Keep the quay clear\./u);
});
test('an existing card remains untrusted and owned files are skipped', async t => {
  const s = setup(t); s.put('.goldfished/card.md', `## RULES\n[r01 | 2026-10-19] ${fixture.text}\n`);
  const original = s.read('.goldfished/card.md'); snapshot('untrusted', await s.run('init', { yes: true, agents: 'cursor' }));
  assert.equal(s.read('.goldfished/card.md'), original); assert.ok(!existsSync(join(s.cwd, '.cursor/rules/goldfished.mdc')));
  await card.rule({ positional: ['Keep the lantern lit.'], flags: {} }, s.io); assert.match(s.err.join(''), /not trusted/u);
});
test('changed owned files are named and left; card and siblings survive', async t => {
  const s = setup(t); await card.rule({ positional: [fixture.text], flags: {} }, s.io);
  snapshot('owned', await s.run('init', { yes: true, agents: 'cursor,cline,continue,devin' }));
  const path = '.cursor/rules/goldfished.mdc', changed = s.read(path) + '\nA hand edit.\n'; s.put(path, changed);
  const siblings = ['card.md', 'archive.md', 'proposed.md'].map(file => s.read('.goldfished/' + file));
  snapshot('owned-changed', await s.run('uninit', { yes: true })); assert.equal(s.read(path), changed);
  assert.deepEqual(['card.md', 'archive.md', 'proposed.md'].map(file => s.read('.goldfished/' + file)), siblings);
});
test('worktrees copy only after approval and use the common exclude', async t => {
  const s = setup(t), main = join(s.root, 'main'), common = join(main, '.git'), privateDir = join(common, 'worktrees/harbour');
  mkdirSync(join(main, '.goldfished'), { recursive: true }); mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(main, '.goldfished/card.md'), `## RULES\n[r01 | 2026-10-19] ${fixture.text}\n`);
  rmSync(join(s.cwd, '.git'), { recursive: true }); s.put('.git', `gitdir: ${privateDir.replaceAll('\\', '/')}\n`); writeFileSync(join(privateDir, 'commondir'), '../..\n');
  snapshot('worktree-preview', await s.run('init', { 'dry-run': true, shared: true })); assert.ok(!existsSync(join(s.cwd, '.goldfished/card.md')));
  snapshot('worktree-copy', await s.run('init', { yes: true, shared: true })); assert.match(s.read('.goldfished/card.md'), /Keep the harbour open/u);
  assert.equal(await card.rule({ positional: ['Keep the lantern lit.'], flags: {} }, s.io), 0);
  assert.match(readFileSync(join(common, 'info/exclude'), 'utf8'), /\.goldfished\//u); assert.ok(!existsSync(join(privateDir, 'info/exclude')));
});
test('uninit does not need a readable card or valid siblings', async t => {
  const s = setup(t); await s.run('init', { yes: true });
  s.put('.goldfished/card.md', 'A hand edit.'); s.put('.goldfished/proposed.md', 'Not proposal data.');
  snapshot('undo-broken-card', await s.run('uninit', { yes: true }));
  assert.ok(!existsSync(join(s.cwd, 'AGENTS.md'))); assert.equal(s.read('.goldfished/card.md'), 'A hand edit.');
  assert.equal(s.read('.goldfished/proposed.md'), 'Not proposal data.');
});
test('init and uninit reject bad flags and arguments', async t => {
  const s = setup(t);
  for (const name of ['init', 'uninit']) for (const [label, flags, positional] of [['help', { help: true }, []], ['flag', { bogus: true }, []], ['args', {}, ['extra']]])
    snapshot(`${name}-${label}`, await s.run(name, flags, positional));
  snapshot('agent-invalid', await s.run('init', { agents: 'unknown' }));
});

test('init hands over the proved hook step without installing it', async t => {
  for (const agent of ['claude-code', 'codex', 'cursor']) {
    const s = setup(t), heading = 'To bring the card back after compaction, run:';
    if (agent === 'claude-code') mkdirSync(join(s.cwd, '.claude'));
    const flags = agent === 'claude-code' ? {} : { agents: agent };
    assert.equal(await misc.hooks({ positional: [agent], flags: {} }, s.io), 0);
    const steps = [...s.out], before = readdirSync(s.root, { recursive: true });
    const preview = await s.run('init', { ...flags, 'dry-run': true });
    assert.deepEqual(readdirSync(s.root, { recursive: true }), before);
    const applied = await s.run('init', { ...flags, yes: true });
    for (const output of [preview, applied]) {
      if (agent === 'cursor') { assert.ok(!output.includes(heading)); assert.ok(!output.includes(steps.join('\n'))); }
      else assert.ok(output.endsWith(`${heading}\n${steps.join('\n')}\nerr:\n\n`));
    }
    assert.ok(!existsSync(join(s.cwd, '.claude/settings.json')));
    assert.ok(!existsSync(join(s.cwd, '.codex/hooks.json')));
    await s.run('uninit', { yes: true }); assert.ok(!s.out.includes(heading));
  }
});
