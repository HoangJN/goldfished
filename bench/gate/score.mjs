#!/usr/bin/env node
// Scores one Claude Code session file against the frozen atoms, by the rule in RULE.md.
// Usage: node score.mjs <session.jsonl> <n> [--audit <dir>]   |   node score.mjs --self-test
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, score } from '../../src/grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ATOMS = JSON.parse(readFileSync(join(here, 'atoms.json'), 'utf8')).atoms;
const FIRST = 10, LAST = 20;

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

export const isLive = (a, k) => a.turn <= 2 * k && (a.supersededAt === undefined || a.supersededAt > 2 * k);

export function evaluate(texts) {
  const by = Object.fromEntries(ATOMS.map((a) => [a.id, a]));
  const grid = [], stale = [];
  texts.forEach((text, i) => {
    const k = i + 1, index = prepare(text);
    const all = Object.fromEntries(ATOMS.map((a) => [a.id, score(a.text, index)]));
    const live = Object.fromEntries(ATOMS.filter((a) => isLive(a, k)).map((a) => [a.id, all[a.id]]));
    const kept = (id) => all[id].label === 'kept';
    const flags = [];
    if (k >= 14 && kept('r2') && !kept('w1')) flags.push('r2');
    if (k >= 18 && kept('g2') && !kept('g3')) flags.push('g2');
    const extra = Object.fromEntries(flags.map((id) => [id, all[id]]));
    grid.push({ k, live, ...(flags.length ? { staleCarried: extra } : {}) });
    if (flags.length) stale.push({ k, atoms: flags });
  });
  const decided = [];
  for (const id of Object.keys(by)) {
    for (let k = FIRST; k < LAST; k++) {
      const row = (j) => grid[j - 1]?.live[id];
      if (row(k) && row(k + 1) && row(k).label !== 'kept' && row(k + 1).label !== 'kept') { decided.push({ atom: id, k: [k, k + 1] }); break; }
    }
  }
  const complete = texts.length >= LAST;
  return { complete, loses: complete && decided.length > 0, decided, stale, grid };
}

export function gridText(result) {
  const mark = { kept: 'K', reworded: 'R', gone: 'G' };
  const head = 'k   ' + ATOMS.map((a) => a.id.padEnd(4)).join('');
  const rows = result.grid.map((g) => String(g.k).padEnd(4) + ATOMS.map((a) => (g.live[a.id] ? mark[g.live[a.id].label] : '.').padEnd(4)).join(''));
  return [head, ...rows].join('\n');
}

function runFile(file, n, audit) {
  const texts = readSummaries(file);
  const result = evaluate(texts);
  if (!result.complete) console.error(`only ${texts.length} summaries, the rule needs ${LAST}`);
  const dir = join(here, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `session-${n}.json`), JSON.stringify({ _synthetic: true, session: Number(n), compactions: texts.length, ...result }, null, 1) + '\n');
  if (audit) {
    mkdirSync(join(audit, `session-${n}`), { recursive: true });
    texts.forEach((t, i) => writeFileSync(join(audit, `session-${n}`, `k${i + 1}.txt`), t));
  }
  console.log(`session ${n}: ${result.loses ? 'LOSES' : 'holds'} ${JSON.stringify(result.decided)} stale ${JSON.stringify(result.stale)}\n${gridText(result)}`);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'gfgate-'));
  const make = (name, missing, only = {}) => {
    const lines = [];
    for (let k = 1; k <= 25; k++) {
      const sentences = ATOMS.filter((a) => isLive(a, k) || only[a.id]?.includes(k))
        .filter((a) => !(missing[a.id] ?? []).includes(k)).map((a) => a.text);
      lines.push({ type: 'system', subtype: 'compact_boundary', uuid: `b${k}`, compactMetadata: { preTokens: 1 } });
      lines.push({ type: 'user', isCompactSummary: true, uuid: `s${k}`, message: { role: 'user', content: [{ type: 'text', text: `The user is working on harbour tools. ${sentences.join('. ')}.` }] } });
    }
    const file = join(dir, name);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
    return evaluate(readSummaries(file));
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
    console.log('self-test: 7 cases pass');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, b, c, d] = process.argv.slice(2);
  if (a === '--self-test') selfTest();
  else if (a && b) runFile(a, b, c === '--audit' ? d : undefined);
  else { console.error('usage: score.mjs <session.jsonl> <n> [--audit <dir>] | --self-test'); process.exit(2); }
}
