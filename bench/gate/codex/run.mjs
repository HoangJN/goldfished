#!/usr/bin/env node
// Drives one natural-compaction session of saga-02 through codex exec, in a scratch home.
// Usage: node run.mjs <n> [lastTurn]. Resumes from the state file. Exit 3 is the plan limit, 4 a call that failed twice.
// Needs GFGATE_MODEL and GFGATE_LIMIT (the compaction limit, in tokens). Session 0 is a trial and writes no results.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, score } from '../../../src/grade.mjs';
import { renderStory } from '../../../scripts/saga-pastes.mjs';
import { forkAsk } from './appserver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GFGATE_ROOT ?? 'D:/Dev/gf-scratch/B19x';
const AUDIT = process.env.GFGATE_AUDIT ?? 'D:/Dev/gf-scratch/B19x-audit';
const { GFGATE_MODEL: MODEL, GFGATE_LIMIT: LIMIT } = process.env;
if (!MODEL || !LIMIT) throw new Error('Set GFGATE_MODEL and GFGATE_LIMIT.');
const WEEKLY_STOP = Number(process.env.GFGATE_WEEKLY_STOP ?? 90);
const QUESTION = "List every goal, rule and ruled-out option the user has given you, in the user's own words.";
const WORK = `${ROOT}/work`;
const n = process.argv[2] ?? '1';
const last = Number(process.argv[3] ?? 60);
const STATE = `${ROOT}/state-${n}.json`;
const [, ...story] = renderStory(join(here, '../../../test/long/saga-02.story.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
const atoms = story.filter((t) => t.atom).map((t) => ({ ...t.atom, turn: t.turn }));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { id: null, turn: 0, grid: [], anchors: {}, calls: [], models: [], version: null, rate: null };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const say = (m) => console.log(`${new Date().toISOString()} s${n} ${m}`);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const bin = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
const found = existsSync(bin) ? readdirSync(bin).map((d) => join(bin, d, 'codex.exe')).filter(existsSync) : [];
const CODEX = found.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0] ?? 'codex';
const env = { ...process.env, CODEX_HOME: `${ROOT}/codex-home` };
const LIMITED = /usage limit|rate limit|quota|limit reached|try again at/i;
class Quota extends Error {}

function call(prompt) {
  for (let tries = 0; ; tries++) {
    const args = ['exec', ...(state.id ? ['resume', state.id] : []), '--skip-git-repo-check', '--json', '-c', 'sandbox_mode="read-only"', '-m', MODEL, '-c', `model_auto_compact_token_limit=${LIMIT}`, '-'];
    const r = spawnSync(CODEX, args, { cwd: WORK, env, input: prompt, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60 * 1000 });
    const events = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    state.id ??= events.find((e) => e.type === 'thread.started')?.thread_id;
    const done = events.find((e) => e.type === 'turn.completed');
    if (done) return done.usage ?? {};
    const why = `${r.stderr ?? ''} ${events.filter((e) => /error|failed/.test(e.type)).map((e) => JSON.stringify(e)).join(' ')}`;
    if (LIMITED.test(why)) throw new Quota(why.slice(0, 200));
    if (tries) throw new Error(`call failed twice: ${why.slice(0, 200)}`);
    say(`call failed (${r.status}), waiting a minute: ${why.slice(0, 120)}`);
    sleep(60000);
  }
}

function lines() {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const file = walk(`${ROOT}/codex-home/sessions`).find((f) => f.endsWith('.jsonl') && f.includes(state.id));
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

const readable = (p) => p.replacement_history.filter((h) => h.type === 'message' && ['user', 'assistant'].includes(h.role)).map((h) => h.content.map((c) => c.text ?? '').join('\n')).join('\n\n');
const live = (a, T) => a.turn < T && (a.supersededAt == null || a.supersededAt >= T);
const put = (name, text) => { mkdirSync(`${AUDIT}/session-${n}`, { recursive: true }); writeFileSync(`${AUDIT}/session-${n}/${name}.txt`, text); };
const typed = (rows, type) => rows.filter((l) => l.includes(`"type":"${type}"`)).map((l) => JSON.parse(l)).filter((r) => r.type === type);

function afterTurn(rows) {
  const comps = typed(rows, 'compacted');
  for (let i = state.grid.length; i < comps.length; i++) {
    const text = readable(comps[i].payload), index = prepare(text), T = state.turn;
    put(`k${i + 1}`, text);
    state.grid.push({ k: i + 1, turn: T, chars: text.length, atoms: Object.fromEntries(atoms.filter((a) => a.turn < T).map((a) => [a.id, { live: live(a, T), floor: score(a.text, index).label }])) });
  }
  state.models = [...new Set(typed(rows, 'turn_context').map((r) => r.payload.model))];
  const rate = rows.findLast((l) => l.includes('"rate_limits"'));
  state.rate = rate ? JSON.parse(rate).payload.rate_limits : state.rate;
}

async function anchor(target) {
  const row = state.grid.at(-1);
  for (let tries = 0; ; tries++) {
    try {
      const r = await forkAsk(CODEX, env, WORK, MODEL, state.id, QUESTION, { model_auto_compact_token_limit: 100000000 });
      if (r.status !== 'completed' || !r.text) throw new Error(`fork ended ${r.status}`);
      put(`anchor-k${row.k}`, r.text);
      const index = prepare(r.text);
      for (const a of atoms.filter((x) => x.turn < row.turn)) row.atoms[a.id].anchor = score(a.text, index).label;
      state.anchors[target] = row.k;
      return;
    } catch (e) {
      if (LIMITED.test(e.message)) throw new Quota(e.message);
      if (tries) throw e;
      say(`anchor failed, waiting a minute: ${e.message.slice(0, 120)}`);
      sleep(60000);
    }
  }
}

function results(complete) {
  if (n === '0') return;
  const { grid, anchors, version, calls } = state;
  const body = { _synthetic: true, session: Number(n), codexVersion: version, limit: Number(LIMIT), complete, turns: state.turn, calls: calls.length, anchors, compactions: grid.map(({ k, turn, atoms: a }) => ({ k, turn, atoms: a })) };
  writeFileSync(join(here, 'results', `session-${n}.json`), JSON.stringify(body, null, 1));
}

mkdirSync(WORK, { recursive: true });
state.version ??= spawnSync(CODEX, ['--version'], { env, encoding: 'utf8' }).stdout.trim();
try {
  for (let t = state.turn + 1; t <= last; t++) {
    const u = call(story[t - 1].text);
    state.turn = t;
    state.calls.push({ turn: t, input: u.input_tokens ?? 0, cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0 });
    afterTurn(lines());
    for (const target of [10, 15, 20]) if (state.grid.length >= target && !state.anchors[target]) await anchor(target);
    save();
    results(t === last);
    say(`turn ${t} done, k ${state.grid.length}, input ${u.input_tokens}, plan ${state.rate?.primary?.used_percent}% of 5h, ${state.rate?.secondary?.used_percent}% of week`);
    if ((state.rate?.secondary?.used_percent ?? 0) >= WEEKLY_STOP) throw new Quota(`weekly use at ${state.rate.secondary.used_percent}%`);
  }
  state.stopped = null;
  save();
  say('session complete');
} catch (e) {
  state.stopped = e.message.slice(0, 200);
  save();
  results(false);
  say(`stopped: ${state.stopped}`);
  process.exit(e instanceof Quota ? 3 : 4);
}
