import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, isolated, root, run } from '../scripts/oracle.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'gf-privacy-env-'));
Object.assign(process.env, isolated(sandbox));
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
const canaries = ['GOLDFISHED-CANARY-7f3a', ['sk', 'ant', 'canary0000000000000000'].join('-')];
const project = 'invented-saffron-quayside';
const bin = join(root, 'bin/goldfished.mjs');
function world(t) {
  const base = mkdtempSync(join(tmpdir(), 'gf-privacy-')), env = isolated(base), cwd = join(base, project);
  mkdirSync(cwd);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cli = (...args) => run([bin, ...args], { cwd, env });
  return { base, env, cwd, cli };
}
function listing(base) {
  return Object.fromEntries(readdirSync(base, { recursive: true }).sort().map(name => {
    const file = join(base, name);
    return [name.replaceAll('\\', '/'), statSync(file).isDirectory() ? null : createHash('sha256').update(readFileSync(file)).digest('hex')];
  }));
}
function clean(text) { for (const canary of canaries) assert.ok(!text.includes(canary), text); }
function privateText(text, w) { for (const word of [project, w.base, w.base.replaceAll('\\', '/')]) assert.ok(!text.includes(word), text); }
function hygiene(value, key = '', w) {
  assert.ok(!['text', 'message', 'path', 'project', 'dir', 'cwd'].includes(key), key);
  if (typeof value === 'string') { if (w) privateText(value, w); if (!['span_rule', 'tool_version'].includes(key)) assert.ok(value.length <= 40, key); }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) hygiene(v, Array.isArray(value) ? key : k, w);
}
test('invented canaries stay out of output; opt-in samples are masked; JSON contains counts', async t => {
  const w = world(t);
  for (const agent of ['claude-code', 'codex']) {
    const folder = agent === 'codex' ? join(w.env.CODEX_HOME, 'sessions') : join(w.env.CLAUDE_CONFIG_DIR, 'projects');
    generate(agent, 3, folder, { canary: canaries.join(' '), cwd: w.cwd, sessions: 1 });
  }
  assert.equal(w.cli('init', '--agents', 'claude-code,codex', '--yes').status, 0);
  const { commands } = await import('../src/cli/card.mjs');
  assert.equal(await commands.goal({ positional: ['Keep the invented orchard open.'], flags: {} },
    { env: w.env, cwd: w.cwd, isTTY: true, today: '2026-10-19', out() {}, err: assert.fail }), 0);
  for (const args of [['retro', '--days', '0'], ['retro', '--days', '0', '--json'], ['shapes'], ['bug'], ['doctor'], ['card'], ['list']]) {
    const got = w.cli(...args); assert.equal(got.status, 0, got.stderr); clean(got.stdout + got.stderr);
    if (['retro', 'bug'].includes(args[0])) privateText(got.stdout + got.stderr, w);
    if (args.includes('--json')) { const json = JSON.parse(got.stdout); hygiene(json, '', w); assert.equal(json.agents.length, 2); assert.ok(json.agents.every(a => a.messages > 0)); }
  }
  for (const flag of ['--show', '--audit']) {
    const got = w.cli('retro', '--days', '0', flag);
    assert.equal(got.status, 0, got.stderr); assert.ok(!(got.stdout + got.stderr).includes(canaries[1]), got.stdout); assert.ok(got.stdout.includes('[hidden]'), got.stdout);
  }
});
test('hooks mask typed keys when saving and re-send the stored card text', t => {
  const safe = (got, allowWord = false) => {
    for (const value of canaries.slice(allowWord ? 1 : 0)) assert.ok(!(got.stdout + got.stderr).includes(value), got.stdout);
  };
  for (const agent of ['claude-code', 'codex']) for (const launcher of ['bin', 'hook']) {
    const w = world(t); assert.equal(w.cli('init', '--agents', agent, '--yes').status, 0);
    const hook = (event, prompt) => {
      const args = launcher === 'bin' ? [bin, 'hook', agent, event] : [join(root, 'hooks/run.mjs'), agent, event];
      const got = run(args, { env: w.env, cwd: w.cwd, input: JSON.stringify({ cwd: w.cwd, source: 'compact', prompt }) });
      assert.equal(got.status, 0, got.stderr); assert.notEqual(got.stdout, '', `${agent} ${launcher} ${event}`); return got;
    };
    for (const value of canaries) {
      const got = hook('prompt', `gf: ${value} x`), reply = JSON.parse(got.stdout);
      assert.equal(reply.decision, 'block'); assert.match(reply.reason, /^goldfished: unknown command /u);
      safe(got, value === canaries[0]);
      if (value === canaries[0]) assert.ok(reply.reason.includes(value)); else assert.ok(reply.reason.includes('[hidden]'));
    }
    for (const prompt of [`gf: goal ${canaries.join(' ')} goal text.`, `rule: ${canaries.join(' ')} rule text.`]) {
      const got = hook('prompt', prompt), reply = JSON.parse(got.stdout); safe(got);
      assert.match(reply.reason ?? reply.systemMessage, /goal set|saved r\d+/u);
      const stored = readFileSync(join(w.cwd, '.goldfished/card.md'), 'utf8');
      assert.ok(!stored.includes(canaries[1]) && stored.includes('[hidden]'), stored);
    }
    const stored = readFileSync(join(w.cwd, '.goldfished/card.md'), 'utf8'), texts = [...stored.matchAll(/^\[[gr]\d+ \| [^\]]+\] (.*)$/gm)].map(m => m[1]);
    assert.deepEqual(texts, [`${canaries[0]} [hidden] goal text.`, `${canaries[0]} [hidden] rule text.`]);
    const got = hook('session-start'); safe(got, true);
    const context = JSON.parse(got.stdout).hookSpecificOutput.additionalContext;
    for (const text of texts) assert.ok(context.includes(text), context);
  }
});
test('retro leaves an existing private home byte-identical until save', t => {
  const w = world(t), home = w.env.GOLDFISHED_HOME;
  generate('claude-code', 1, join(w.env.CLAUDE_CONFIG_DIR, 'projects'), { cwd: w.cwd, canary: 'Keep a local index.' });
  writeFileSync(join(home, 'sentinel'), 'Leave these bytes alone.\n');
  mkdirSync(join(home, 'empty'));
  const before = listing(home);
  for (const args of [[], ['--json'], ['--show'], ['--audit']]) {
    assert.equal(w.cli('retro', '--days', '0', ...args).status, 0); assert.deepEqual(listing(home), before);
  }
  assert.equal(w.cli('retro', '--days', '0', '--save').status, 0);
  assert.ok(existsSync(join(home, 'history.jsonl')));
  for (const line of readFileSync(join(home, 'history.jsonl'), 'utf8').trim().split('\n')) hygiene(JSON.parse(line));
});
test('planted network imports fail the real gate in a disposable copy', t => {
  const w = world(t), copy = join(w.base, 'copy'); mkdirSync(copy);
  for (const path of ['src', 'bin', 'hooks', 'scripts', 'package.json']) cpSync(join(root, path), join(copy, path), { recursive: true });
  const git = spawnSync('git', ['init', '--quiet', copy], { env: w.env, encoding: 'utf8', timeout: 30000 }); assert.equal(git.status, 0, git.stderr);
  const env = { ...w.env, GOLDFISHED_IDENTITY: 'Fixture Keeper <fixture@example.test>' };
  assert.equal(run(['scripts/gate.mjs'], { cwd: copy, env }).status, 0);
  for (const [dir, module] of [['src', 'http2'], ['hooks', 'https']]) {
    const file = join(copy, dir, 'privacy-plant.mjs'); writeFileSync(file, `import 'node:${module}';\n`);
    const got = run(['scripts/gate.mjs'], { cwd: copy, env });
    assert.equal(got.status, 1, got.stderr); assert.match(got.stdout, new RegExp(`FAIL no-network: ${dir}/privacy-plant.mjs:1 network module`));
    rmSync(file);
  }
});
test('all writes stay in the private home, card folder, previewed files or local exclude', async t => {
  const w = world(t), git = spawnSync('git', ['init', '--quiet', w.cwd], { env: w.env, encoding: 'utf8', timeout: 30000 });
  assert.equal(git.status, 0, git.stderr);
  generate('claude-code', 1, join(w.env.CLAUDE_CONFIG_DIR, 'projects'), { cwd: w.cwd, canary: 'Keep a local index.' });
  writeFileSync(join(w.env.HOME, 'sentinel'), 'Unrelated home file.\n');
  writeFileSync(join(w.cwd, 'sentinel'), 'Unrelated project file.\n');
  let before = listing(w.base), processBefore = listing(sandbox);
  const preview = w.cli('init', '--agents', 'claude-code,codex,cursor', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr); assert.deepEqual(listing(w.base), before);
  assert.deepEqual(listing(sandbox), processBefore);
  const planned = [...preview.stdout.matchAll(/^\+\+\+ ([^<\n][^\n]*)$/gm)].map(m => `${project}/${m[1]}`);
  assert.ok(planned.includes(`${project}/AGENTS.md`) && planned.includes(`${project}/CLAUDE.md`));
  const directories = ['goldfished', `${project}/.goldfished`], files = [...planned, `${project}/.git/info/exclude`];
  const check = () => {
    const after = listing(w.base);
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[name] !== after[name]) {
      const permitted = directories.some(dir => name === dir || name.startsWith(dir + '/')) || files.includes(name) ||
        after[name] === null && [...directories, ...files].some(path => path.startsWith(name + '/'));
      assert.ok(permitted, `write outside the permitted paths: ${name}`);
    }
    assert.deepEqual(listing(sandbox), processBefore, 'writes escaped into the in-process sandbox'); before = after; processBefore = listing(sandbox);
  };
  assert.equal(w.cli('init', '--agents', 'claude-code,codex,cursor', '--yes').status, 0); check();
  const { commands } = await import('../src/cli/card.mjs');
  const errors = [], io = { env: w.env, cwd: w.cwd, isTTY: true, today: '2026-10-19', nowMs: Date.now(), out() {}, err: s => errors.push(s) };
  for (const [verb, positional, flags = {}] of [['goal', ['Keep the invented orchard open.']], ['rule', ['Use plain text.']],
    ['out', ['Database'], { quote: 'Keep files on disk.' }], ['edit', ['r01', 'Use readable plain text.']], ['drop', ['r01']],
    ['restore', ['r01']], ['propose', [], { quote: 'Keep a local index.', note: 'An invented suggestion.' }]]) {
    assert.equal(await commands[verb]({ positional, flags }, io), 0, `${verb}: ${errors.join('\n')}`); check();
  }
  assert.ok(readFileSync(join(w.cwd, '.goldfished/proposed.md'), 'utf8').includes('Keep a local index.'));
  for (const args of [['retro', '--days', '0'], ['retro', '--days', '0', '--show'], ['retro', '--days', '0', '--audit'],
    ['shapes'], ['bug'], ['doctor'], ['retro', '--days', '0', '--save'], ['list'], ['card']]) {
    const got = w.cli(...args); assert.equal(got.status, 0, got.stderr); check();
  }
  for (const agent of ['claude-code', 'codex']) for (const launcher of ['bin', 'hook']) for (const event of ['prompt', 'session-start']) {
    const args = launcher === 'bin' ? [bin, 'hook', agent, event] : [join(root, 'hooks/run.mjs'), agent, event];
    const got = run(args, { env: w.env, cwd: w.cwd, input: JSON.stringify({ cwd: w.cwd, source: 'compact', prompt: 'rule: Keep the invented harvest readable.' }) });
    assert.equal(got.status, 0, got.stderr); assert.notEqual(got.stdout, ''); check();
  }
  assert.equal(w.cli('uninit', '--yes').status, 0); check();
});
