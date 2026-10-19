import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function isolated(base) {
  const env = { ...process.env, HOME: join(base, 'home'), USERPROFILE: join(base, 'home'),
    CLAUDE_CONFIG_DIR: join(base, 'claude'), CODEX_HOME: join(base, 'codex'), GOLDFISHED_HOME: join(base, 'goldfished') };
  for (const key of ['HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GOLDFISHED_HOME']) mkdirSync(env[key], { recursive: true });
  return env;
}
export function run(args, { cwd = root, env, input, timeout = 120000 } = {}) {
  const got = spawnSync(process.execPath, args, { cwd, env, input, timeout, encoding: 'utf8', maxBuffer: 2 ** 24 });
  assert.ifError(got.error);
  return got;
}
function mulberry32(seed) {
  return () => { let t = seed += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function generate(agent, seed, folder, { canary = '', cwd = '/srv/invented/orchard' } = {}) {
  const rng = mulberry32(seed), count = n => 1 + Math.floor(rng() * n), compactions = count(8);
  const rows = [{ _synthetic: true, note: 'Invented turns with independent counted fates.' }], typed = [], curve = [];
  const notCounted = { short: 0, pasted: 0 };
  const stamp = () => new Date(Date.UTC(2026, 0, seed, 0, 0, rows.length)).toISOString();
  const user = (text, summary = false) => ({ type: 'user', uuid: `${seed}-${rows.length}`, sessionId: `s${seed}`,
    timestamp: stamp(), cwd, version: '2.1.292',
    ...(summary ? { isCompactSummary: true } : { turnOrigin: 'human' }), message: { role: 'user', content: text } });
  if (agent === 'codex') rows.push({ type: 'session_meta', timestamp: stamp(),
    payload: { id: `s${seed}`, cwd, source: 'cli', originator: 'codex_cli_rs', cli_version: '0.163.0' } });
  for (let epoch = 0; epoch <= compactions; epoch++) {
    for (let n = count(7); n > 0; n--) {
      const id = typed.length, kind = count(5), tag = `s${seed}t${id}`;
      const text = canary ? `${canary} ${tag}amber ${tag}birch ${tag}cedar ${tag}dahlia ${tag}elm` :
        kind === 1 ? `${tag} ok` : kind === 2 ? `${tag} ` + 'p'.repeat(1501) :
          ['amber', 'birch', 'cedar', 'dahlia', 'elm'].map(w => tag + w).join(' ');
      const rejected = !canary && kind <= 2;
      if (rejected) notCounted[kind === 1 ? 'short' : 'pasted']++;
      typed.push({ text, epoch, rejected });
      rows.push(agent === 'claude-code' ? user(text) :
        { timestamp: stamp(), type: 'event_msg', payload: { type: 'user_message', message: text } });
    }
    if (epoch === compactions) break;
    const visible = ['Quiet water beneath distant hills.'];
    for (const message of typed) {
      if (message.rejected) continue;
      const age = epoch + 1 - message.epoch, kept = !canary && rng() < 0.5;
      const row = curve[age - 1] ??= { age, messages: 0, sessions: 1, kept: 0, reworded: 0, gone: 0 };
      row.messages++; row[kept ? 'kept' : 'gone']++;
      if (kept) visible.push(message.text);
    }
    if (agent === 'claude-code') {
      rows.push({ type: 'system', subtype: 'compact_boundary', uuid: `${seed}-b${epoch}`, timestamp: stamp(),
        compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 21000 } });
      rows.push(user(visible.join('\n'), true));
    } else rows.push({ timestamp: stamp(), type: 'compacted', payload: { message: visible.join('\n'), replacement_history: [] } });
  }
  const file = join(folder, agent === 'codex' ? '2026/01/01/rollout-oracle.jsonl' : 'orchard/oracle.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return { sessions: 1, messages: typed.length, not_counted: notCounted, curve: curve.slice(0, 6) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = mkdtempSync(join(tmpdir(), 'gf-oracle-'));
  try {
    const env = isolated(base);
    for (const agent of ['claude-code', 'codex']) for (let seed = 1; seed <= 20; seed++) {
      const folder = join(base, agent, String(seed)), expected = generate(agent, seed, folder);
      const got = run([join(root, 'bin/goldfished.mjs'), 'retro', '--json', '--agent', agent, '--dir', folder, '--days', '0'], { env });
      assert.equal(got.status, 0, got.stderr);
      const actual = JSON.parse(got.stdout).agents.find(a => a.id === agent);
      for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], `${agent} seed ${seed} ${key}`);
      console.log(`oracle ${agent} ${seed} of 20`);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
}
