#!/usr/bin/env node
// Scores a real-compaction session against the frozen rule in RULE.md.
// Usage: node score.mjs <n> [--audit <dir>]   |   node score.mjs --report <n>...   |   node score.mjs --self-test
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, score } from '../../../src/grade.mjs';
import { SAGAS, readSummaries } from '../score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GFREAL_ROOT ?? 'D:/Dev/gf-scratch/B19r';
const CFG = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const { atoms } = SAGAS['saga-02'];
const FIRST = 10;
const MARK = { kept: 'K', reworded: 'R', gone: 'G' };

export const live = (a, t) => a.turn < t && (a.supersededAt == null || a.supersededAt > t);

const decide = (rows) => atoms.flatMap((a) => {
  for (let i = 0; i + 1 < rows.length; i++) {
    const x = rows[i].m[a.id], y = rows[i + 1].m[a.id];
    if (x && y && x.label !== 'kept' && y.label !== 'kept') return [{ atom: a.id, k: [rows[i].k, rows[i + 1].k] }];
  }
  return [];
});

export function evaluate(summaries, anchors, tk, turns = 60) {
  const pairs = atoms.filter((a) => a.supersededAt != null).map((a) => ({ old: a.id, by: atoms.find((b) => b.turn === a.supersededAt).id, at: a.supersededAt }));
  const grid = [], stale = [], byAge = {}, first = {};
  summaries.forEach((text, i) => {
    const k = i + 1, t = tk[i], idx = prepare(text);
    const all = Object.fromEntries(atoms.map((a) => [a.id, score(a.text, idx)]));
    const liveNow = atoms.filter((a) => live(a, t));
    const an = anchors.find((x) => x.k === k);
    const ai = an && prepare(an.text);
    const row = { k, t, size: text.length, floor: Object.fromEntries(liveNow.map((a) => [a.id, all[a.id]])) };
    if (an) Object.assign(row, { anchor: Object.fromEntries(liveNow.map((a) => [a.id, score(a.text, ai)])), anchorTools: an.tools });
    const flags = pairs.filter((p) => t > p.at && all[p.old].label === 'kept' && all[p.by].label !== 'kept').map((p) => p.old);
    if (flags.length) { row.staleCarried = flags; stale.push({ k, atoms: flags }); }
    grid.push(row);
    for (const a of liveNow) {
      first[a.id] ??= k;
      const r = (byAge[k - first[a.id] + 1] ??= { kept: 0, reworded: 0, gone: 0 });
      r[all[a.id].label] += 1;
    }
  });
  const win = grid.filter((g) => g.k >= FIRST);
  const decided = decide(win.map((g) => ({ k: g.k, m: g.anchor ?? g.floor })));
  const floorOnly = decide(win.map((g) => ({ k: g.k, m: g.floor })));
  const anchorOnly = decide(win.filter((g) => g.anchor).map((g) => ({ k: g.k, m: g.anchor })));
  const complete = turns >= 60;
  return { complete, loses: decided.length > 0, decided, floorOnly, anchorOnly, stale, byAge, grid };
}

const sessionFile = (id) => {
  const base = join(CFG, 'projects');
  for (const d of readdirSync(base)) if (existsSync(join(base, d, `${id}.jsonl`))) return join(base, d, `${id}.jsonl`);
  throw new Error(`no session file for ${id}`);
};

function runSession(n, audit) {
  const st = JSON.parse(readFileSync(join(ROOT, `state-${n}.json`), 'utf8'));
  const summaries = readSummaries(sessionFile(st.id));
  const tk = st.calls.flatMap((c) => c.compactions.map(() => c.turn));
  if (tk.length !== summaries.length) console.error(`warning: ${tk.length} boundaries in the state, ${summaries.length} summaries in the file`);
  const m = Math.min(tk.length, summaries.length);
  const r = evaluate(summaries.slice(0, m), st.anchors, tk.slice(0, m), st.turn);
  const sum = (key) => st.calls.reduce((t, c) => t + (c.usage[key] ?? 0), 0);
  const use = { claudeRuns: st.calls.length + st.anchors.length, requests: st.calls.reduce((t, c) => t + c.api.length, 0), input: sum('input_tokens'), cacheWritten: sum('cache_creation_input_tokens'), cacheRead: sum('cache_read_input_tokens'), output: sum('output_tokens'), minutes: Math.round(st.calls.reduce((t, c) => t + c.ms, 0) / 600) / 100 };
  const out = { _synthetic: true, session: Number(n), version: st.version, setting: { window: st.window, pct: st.pct }, turns: st.turn, stopped: st.stopped, compactions: m, turnOfCompaction: tk, weekly: { first: st.weekly[0], last: st.weekly.at(-1), all: st.weekly }, fiveHour: { first: st.fiveHour[0], last: st.fiveHour.at(-1) }, use, anchorTools: st.anchors.map((a) => ({ k: a.k, tools: a.tools })), ...r };
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', `session-${n}.json`), JSON.stringify(out, null, 1) + '\n');
  if (audit) {
    mkdirSync(join(audit, `session-${n}`), { recursive: true });
    summaries.forEach((t, i) => writeFileSync(join(audit, `session-${n}`, `k${i + 1}.txt`), t));
    st.anchors.forEach((a) => writeFileSync(join(audit, `session-${n}`, `anchor-k${a.k}.txt`), a.text));
  }
  console.log(`session ${n}: ${r.loses ? 'LOSES' : r.complete ? 'holds' : 'partial'} ${JSON.stringify(r.decided)} floor ${JSON.stringify(r.floorOnly)} anchors ${JSON.stringify(r.anchorOnly)} stale ${JSON.stringify(r.stale)}`);
}

const row = (c) => `| ${c.join(' | ')} |`;
const table = (g, key) => [row(['k', 'turn', ...atoms.map((a) => a.id), 'size']), row(Array(atoms.length + 3).fill('---')),
  ...g.filter((x) => x[key]).map((x) => row([x.k, x.t, ...atoms.map((a) => (x[key][a.id] ? MARK[x[key][a.id].label] : '')), x.size]))].join('\n');

function report(ns) {
  const rs = ns.map((n) => JSON.parse(readFileSync(join(here, 'results', `session-${n}.json`), 'utf8')));
  rs.forEach((r) => console.log(`## Session ${r.session}\n\nFloor, by the summary after each compaction.\n\n${table(r.grid, 'floor')}\n\nAnchor, by the forked answer.\n\n${table(r.grid, 'anchor')}\n`));
  const age = {};
  for (const r of rs) for (const [a, v] of Object.entries(r.byAge)) for (const l of Object.keys(v)) ((age[a] ??= { kept: 0, reworded: 0, gone: 0 })[l] += v[l]);
  console.log(['## By age', '', row(['age', 'readings', 'kept', 'reworded', 'gone']), row(Array(5).fill('---')),
    ...Object.keys(age).map(Number).sort((a, b) => a - b).map((a) => row([a, age[a].kept + age[a].reworded + age[a].gone, age[a].kept, age[a].reworded, age[a].gone]))].join('\n'));
}

function selfTest() {
  const tk = Array.from({ length: 15 }, (_, i) => 4 * (i + 1));
  const build = (drop = {}) => tk.map((t, i) => `Notes. ${atoms.filter((a) => live(a, t) && !drop[a.id]?.includes(i + 1)).map((a) => a.text).join('. ')}.`);
  const anchor = (k, ids) => ({ k, tools: [], text: atoms.filter((a) => ids.includes(a.id)).map((a) => a.text).join('. ') });
  assert.equal(evaluate(build({ r1: [11, 12] }), [], tk).loses, true);
  assert.equal(evaluate(build({ r1: [11, 13] }), [], tk).loses, false);
  const rescued = evaluate(build({ r1: [12, 13] }), [anchor(12, ['r1'])], tk);
  assert.equal(rescued.loses, false);
  assert.equal(rescued.floorOnly.length, 1);
  const sunk = evaluate(build({ r1: [13] }), [anchor(12, [])], tk);
  assert.deepEqual(sunk.decided, [{ atom: 'r1', k: [12, 13] }]);
  assert.equal(sunk.floorOnly.length, 0);
  assert.equal(evaluate(build({ r1: [8, 9] }), [], tk).loses, false);
  assert.equal(evaluate(build(), [], tk, 40).complete, false);
  console.log('self-test: pass');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a[0] === '--self-test') selfTest();
  else if (a[0] === '--report') report(a.slice(1));
  else if (a[0]) runSession(a[0], a[1] === '--audit' ? a[2] : undefined);
  else { console.error('usage: score.mjs <n> [--audit <dir>] | --report <n>... | --self-test'); process.exit(2); }
}
