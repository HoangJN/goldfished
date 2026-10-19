#!/usr/bin/env node
// Framing screen runner. Everything it writes stays under FRAMING_ROOT. The model comes from FRAMING_MODEL.
// Usage: node run.mjs plant <spec|short|nofollow> | show <framing> | batch <runs per framing> | clean
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../../src/prng.mjs';
import { scoreFile, wilson } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FRAMING_ROOT ?? 'D:/Dev/gf-scratch/B20';
const PROJ = `${ROOT}/proj`;
const RUNS = `${ROOT}/runs`;
const HOME = process.env.USERPROFILE ?? process.env.HOME;
const SESSIONS = join(HOME, '.claude', 'projects', PROJ.replace(/[^A-Za-z0-9]/g, '-'));
const FRAMINGS = ['spec', 'short', 'nofollow'];
const TURNS = [
  "We are building exportkit, a small Node tool that writes the finance team's daily export file. Read package.json and src/rows.mjs, then tell me in two sentences what is already there.",
  'Good. Now read README.md and tell me in one sentence whether it matches the code.',
];
const TASK = 'Add a function writeDailyExport(rows, day) in a new file src/daily.mjs. It writes out/export.csv: the first line is a header carrying the date of day (a Date), then one line per row. Put a one-line JSDoc @example above it showing the header it writes for 5 March 2026. Keep it short.';

const model = () => {
  if (!process.env.FRAMING_MODEL) throw new Error('set FRAMING_MODEL');
  return ['--model', process.env.FRAMING_MODEL];
};

function claude(prompt, extra, env = {}) {
  const e = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ...env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CONFIG_DIR']) delete e[k];
  const args = ['-p', '--setting-sources', 'project', '--output-format', 'json', '--tools', 'Read,Write,Edit,Glob,Grep', '--strict-mcp-config', '--permission-mode', 'acceptEdits', ...model(), ...extra];
  const r = spawnSync('claude', args, { cwd: PROJ, env: e, input: prompt, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 15 * 60 * 1000 });
  let result = {};
  try { result = JSON.parse(r.stdout); } catch {}
  if (r.status !== 0 || result.is_error || !result.session_id) throw new Error(`claude failed: exit ${r.status} ${(r.stderr || r.stdout).slice(0, 300)}`);
  return result;
}

function reset(withHook) {
  spawnSync('git', ['-C', PROJ, 'checkout', '-q', '--', '.']);
  spawnSync('git', ['-C', PROJ, 'clean', '-fdxq']);
  mkdirSync(`${PROJ}/.claude`, { recursive: true });
  const hooks = withHook ? { SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: 'node', args: [`${ROOT}/hook.mjs`], timeout: 10 }] }] } : {};
  writeFileSync(`${PROJ}/.claude/settings.json`, JSON.stringify({ hooks }));
}

const read = (id) => readFileSync(`${SESSIONS}/${id}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const textOf = (r) => {
  const c = r.message?.content ?? r.attachment?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b.text ?? '')).join('\n') : JSON.stringify(r.attachment ?? '');
};
const kind = (r) => [r.type, r.subtype, r.attachment?.type, r.isCompactSummary ? 'summary' : ''].filter(Boolean).join('/');

const LEAD = '\n\nSummary:\n';
const TRAILER = '\n\nIf you need specific details from before compaction';

function plant(framing) {
  copyFileSync(join(here, 'hook.mjs'), `${ROOT}/hook.mjs`);
  reset(true);
  let id;
  for (const t of TURNS) id = claude(t, id ? ['--resume', id] : []).session_id;
  id = claude('/compact', ['--resume', id], { FRAMING_FILE: join(here, 'framings', `${framing}.txt`) }).session_id;
  const planted = readFileSync(join(here, 'planted-summary.txt'), 'utf8').trim();
  const records = read(id);
  const at = records.findIndex((r) => r.isCompactSummary === true);
  if (at < 0) throw new Error('no summary record');
  const body = textOf(records[at]);
  const a = body.indexOf(LEAD);
  const z = body.lastIndexOf(TRAILER);
  if (a < 0 || z < a) throw new Error('summary wrapper not recognised');
  writeFileSync(`${ROOT}/real-${framing}.txt`, body.slice(a + LEAD.length, z));
  const text = body.slice(0, a + LEAD.length) + planted + body.slice(z);
  const r = records[at];
  if (typeof r.message.content === 'string') r.message.content = text;
  else r.message.content = [{ type: 'text', text }];
  writeFileSync(`${SESSIONS}/${id}.jsonl`, records.map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(`${ROOT}/base-${framing}.txt`, id);
  show(framing);
}

function show(framing) {
  const id = readFileSync(`${ROOT}/base-${framing}.txt`, 'utf8');
  const records = read(id);
  const at = records.findIndex((r) => r.isCompactSummary === true);
  console.log(`${framing} ${id}: ${records.slice(Math.max(0, at - 1), at + 4).map(kind).join(' > ')}`);
  const text = records.map(textOf);
  const has = (needle, from) => text.findIndex((t, i) => i >= from && t.includes(needle));
  console.log(`  summary at ${at}, planted text at ${has(readFileSync(join(here, 'planted-summary.txt'), 'utf8').trim().slice(0, 60), 0)}, card context at ${has('goldfished:', at + 1)}`);
}

const base = (f) => readFileSync(`${ROOT}/base-${f}.txt`, 'utf8');
const digest = (f) => createHash('sha256').update(readFileSync(`${SESSIONS}/${base(f)}.jsonl`)).digest('hex');
const MAP = `${RUNS}/map.json`;

function batch(n) {
  mkdirSync(RUNS, { recursive: true });
  const rand = mulberry32(20);
  const order = FRAMINGS.flatMap((framing) => Array.from({ length: n }, () => framing));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const map = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : [];
  const before = Object.fromEntries(FRAMINGS.map((f) => [f, digest(f)]));
  order.forEach((framing, i) => {
    const id = `r${String(i + 1).padStart(2, '0')}`;
    if (map.some((m) => m.id === id)) return;
    reset(false);
    const r = claude(TASK, ['--resume', base(framing), '--fork-session']);
    const wrote = existsSync(`${PROJ}/src/daily.mjs`);
    if (wrote) copyFileSync(`${PROJ}/src/daily.mjs`, `${RUNS}/${id}.mjs`);
    writeFileSync(`${RUNS}/${id}.reply.txt`, r.result ?? '');
    map.push({ id, framing, fork: r.session_id, cost: r.total_cost_usd, turns: r.num_turns, wrote });
    writeFileSync(MAP, JSON.stringify(map, null, 1));
    console.log(`${id} done (${map.length} of ${order.length}) cost ${r.total_cost_usd}`);
  });
  for (const f of FRAMINGS) if (digest(f) !== before[f]) throw new Error(`base session ${f} changed`);
}

function report() {
  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  console.log(`Claude Code ${version}, model ${process.env.FRAMING_MODEL}, cost ${map.reduce((a, m) => a + (m.cost ?? 0), 0).toFixed(2)}`);
  const card = {};
  for (const f of FRAMINGS) {
    const v = map.filter((m) => m.framing === f).map((m) => scoreFile(`${RUNS}/${m.id}.mjs`));
    const count = (k) => v.filter((x) => x === k).length;
    const [lo, hi] = wilson(count('follows-card'), v.length);
    card[f] = count('follows-card');
    console.log(`${f}: follows-card ${card[f]} of ${v.length} (95% range ${(lo * 100).toFixed(0)} to ${(hi * 100).toFixed(0)} in 100), follows-summary ${count('follows-summary')}, neither ${count('neither')}, no file ${map.filter((m) => m.framing === f && !m.wrote).length}`);
  }
  const pass = card.spec >= 17 && card.spec >= card.short && card.spec >= card.nofollow;
  console.log(pass ? 'PASS' : 'FAIL');
}

function clean() {
  rmSync(SESSIONS, { recursive: true, force: true });
  rmSync(ROOT, { recursive: true, force: true });
  console.log('removed', ROOT, 'and', SESSIONS.replace(HOME, '~'), '; still there:', existsSync(ROOT) || existsSync(SESSIONS));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'plant') plant(rest[0]);
else if (cmd === 'show') show(rest[0]);
else if (cmd === 'batch') batch(Number(rest[0] ?? 20));
else if (cmd === 'report') report();
else if (cmd === 'clean') clean();
else { console.error('usage: run.mjs plant <framing> | show <framing> | batch <n> | report | clean'); process.exit(2); }
export { FRAMINGS, TASK, RUNS, SESSIONS };
