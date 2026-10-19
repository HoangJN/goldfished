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
  const childEnv = { ...(env ?? process.env) }; delete childEnv.NODE_TEST_CONTEXT;
  const got = spawnSync(process.execPath, args, { cwd, env: childEnv, input, timeout, encoding: 'utf8', maxBuffer: 2 ** 24 });
  assert.ifError(got.error);
  return got;
}
function mulberry32(seed) {
  return () => { let t = seed += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function generate(agent, seed, folder, { canary = '', cwd = '/srv/invented/orchard', sessions } = {}) {
  const rng = mulberry32(seed), count = n => 1 + Math.floor(rng() * n), total = new Map();
  const expected = { sessions: sessions ?? count(10) + 2, messages: 0, not_counted: { short: 0, pasted: 0 } };
  for (let copy = 0; copy < expected.sessions; copy++) {
    const compactions = count(8), id = `s${seed}c${copy}`, typed = [], ages = new Map();
    const rows = [{ _synthetic: true, note: 'Invented turns, retained history and opaque compactions.' }];
    const stamp = () => new Date(Date.UTC(2026, 0, seed, copy, 0, rows.length)).toISOString();
    const user = (text, summary = false) => ({ type: 'user', uuid: `${id}-${rows.length}`, sessionId: id,
      timestamp: stamp(), cwd, version: '2.1.292', ...(summary ? { isCompactSummary: true } : { turnOrigin: 'human' }), message: { role: 'user', content: text } });
    if (agent === 'codex') rows.push({ type: 'session_meta', timestamp: stamp(),
      payload: { id, cwd, source: 'cli', originator: 'codex_cli_rs', cli_version: '0.163.0' } });
    for (let epoch = 0; epoch <= compactions; epoch++) {
      for (let n = count(7); n > 0; n--) {
        const kind = count(5), tag = `${id}t${typed.length}`;
        const text = canary ? `${canary} ${tag}amber ${tag}birch ${tag}cedar ${tag}dahlia ${tag}elm` :
          kind === 1 ? `${tag} ok` : kind === 2 ? `${tag} ` + 'p'.repeat(1501) :
            ['amber', 'birch', 'cedar', 'dahlia', 'elm'].map(w => tag + w).join(' ');
        const rejected = !canary && kind <= 2;
        if (rejected) expected.not_counted[kind === 1 ? 'short' : 'pasted']++;
        const record = agent === 'claude-code' ? user(text) : { timestamp: stamp(), type: 'event_msg', payload: { type: 'user_message', message: text } };
        typed.push({ text, epoch, rejected, record }); rows.push(record); expected.messages++;
      }
      if (epoch === compactions) break;
      const opaque = agent === 'codex' && !canary && rng() < 0.25, eligible = typed.filter(m => !m.rejected);
      const kept = canary || opaque ? [] : agent === 'claude-code' ? eligible.filter(() => rng() < 0.5) :
        eligible.map(m => [rng(), m]).sort((a, b) => a[0] - b[0]).slice(0, count(2)).map(([, m]) => m);
      const tail = agent === 'claude-code' ? kept.filter(() => rng() < 0.5) : [];
      if (!opaque) for (const message of eligible) {
        const age = epoch + 1 - message.epoch;
        const row = ages.get(age) ?? { age, messages: 0, sessions: 1, kept: 0, reworded: 0, gone: 0 };
        row.messages++; row[kept.includes(message) ? 'kept' : 'gone']++; ages.set(age, row);
      }
      if (agent === 'claude-code') {
        rows.push({ type: 'system', subtype: 'compact_boundary', uuid: `${id}-b${epoch}`, timestamp: stamp(),
          compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 21000 } });
        rows.push(user(['Quiet water beneath distant hills.', ...kept.filter(m => !tail.includes(m)).map(m => m.text)].join('\n'), true));
        for (const message of tail) rows.push({ ...message.record, timestamp: stamp() });
      } else rows.push({ timestamp: stamp(), type: 'compacted', payload: { message: opaque ? '' : 'Quiet water beneath distant hills.',
        replacement_history: opaque ? [{ type: 'compaction', encrypted_content: 'invented-opaque-history' }] :
          kept.map(m => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.text }] })) } });
    }
    for (const [age, counts] of ages) {
      const row = total.get(age) ?? { age, messages: 0, sessions: 0, kept: 0, reworded: 0, gone: 0 };
      for (const key of ['messages', 'sessions', 'kept', 'gone']) row[key] += counts[key]; total.set(age, row);
    }
    const name = `oracle${copy ? '-' + copy : ''}.jsonl`, file = join(folder, agent === 'codex' ? `2026/01/01/rollout-${name}` : `orchard/${name}`);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  expected.curve = Array.from({ length: Math.min(6, Math.max(0, ...total.keys())) }, (_, i) => total.get(i + 1) ??
    { age: i + 1, messages: 0, sessions: 0, kept: 0, reworded: 0, gone: 0 });
  return expected;
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
