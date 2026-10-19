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
const bin = join(root, 'bin/goldfished.mjs');
function world(t) {
  const base = mkdtempSync(join(tmpdir(), 'gf-privacy-')), env = isolated(base), cwd = join(base, 'project');
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
function hygiene(value, key = '') {
  assert.ok(!['text', 'message', 'path', 'project', 'dir', 'cwd'].includes(key), key);
  if (typeof value === 'string' && !['span_rule', 'tool_version'].includes(key)) assert.ok(value.length <= 40, key);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) hygiene(v, Array.isArray(value) ? key : k);
}
test('invented canaries stay out of output; opt-in samples are masked; JSON contains counts', async t => {
  const w = world(t);
  for (const agent of ['claude-code', 'codex']) {
    const folder = agent === 'codex' ? join(w.env.CODEX_HOME, 'sessions') : join(w.env.CLAUDE_CONFIG_DIR, 'projects');
    generate(agent, 3, folder, { canary: canaries.join(' ') });
  }
  assert.equal(w.cli('init', '--agents', 'claude-code,codex', '--yes').status, 0);
  const { commands } = await import('../src/cli/card.mjs');
  assert.equal(await commands.goal({ positional: ['Keep the invented orchard open.'], flags: {} },
    { env: w.env, cwd: w.cwd, isTTY: true, today: '2026-10-19', out() {}, err: assert.fail }), 0);
  for (const args of [['retro', '--days', '0'], ['retro', '--days', '0', '--json'], ['shapes'], ['doctor'], ['card'], ['list']]) {
    const got = w.cli(...args); assert.equal(got.status, 0, got.stderr); clean(got.stdout + got.stderr);
    if (args.includes('--json')) { const json = JSON.parse(got.stdout); hygiene(json); assert.equal(json.agents.length, 2); assert.ok(json.agents.every(a => a.messages > 0)); }
  }
  for (const flag of ['--show', '--audit']) {
    const got = w.cli('retro', '--days', '0', flag);
    assert.equal(got.status, 0, got.stderr); assert.ok(!(got.stdout + got.stderr).includes(canaries[1]), got.stdout); assert.ok(got.stdout.includes('[hidden]'), got.stdout);
  }
  for (const agent of ['claude-code', 'codex']) for (const event of ['prompt', 'session-start']) for (const prompt of [canaries.join(' '), 'gf: list', 'gf: restore z99']) {
    const input = JSON.stringify({ cwd: w.cwd, source: 'compact', prompt, user_prompt: prompt, message: canaries.join(' '),
      transcript_path: join(w.env.CLAUDE_CONFIG_DIR, 'projects/orchard/oracle.jsonl') });
    for (const args of [[bin, 'hook', agent, event], [join(root, 'hooks/run.mjs'), agent, event]]) {
      const got = run(args, { env: w.env, cwd: w.cwd, input });
      assert.equal(got.status, 0, got.stderr); clean(got.stdout + got.stderr);
      if (event === 'session-start') assert.ok(got.stdout.includes('Keep the invented orchard open.'), got.stdout);
    }
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
  let before = listing(w.base);
  const preview = w.cli('init', '--agents', 'claude-code,codex,cursor', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr); assert.deepEqual(listing(w.base), before);
  const planned = [...preview.stdout.matchAll(/^\+\+\+ ([^<\n][^\n]*)$/gm)].map(m => `project/${m[1]}`);
  assert.ok(planned.includes('project/AGENTS.md') && planned.includes('project/CLAUDE.md'));
  const directories = ['goldfished', 'project/.goldfished'], files = [...planned, 'project/.git/info/exclude'];
  const check = () => {
    const after = listing(w.base);
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[name] !== after[name]) {
      const permitted = directories.some(dir => name === dir || name.startsWith(dir + '/')) || files.includes(name) ||
        after[name] === null && [...directories, ...files].some(path => path.startsWith(name + '/'));
      assert.ok(permitted, `write outside the permitted paths: ${name}`);
    }
    before = after;
  };
  assert.equal(w.cli('init', '--agents', 'claude-code,codex,cursor', '--yes').status, 0); check();
  const { commands } = await import('../src/cli/card.mjs');
  const errors = [], io = { env: w.env, cwd: w.cwd, isTTY: true, today: '2026-10-19', out() {}, err: s => errors.push(s) };
  for (const [verb, positional, flags = {}] of [['goal', ['Keep the invented orchard open.']], ['rule', ['Use plain text.']],
    ['out', ['Database'], { quote: 'Keep files on disk.' }], ['edit', ['r01', 'Use readable plain text.']], ['drop', ['r01']],
    ['restore', ['r01']]]) {
    assert.equal(await commands[verb]({ positional, flags }, io), 0, `${verb}: ${errors.join('\n')}`); check();
  }
  for (const args of [['retro', '--days', '0', '--save'], ['list'], ['card'], ['uninit', '--yes']]) {
    const got = w.cli(...args); assert.equal(got.status, 0, got.stderr); check();
  }
});
