import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { block, parse } from '../src/card.mjs';
import * as store from '../src/store.mjs';
import * as home from '../src/home.mjs';
import { META } from '../src/agents/meta.mjs';
import * as claude from '../src/agents/claude-code.hookio.mjs';
import * as codex from '../src/agents/codex.hookio.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'goldfished-hooks-')), launcher = resolve('hooks/run.mjs');
const previousHome = process.env.GOLDFISHED_HOME, ios = { 'claude-code': claude, codex };
after(() => { if (previousHome === undefined) delete process.env.GOLDFISHED_HOME; else process.env.GOLDFISHED_HOME = previousHome; rmSync(scratch, { recursive: true, force: true }); });
function fixture() {
  const top = mkdtempSync(join(scratch, 'project-')), homePath = join(top, 'home');
  process.env.GOLDFISHED_HOME = homePath;
  return { top, env: { ...process.env, GOLDFISHED_HOME: homePath } };
}
function run(f, agent, event, payload, extra = {}) {
  const result = spawnSync(process.execPath, [launcher, agent, event], { input: typeof payload === 'string' ? payload : JSON.stringify({ _synthetic: true, cwd: f.top, hook_event_name: event === 'prompt' ? 'UserPromptSubmit' : 'SessionStart', ...payload }), env: f.env, encoding: 'utf8', timeout: 5000, ...extra });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
const json = r => JSON.parse(r.stdout);
const source = '# goldfished card\n\n## GOAL\n[g01 | 2026-10-01] Ship the lantern.\n\n## RULES\n[r01 | 2026-10-01] Keep the brass.\n\n## RULED OUT\n[x01 | 2026-10-01] Plastic. User said: "Use brass."\n';
function save(f, text = source) { store.save(f.top, { ...store.load(f.top), card: parse(text) }); return store.load(f.top); }

for (const agent of Object.keys(ios)) {
  test(`T1 ${agent}: 40 ordinary prompts do not read project or home`, () => {
    const f = fixture(), preload = join(scratch, `reads-${agent}.mjs`);
    writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const top = process.env.PROJECT;
for (const target of [fs, fs.promises]) for (const key of ['readFileSync','readFile','openSync','open','statSync','stat','lstatSync','lstat','readdirSync','readdir','existsSync','accessSync','access','realpathSync','realpath']) {
 if (!target[key]) continue; const original = target[key]; target[key] = function(path, ...args) {
 if (String(path).startsWith(top)) { process.stderr.write('project read'); throw new Error('read'); } return original.call(this, path, ...args);
 }; } syncBuiltinESMExports();`);
    const ordinary = ['Please check the lantern', ' rule: Keep brass.', 'Rule: Keep brass.', 'GF: help', 'gf:help', 'rule:Keep brass.', 'Please run gf: help', '<task-notification>rule: Keep brass.</task-notification>'];
    for (let i = 0; i < 40; i++) {
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, launcher, agent, 'prompt'], { input: JSON.stringify({ _synthetic: true, cwd: f.top, hook_event_name: 'UserPromptSubmit', prompt: ordinary[i % ordinary.length] }), env: { ...f.env, PROJECT: f.top }, encoding: 'utf8' });
      assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    }
  });
  test(`T2 ${agent}: rule saves on screen and passes through, including refusal`, () => {
    const f = fixture(), io = ios[agent];
    const result = json(run(f, agent, 'prompt', { prompt: 'rule: Keep the hinge.' }));
    assert.deepEqual(result, io.screenOutput('goldfished: saved r01. 1 rule, 0 goals, 0 ruled out.'));
    assert.equal(store.load(f.top).card.rules[0].text, 'Keep the hinge.');
    assert.deepEqual(json(run(f, agent, 'prompt', { prompt: 'rule: ' + 'a'.repeat(1612) })), io.screenOutput('goldfished: that rule is 1,612 characters; the limit is 1,500. It was not saved; your message was sent as usual.'));
    assert.equal(store.load(f.top).card.rules.length, 1);
  });
  test(`T3 ${agent}: every chat verb answers without a model turn`, () => {
    const f = fixture(), io = ios[agent];
    store.save(f.top, { ...store.load(f.top), proposals: { next: 2, entries: [{ id: 'p1', quote: 'Glass lasts.', note: 'candidate', from: 'synthetic' }] } });
    const commands = ['goal Light the harbour.', 'out cheap plastic -- It cracks --   in winter.', 'list', 'drop x01', 'restore x01', 'card', 'accept p1 Better glass', 'help', 'off', 'on', 'lst'];
    for (const command of commands) {
      const output = json(run(f, agent, 'prompt', { prompt: 'gf: ' + command }));
      assert.deepEqual(output, io.blockOutput(output.reason)); assert.ok(output.reason.length);
      if (command.startsWith('out ')) assert.equal(store.load(f.top).card.out[0].quote, 'It cracks --   in winter.');
      if (command === 'drop x01') assert.equal(store.load(f.top).card.out.length, 0);
      if (command === 'restore x01') assert.equal(store.load(f.top).card.out[0].id, 'x01');
      if (command === 'list') assert.ok(output.reason.startsWith(store.load(f.top).source));
      if (command === 'card') assert.ok(output.reason.includes('BEFORE YOUR NEXT ACTION:'));
      if (['off', 'on'].includes(command)) assert.equal(home.state().projects[f.top].off, command === 'off');
    }
    assert.equal(store.load(f.top).card.goal.text, 'Light the harbour.');
    assert.equal(store.load(f.top).card.out.at(-1).label, 'Better glass');
    assert.equal(home.state().projects[f.top].off, false);
    assert.match(json(run(f, agent, 'prompt', { prompt: 'gf: lst' })).reason, /unknown command "lst"/);
  });
  test(`T4 ${agent}: only compact sends the exact block and one receipt`, () => {
    const f = fixture(), loaded = save(f), io = ios[agent];
    for (const value of ['startup', 'resume', 'clear', 'fork', null]) assert.equal(run(f, agent, 'session-start', { source: value }).stdout, '');
    for (const trusted of [true, false]) {
      if (!trusted) writeFileSync(loaded.cardPath, source.replace('brass.', 'copper.'));
      const current = store.load(f.top), packed = block(current.card, { trusted, budget: META[agent].budget, kind: 'resend', ...(Number.isFinite(io.contextCap.chars) ? { maxChars: io.contextCap.chars } : {}) });
      const receipt = trusted ? 'goldfished: card re-sent after compaction: 1 goal, 1 rule, 1 ruled out.' : 'goldfished: card re-sent as project documentation, because it is not trusted on this machine. If it is yours, run: goldfished trust';
      assert.deepEqual(json(run(f, agent, 'session-start', { source: 'compact' })), { ...io.contextOutput(packed.text), ...io.screenOutput(receipt) });
    }
  });
  test(`T9 ${agent}: faults cannot block a prompt or leak stdout`, async () => {
    const f = fixture();
    for (const event of ['prompt', 'session-start']) for (const bad of ['{not json', '{"prompt":"gf: help",', '', 'null']) assert.equal(run(f, agent, event, bad).stdout, '');
    mkdirSync(join(f.top, '.goldfished/card.md'), { recursive: true });
    assert.equal(run(f, agent, 'session-start', { source: 'compact' }).stdout, '');
    const broken = fixture(); writeFileSync(join(broken.top, 'home'), 'a file');
    assert.equal(run(broken, agent, 'session-start', { source: 'compact' }).stdout, '');
    const preload = join(scratch, `fault-${agent}.mjs`);
    writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const read = fs.readFileSync; fs.readFileSync = function(path,...args) { if (String(path).endsWith('card.md')) throw Object.assign(new Error('Unreadable card'), {code:'EACCES'}); return read.call(this,path,...args); }; syncBuiltinESMExports();`);
    const unreadable = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, launcher, agent, 'session-start'], { input: JSON.stringify({ _synthetic: true, cwd: f.top, source: 'compact' }), env: f.env, encoding: 'utf8' });
    assert.equal(unreadable.status, 0); assert.equal(unreadable.stdout, '');
    const copy = join(scratch, `missing-${agent}/hooks`); mkdirSync(copy, { recursive: true }); writeFileSync(join(copy, 'run.mjs'), readFileSync(launcher));
    const missing = spawnSync(process.execPath, [join(copy, 'run.mjs'), agent, 'prompt'], { input: '{}', env: f.env, encoding: 'utf8' });
    assert.equal(missing.status, 0); assert.equal(missing.stdout, '');
    let start;
    const child = spawn(process.execPath, ['--import', 'data:text/javascript,process.stderr.write("ready")', launcher, agent, 'prompt'], { env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', () => { start ??= Date.now(); });
    let output = ''; child.stdout.on('data', b => output += b); child.stdin.write('{');
    const timer = setTimeout(() => child.kill(), 3500);
    const code = await new Promise(resolve => child.on('close', resolve)); clearTimeout(timer);
    assert.equal(code, 0); assert.equal(output, ''); assert.ok(Date.now() - start < 3000);
  });
}

test('T5: a 33,000-byte card packs whole through a pipe', () => {
  const f = fixture(), text = '## RULES\n' + Array.from({ length: 22 }, (_, i) => `[r${String(i + 1).padStart(2, '0')} | 2026-10-01] ${'a'.repeat(1500)}\n`).join('');
  assert.ok(Buffer.byteLength(text) > 33000); const loaded = save(f, text);
  for (const agent of Object.keys(ios)) {
    const expected = block(loaded.card, { trusted: true, budget: META[agent].budget, kind: 'resend', maxChars: ios[agent].contextCap.chars });
    const output = run(f, agent, 'session-start', { source: 'compact' });
    assert.deepEqual(json(output), { ...ios[agent].contextOutput(expected.text), ...ios[agent].screenOutput(`goldfished: card re-sent after compaction: 0 goals, 22 rules, 0 ruled out. ${expected.left.length} did not fit (${expected.left.join(' ')}).`) });
    assert.ok(Buffer.byteLength(expected.text) <= META[agent].budget); assert.match(expected.text, /entries not shown here/);
  }
});
test('T12: a 9,500-byte hook response arrives whole through a pipe', () => {
  const f = fixture(), card = parse('## RULES\n' + Array.from({ length: 6 }, (_, i) => `[r0${i + 1} | 2026-10-01] ${'a'.repeat(i === 5 ? 1 : 1500)}\n`).join(''));
  card.rules[0].text = '"'.repeat(200) + 'a'.repeat(1300);
  const output = () => JSON.stringify({ ...claude.contextOutput(block(card, { trusted: true, budget: 9500, kind: 'resend', maxChars: 10000 }).text), ...claude.screenOutput('goldfished: card re-sent after compaction: 0 goals, 6 rules, 0 ruled out.') });
  card.rules[5].text += 'a'.repeat(9500 - Buffer.byteLength(output()));
  store.save(f.top, { ...store.load(f.top), card });
  const result = run(f, 'claude-code', 'session-start', { source: 'compact' });
  assert.equal(Buffer.byteLength(result.stdout), 9500); assert.equal(result.stdout, output());
});
test('T6 and T7: no-card notices and off switches stay in their own project', () => {
  const f = fixture(), other = { ...f, top: join(f.top, 'other') }; mkdirSync(other.top);
  const notice = 'goldfished: that compaction had no card to re-send. Set your goal with: goldfished goal "<text>"';
  assert.deepEqual(json(run(f, 'claude-code', 'session-start', { source: 'compact' })), claude.screenOutput(notice));
  assert.equal(run(f, 'claude-code', 'session-start', { source: 'compact' }).stdout, '');
  assert.deepEqual(json(run(other, 'claude-code', 'session-start', { source: 'compact' })), claude.screenOutput(notice));
  run(f, 'claude-code', 'prompt', { prompt: 'gf: off' });
  assert.deepEqual(json(run(f, 'claude-code', 'session-start', { source: 'compact' })), claude.screenOutput('goldfished: re-sends are off in this project. Turn them on with: gf: on'));
  assert.equal(run(other, 'claude-code', 'session-start', { source: 'compact' }).stdout, '');
});
test('T8: a worktree without a card uses the main checkout', () => {
  const f = fixture(), common = join(f.top, '.git'), wt = join(f.top, 'tree'), admin = join(common, 'worktrees/tree');
  mkdirSync(admin, { recursive: true }); mkdirSync(wt); writeFileSync(join(admin, 'commondir'), '../..\n'); writeFileSync(join(admin, 'gitdir'), join(wt, '.git')); writeFileSync(join(wt, '.git'), `gitdir: ${admin}\n`);
  save(f); const main = run(f, 'claude-code', 'session-start', { source: 'compact' });
  assert.equal(run({ ...f, top: wt }, 'claude-code', 'session-start', { source: 'compact' }).stdout, main.stdout);
  save({ ...f, top: wt }, source.replace('Keep the brass.', 'Keep the copper.'));
  const own = json(run({ ...f, top: wt }, 'claude-code', 'session-start', { source: 'compact' }));
  assert.ok(own.hookSpecificOutput.additionalContext.includes('Keep the copper.'));
});
test('T13: pasted goldfished lines pass through untouched', () => {
  const f = fixture();
  for (const agent of Object.keys(ios)) assert.equal(run(f, agent, 'prompt', { prompt: 'goldfished: this conversation has just been compacted. rule: keep brass.' }).stdout, '');
});
