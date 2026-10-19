#!/usr/bin/env node
// Drives saga-02 through claude -p as a working session: tools on, compaction left to Claude Code, sized by two environment variables.
// Usage: node run.mjs <n> [--turns 60] [--window W] [--pct P] [--anchor-every 3] [--fresh]   n = 0 is the pilot.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStory } from '../../../scripts/saga-pastes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : d; };
const fresh = args.includes('--fresh') && !!args.splice(args.indexOf('--fresh'), 1);
const ROOT = process.env.GFREAL_ROOT ?? 'D:/Dev/gf-scratch/B19r';
const WORK = `${ROOT}/work`;
const MODEL = 'sonnet'; // gate-allow
const TURNS = Number(opt('--turns', 60));
const WINDOW = opt('--window', '60000');
const PCT = opt('--pct', '100');
const EVERY = Number(opt('--anchor-every', 3));
const n = args[0] ?? '0';
const STATE = `${ROOT}/state-${n}.json`;
const TOOLS = 'Read,Write,Edit,Glob,Grep';
const ASK = "List every goal, rule and ruled-out option the user has given you, in the user's own words.";
const story = renderStory(join(here, '../../../test/long/saga-02.story.jsonl')).trim().split('\n').slice(1).map((l) => JSON.parse(l));
const state = existsSync(STATE) && !fresh ? JSON.parse(readFileSync(STATE, 'utf8')) : { id: null, turn: 0, k: 0, window: WINDOW, pct: PCT, calls: [], anchors: [], version: null, stopped: null };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const say = (m) => console.log(`${new Date().toISOString()} s${n} ${m}`);

class Quota extends Error {}

const sessionFile = (id) => {
  const base = join(homedir(), '.claude', 'projects');
  for (const d of existsSync(base) ? readdirSync(base) : []) if (existsSync(join(base, d, `${id}.jsonl`))) return join(base, d, `${id}.jsonl`);
  return null;
};

export const compactions = (id) => {
  const f = id && sessionFile(id);
  if (!f) return [];
  return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r.type === 'system' && r.subtype === 'compact_boundary' ? [{ trigger: r.compactMetadata?.trigger, pre: r.compactMetadata?.preTokens, post: r.compactMetadata?.postTokens }] : []; } catch { return []; } });
};

function call(label, prompt, fork) {
  const flags = ['-p', '--model', MODEL, '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--tools', TOOLS, '--allowedTools', ...TOOLS.split(','), '--permission-mode', 'acceptEdits', '--strict-mcp-config', ...(state.id ? ['--resume', state.id] : []), ...(fork ? ['--fork-session'] : []), ...(n === '0' ? ['--debug-file', `${ROOT}/debug-${label.replace(/\W+/g, '-')}.txt`] : [])];
  const env = { ...process.env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: state.window, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: state.pct };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  const t0 = Date.now();
  const r = spawnSync('claude', flags, { cwd: WORK, env, input: prompt, encoding: 'utf8', maxBuffer: 1 << 29, timeout: 40 * 60 * 1000 });
  const ev = (r.stdout ?? '').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const res = ev.find((e) => e.type === 'result');
  const text = `${res?.result ?? ''} ${r.stderr ?? ''}`;
  if (/usage limit|rate limit|limit reached|quota/i.test(text) && (res?.is_error || r.status)) throw new Quota(text.slice(0, 200));
  if (!res || res.is_error || r.status) throw new Error(`${label}: status ${r.status} ${text.slice(0, 200)}`);
  const seen = new Map();
  for (const e of ev) if (e.type === 'assistant' && e.message?.id) seen.set(e.message.id, e.message);
  const api = [...seen.values()].map((m) => ({ input: m.usage?.input_tokens ?? 0, cacheCreate: m.usage?.cache_creation_input_tokens ?? 0, cacheRead: m.usage?.cache_read_input_tokens ?? 0, output: m.usage?.output_tokens ?? 0 }));
  const tools = ev.flatMap((e) => (e.type === 'assistant' ? e.message.content.filter((b) => b.type === 'tool_use').map((b) => b.name) : []));
  const rate = ev.filter((e) => e.type === 'rate_limit_event').map((e) => e.rate_limit_info ?? e);
  const id = res.session_id;
  if (!fork) state.id ??= id;
  return { label, ms: Date.now() - t0, id, api, tools, rate, usd: res.total_cost_usd ?? 0, usage: res.usage ?? {}, text: res.result ?? '' };
}

function once(label, act) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return act(); } catch (e) { if (e instanceof Quota) throw e; say(`${label} failed (${attempt}): ${e.message}`); }
  }
  throw new Error(`${label}: failed twice`);
}

function main() {
  if (state.turn === 0) {
    rmSync(WORK, { recursive: true, force: true });
    const skeleton = JSON.parse(readFileSync(join(here, 'skeleton.json'), 'utf8')).files;
    for (const [p, body] of Object.entries(skeleton)) { mkdirSync(dirname(join(WORK, p)), { recursive: true }); writeFileSync(join(WORK, p), body); }
  }
  state.version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  for (let t = state.turn + 1; t <= TURNS; t++) {
    const before = compactions(state.id).length;
    const c = once(`turn ${t}`, () => call(`turn ${t}`, story[t - 1].text));
    const all = compactions(state.id);
    state.calls.push({ turn: t, ms: c.ms, api: c.api, tools: c.tools, rate: c.rate.slice(-1), usd: c.usd, usage: c.usage, compactions: all.slice(before) });
    state.turn = t;
    state.k = all.length;
    if (all.length > before && state.k % EVERY === 0) {
      const a = once(`anchor ${state.k}`, () => call(`anchor ${state.k}`, ASK, true));
      state.anchors.push({ k: state.k, ms: a.ms, api: a.api, tools: a.tools, usd: a.usd, usage: a.usage, fork: a.id, text: a.text });
      say(`anchor k=${state.k} ${a.api.length} api calls, ${a.tools.length} tool uses`);
    }
    save();
    say(`turn ${t} k=${state.k} api=${c.api.length} tools=${c.tools.length} ${Math.round(c.ms / 1000)}s ${JSON.stringify(all.slice(before))}`);
  }
  state.stopped = 'finished';
  save();
}

try { main(); } catch (e) {
  state.stopped = e instanceof Quota ? 'quota' : 'error';
  save();
  say(`${state.stopped}: ${e.message} at turn ${state.turn} k ${state.k}`);
  process.exit(e instanceof Quota ? 3 : 1);
}
