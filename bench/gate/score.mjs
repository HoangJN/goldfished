#!/usr/bin/env node
// Scores one Claude Code session file against the frozen atoms, by the rule in RULE.md.
// Usage: node score.mjs <session.jsonl> <n> [--story saga-02] [--audit <dir>]   |   node score.mjs --self-test
//        node score.mjs --report <n> [--story saga-02]   prints the markdown tables from a saved result.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, score } from '../../src/grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const storyAtoms = (name) => readFileSync(join(here, `../../test/long/${name}.story.jsonl`), 'utf8').split('\n').filter(Boolean)
  .slice(1).map((l) => JSON.parse(l)).filter((t) => t.atom).map((t) => ({ ...t.atom, turn: t.turn }));

export const SAGAS = {
  'saga-01': { name: 'saga-01', atoms: JSON.parse(readFileSync(join(here, 'atoms.json'), 'utf8')).atoms, first: 10, last: 20, alt: null, out: join(here, 'results') },
  'saga-02': { name: 'saga-02', atoms: storyAtoms('saga-02'), first: 10, last: 30, alt: [10, 20], out: join(here, 'saga-02', 'results') },
};
export const ATOMS = SAGAS['saga-01'].atoms;

const bodyOf = (r) => {
  const c = r.message?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
};

export function readSummaries(file) {
  const out = [];
  let waiting = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type === 'system' && r.subtype === 'compact_boundary') waiting = true;
    else if (waiting && r.type === 'user' && r.isCompactSummary === true) { out.push(bodyOf(r)); waiting = false; }
  }
  return out;
}

export const isLive = (a, k) => a.turn <= 2 * k && (a.supersededAt == null || a.supersededAt > 2 * k);

const decide = (grid, ids, first, last) => {
  const decided = [];
  for (const id of ids) {
    for (let k = first; k < last; k++) {
      const row = (j) => grid[j - 1]?.live[id];
      if (row(k) && row(k + 1) && row(k).label !== 'kept' && row(k + 1).label !== 'kept') { decided.push({ atom: id, k: [k, k + 1] }); break; }
    }
  }
  return decided;
};

export function evaluate(texts, cfg = SAGAS['saga-01']) {
  const { atoms } = cfg;
  const pairs = atoms.filter((a) => a.supersededAt != null)
    .map((a) => ({ old: a.id, by: atoms.find((b) => b.turn === a.supersededAt).id, from: Math.ceil(a.supersededAt / 2) }));
  const grid = [], stale = [], byAge = {};
  texts.forEach((text, i) => {
    const k = i + 1, index = prepare(text);
    const all = Object.fromEntries(atoms.map((a) => [a.id, score(a.text, index)]));
    const live = Object.fromEntries(atoms.filter((a) => isLive(a, k)).map((a) => [a.id, all[a.id]]));
    const kept = (id) => all[id].label === 'kept';
    const flags = pairs.filter((p) => k >= p.from && kept(p.old) && !kept(p.by)).map((p) => p.old);
    const extra = Object.fromEntries(flags.map((id) => [id, all[id]]));
    grid.push({ k, size: text.length, live, ...(flags.length ? { staleCarried: extra } : {}) });
    if (flags.length) stale.push({ k, atoms: flags });
    for (const a of atoms.filter((x) => isLive(x, k))) {
      const age = k - Math.ceil(a.turn / 2) + 1, row = (byAge[age] ??= { kept: 0, reworded: 0, gone: 0 });
      row[all[a.id].label] += 1;
    }
  });
  const ids = atoms.map((a) => a.id);
  const decided = decide(grid, ids, cfg.first, cfg.last);
  const complete = texts.length >= cfg.last;
  const early = cfg.alt ? { window: cfg.alt, decided: decide(grid, ids, cfg.alt[0], cfg.alt[1]) } : undefined;
  return { complete, loses: complete && decided.length > 0, decided, ...(early ? { early } : {}), stale, byAge, grid };
}

const MARK = { kept: 'K', reworded: 'R', gone: 'G' };

export function gridText(result, cfg = SAGAS['saga-01']) {
  const head = 'k   ' + cfg.atoms.map((a) => a.id.padEnd(4)).join('');
  const rows = result.grid.map((g) => String(g.k).padEnd(4) + cfg.atoms.map((a) => (g.live[a.id] ? MARK[g.live[a.id].label] : '.').padEnd(4)).join(''));
  return [head, ...rows].join('\n');
}

export function markdown(result, cfg) {
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const grid = [row(['k', ...cfg.atoms.map((a) => a.id), 'size']), row(Array(cfg.atoms.length + 2).fill('---')),
    ...result.grid.map((g) => row([g.k, ...cfg.atoms.map((a) => (g.live[a.id] ? MARK[g.live[a.id].label] : '')), g.size]))];
  const ages = Object.keys(result.byAge).map(Number).sort((a, b) => a - b);
  const age = [row(['age', 'readings', 'kept', 'reworded', 'gone']), row(Array(5).fill('---')),
    ...ages.map((n) => { const r = result.byAge[n]; return row([n, r.kept + r.reworded + r.gone, r.kept, r.reworded, r.gone]); })];
  return [...grid, '', ...age].join('\n');
}

function runFile(file, n, cfg, audit) {
  const texts = readSummaries(file);
  const result = evaluate(texts, cfg);
  if (!result.complete) console.error(`only ${texts.length} summaries, the rule needs ${cfg.last}`);
  mkdirSync(cfg.out, { recursive: true });
  writeFileSync(join(cfg.out, `session-${n}.json`), JSON.stringify({ _synthetic: true, session: Number(n), compactions: texts.length, ...result }, null, 1) + '\n');
  if (audit) {
    mkdirSync(join(audit, `session-${n}`), { recursive: true });
    texts.forEach((t, i) => writeFileSync(join(audit, `session-${n}`, `k${i + 1}.txt`), t));
  }
  console.log(`session ${n}: ${result.loses ? 'LOSES' : 'holds'} ${JSON.stringify(result.decided)} stale ${JSON.stringify(result.stale)}\n${gridText(result, cfg)}`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'gfgate-'));
  const make = (name, missing, only = {}, cfg = SAGAS['saga-01'], total = 25) => {
    const lines = [];
    for (let k = 1; k <= total; k++) {
      const sentences = cfg.atoms.filter((a) => isLive(a, k) || only[a.id]?.includes(k))
        .filter((a) => !(missing[a.id] ?? []).includes(k)).map((a) => a.text);
      lines.push({ type: 'system', subtype: 'compact_boundary', uuid: `b${k}`, compactMetadata: { preTokens: 1 } });
      lines.push({ type: 'user', isCompactSummary: true, uuid: `s${k}`, message: { role: 'user', content: [{ type: 'text', text: `The user is working on harbour tools. ${sentences.join('. ')}.` }] } });
    }
    const file = join(dir, name);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
    return evaluate(readSummaries(file), cfg);
  };
  try {
    const loses = make('lose', { r1: [12, 13] });
    assert.equal(loses.loses, true);
    assert.deepEqual(loses.decided, [{ atom: 'r1', k: [12, 13] }]);
    const holds = make('hold', { x1: [9, 10] });
    assert.equal(holds.loses, false);
    assert.equal(holds.grid[8].live.x1.label !== 'kept', true);
    const gap = make('gap', { r3: [12, 14] });
    assert.equal(gap.loses, false);
    assert.equal(gap.grid[11].live.r3.label === 'kept', false);
    const staled = make('stale', { w1: [15], r2: [14, 16, 17, 18, 19, 20] }, { r2: [15] });
    assert.equal(staled.loses, false);
    assert.deepEqual(staled.stale, [{ k: 15, atoms: ['r2'] }]);
    const edge = make('edge', { r1: [9, 10, 20, 21] });
    assert.equal(edge.loses, false);
    const wide = make('wide', { r1: [20, 21] });
    assert.equal(wide.loses, false);
    const short = evaluate(['one'].concat(Array(18).fill('x')));
    assert.equal(short.complete, false);
    assert.equal(short.loses, false);
    const s2 = SAGAS['saga-02'];
    assert.equal(s2.atoms.length, 20);
    const late = make('late', { r1: [22, 23] }, {}, s2, 30);
    assert.deepEqual(late.decided, [{ atom: 'r1', k: [22, 23] }]);
    assert.equal(late.loses, true);
    assert.deepEqual(late.early.decided, []);
    const clean = make('clean', {}, {}, s2, 30);
    assert.equal(clean.loses, false);
    assert.equal(clean.byAge[1].kept, 20);
    assert.equal(clean.byAge[29].kept, 1);
    const carried = make('carried', { c1: [7] }, { g1: [7] }, s2, 30);
    assert.deepEqual(carried.stale, [{ k: 7, atoms: ['g1'] }]);
    console.log('self-test: 10 cases pass');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const cfg = SAGAS[take('--story') ?? 'saga-01'];
  const audit = take('--audit');
  const report = take('--report');
  if (args[0] === '--self-test') selfTest();
  else if (report) console.log(markdown(JSON.parse(readFileSync(join(cfg.out, `session-${report}.json`), 'utf8')), cfg));
  else if (args[0] && args[1]) runFile(args[0], args[1], cfg, audit);
  else { console.error('usage: score.mjs <session.jsonl> <n> [--story saga-02] [--audit <dir>] | --self-test | --report <n>'); process.exit(2); }
}
