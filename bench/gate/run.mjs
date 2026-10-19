#!/usr/bin/env node
// Drives one forced-compaction session of the saga through claude -p, in a scratch folder, tools off.
// Usage: node run.mjs <n>   Resumes from the state file if stopped. Exit 3 means the plan limit.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GFGATE_ROOT ?? 'D:/Dev/gf-scratch/B19';
const WORK = `${ROOT}/work`;
const LAST_TURN = 50;
const MODEL = 'sonnet'; // gate-allow
const n = process.argv[2] ?? '1';
const STATE = `${ROOT}/state-${n}.json`;
const story = readFileSync(join(here, '../../test/long/saga-01.story.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { id: null, turn: 0, k: 0, calls: [], models: [], version: null, stopped: null };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const say = (m) => console.log(`${new Date().toISOString()} s${n} ${m}`);

class Quota extends Error {}

function fileOf(id) {
  const base = join(homedir(), '.claude', 'projects');
  for (const d of existsSync(base) ? readdirSync(base) : []) if (existsSync(join(base, d, `${id}.jsonl`))) return join(base, d, `${id}.jsonl`);
  return null;
}

function records() {
  const f = state.id && fileOf(state.id);
  if (!f) return [];
  return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function facts() {
  const rs = records();
  const human = rs.filter((r) => r.type === 'user' && !r.isCompactSummary && !r.isMeta && !r.toolUseResult && typeof r.message?.content === 'string' && !r.message.content.startsWith('<'));
  const blocks = rs.flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []));
  return {
    human: human.length,
    boundaries: rs.filter((r) => r.type === 'system' && r.subtype === 'compact_boundary').length,
    summaries: rs.filter((r) => r.isCompactSummary === true).length,
    toolUse: blocks.some((b) => b?.type === 'tool_use'),
    models: [...new Set(rs.filter((r) => r.type === 'assistant' && r.message?.model).map((r) => r.message.model))],
  };
}

function call(label, prompt) {
  const args = ['-p', '--model', MODEL, '--setting-sources', 'project', '--output-format', 'json', '--tools', '', '--strict-mcp-config', ...(state.id ? ['--resume', state.id] : [])];
  const r = spawnSync('claude', args, { cwd: WORK, input: prompt, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60 * 1000 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  const text = `${out?.result ?? ''} ${r.stderr ?? ''}`;
  if (/usage limit|rate limit|limit reached|quota/i.test(text) && (out?.is_error || r.status)) throw new Quota(text.slice(0, 200));
  if (!out || out.is_error || r.status) throw new Error(`${label}: status ${r.status} ${text.slice(0, 200)}`);
  state.id ??= out.session_id;
  const u = out.usage ?? {};
  state.calls.push({ label, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, usd: out.total_cost_usd ?? 0 });
  save();
}

function totals() {
  const t = { calls: state.calls.length, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, usd: 0 };
  for (const c of state.calls) for (const key of ['input', 'output', 'cacheCreate', 'cacheRead', 'usd']) t[key] += c[key];
  t.usd = Math.round(t.usd * 1000) / 1000;
  return t;
}

function once(label, done, act) {
  if (done()) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { act(); } catch (e) { if (e instanceof Quota) throw e; say(`${label} failed (${attempt}): ${e.message}`); }
    if (done()) return;
    if (attempt === 2) throw new Error(`${label}: failed twice`);
  }
}

function main() {
  mkdirSync(WORK, { recursive: true });
  const start = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  state.version = start.stdout.trim();
  for (let t = state.turn + 1; t <= LAST_TURN; t++) {
    once(`turn ${t}`, () => facts().human >= t, () => call(`turn ${t}`, story[t - 1].text));
    state.turn = t;
    if (t % 2 === 0) {
      const k = t / 2;
      once(`compact ${k}`, () => { const f = facts(); return f.boundaries >= k && f.summaries >= k; }, () => call(`compact ${k}`, '/compact'));
      state.k = k;
      const f = facts();
      if (f.toolUse) throw new Error('tool use found in the session file');
      state.models = f.models;
      save();
      say(`k=${k} done ${JSON.stringify(totals())}`);
    }
  }
  state.stopped = 'finished';
  save();
  say(`finished ${JSON.stringify(totals())} models ${state.models.join(',')}`);
}

try { main(); } catch (e) {
  state.stopped = e instanceof Quota ? 'quota' : 'error';
  save();
  say(`${state.stopped}: ${e.message} at turn ${state.turn} k ${state.k}`);
  process.exit(e instanceof Quota ? 3 : 1);
}
