#!/usr/bin/env node
// Builds the realism pairs: invented messages, real compaction summaries.
// Usage: node make.mjs run | pairs | clean | all
// Runs happen under ROOT. The session files Claude Code writes go under ~/.claude/projects in
// folders with gfreal in the name. `clean` removes those folders and nothing else.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../../src/prng.mjs';
import { band, sessions, topics } from './sessions.mjs';
import { checkFile, parseDenylist } from '../../scripts/gate.mjs';

const ROOT = process.env.GFREAL_ROOT ?? 'D:/Dev/gf-scratch/b12r-gfreal';
const OUTDIR = process.env.GFREAL_OUT ?? 'D:/Dev/gf-realism';
const DENYLIST = process.env.GFREAL_DENYLIST ?? 'D:/Dev/goldfished/.claude/denylist.txt';
const WANT = 30;
const HOME = process.env.USERPROFILE ?? process.env.HOME;
const TAG = 'gfreal';

const flags = ['-p', '--setting-sources', 'project,local', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--tools', 'Read,Write,Edit,Glob,Grep', '--permission-mode', 'acceptEdits', '--strict-mcp-config'];

function env() {
  const e = { ...process.env };
  e.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CONFIG_DIR']) delete e[k];
  return e;
}

const stats = { runs: 0, cost: 0, hooks: 0, plugins: 0, failures: [] };

function claude(cwd, prompt, resume) {
  return new Promise((done) => {
    const child = spawn('claude', [...flags, ...(resume ? ['--resume', resume] : [])], { cwd, env: env() });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.stdin.end(prompt);
    child.on('close', (status) => {
      clearTimeout(timer);
      const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
      const result = events.find((e) => e.type === 'result');
      const init = events.find((e) => e.subtype === 'init');
      stats.runs++;
      stats.cost += result?.total_cost_usd ?? 0;
      stats.hooks += events.filter((e) => /^hook_/.test(e.subtype ?? '')).length;
      stats.plugins += (init?.plugins ?? []).filter((p) => p.path !== 'builtin').length;
      done({ status, result, sessionId: result?.session_id ?? init?.session_id, err });
    });
  });
}

async function runSession(s, log) {
  const cwd = `${ROOT}/${s.slug}`;
  rmSync(cwd, { recursive: true, force: true });
  for (const n of existsSync(projects()) ? readdirSync(projects()) : []) if (n.includes(TAG) && n.endsWith(s.slug)) rmSync(join(projects(), n), { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  let id;
  const step = async (name, text) => {
    const r = await claude(cwd, text, id);
    log(`${s.slug} ${name}: exit ${r.status}, error ${r.result?.is_error}, cost ${r.result?.total_cost_usd}`);
    if (r.status !== 0 || r.result?.is_error || !r.sessionId) { stats.failures.push(`${s.slug} ${name}`); return false; }
    id = r.sessionId;
    return true;
  };
  for (const [i, turn] of s.turns.entries()) if (!(await step(`turn ${i + 1}`, turn))) return;
  if (!(await step('compact 1', '/compact'))) return;
  for (const [i, turn] of s.later.entries()) if (!(await step(`later ${i + 1}`, turn))) return;
  await step('compact 2', '/compact');
}

async function run(only) {
  if (!only) { rmSync(ROOT, { recursive: true, force: true }); }
  mkdirSync(ROOT, { recursive: true });
  const log = (line) => console.log(line);
  const queue = sessions.filter((s) => !only || only.includes(s.slug));
  const lanes = Array.from({ length: 3 }, async () => { for (let s; (s = queue.shift());) await runSession(s, log); });
  await Promise.all(lanes);
  console.log(`runs ${stats.runs}, cost ${stats.cost.toFixed(2)}, hook events ${stats.hooks}, plugins ${stats.plugins}, failures ${JSON.stringify(stats.failures)}`);
}

const projects = () => join(HOME, '.claude', 'projects');
const norm = (t) => t.trim().replace(/\s+/g, ' ');

function sessionFolder(slug) {
  const names = readdirSync(projects()).filter((n) => n.includes(TAG) && n.endsWith(slug));
  if (names.length !== 1) throw new Error(`${slug}: ${names.length} session folders`);
  return join(projects(), names[0]);
}

function bodyOf(r) {
  const c = r.message?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
}

// Claude Code wraps the summary in a lead-in and a trailer, and the trailer names the transcript path. Only the part the model wrote is kept.
const LEAD = '\n\nSummary:\n';
const TRAILER = '\n\nIf you need specific details from before compaction';

function trim(body) {
  const a = body.indexOf(LEAD);
  const z = body.lastIndexOf(TRAILER);
  if (a < 0 || z < a) throw new Error('summary wrapper not recognised');
  return body.slice(a + LEAD.length, z).trim();
}

// The model names files by their full path, so the scratch folder shows up in front of every file name.
// That one prefix is cut, nothing else. A path to anything outside it stays, and the pair is dropped.
function scrub(text, slug) {
  const parts = ROOT.split('/').concat(slug).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(parts.join('[\\\\/]+') + '[\\\\/]*', 'gi'), '');
}

function harvest(s) {
  const dir = sessionFolder(s.slug);
  const hits = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    const records = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summaries = records.filter((r) => r.isCompactSummary === true).map((r) => scrub(trim(bodyOf(r)), s.slug));
    if (summaries.length) hits.push({ summaries, typed: new Set(records.filter((r) => r.type === 'user' && !r.isCompactSummary && !r.isMeta).map((r) => norm(bodyOf(r)))) });
  }
  if (hits.length !== 1) throw new Error(`${s.slug}: ${hits.length} sessions with a summary`);
  if (hits[0].summaries.length !== 2) throw new Error(`${s.slug}: ${hits[0].summaries.length} summaries, wanted 2`);
  const missing = [...s.turns, ...s.later].filter((m) => !hits[0].typed.has(norm(m)));
  if (missing.length) throw new Error(`${s.slug}: ${missing.length} typed messages not found in the session file`);
  return hits[0].summaries;
}

const USER_NAME = (process.env.USERNAME ?? process.env.USER ?? '').toLowerCase();

function unsafe(message, summary, denylist) {
  const text = `${message}\n${summary}`;
  const why = [];
  if (text.includes('Users')) why.push('Users');
  const drive = text.match(/[A-Za-z]:[\\/]/);
  if (drive) why.push(`drive path ${JSON.stringify(drive[0])}`);
  if (USER_NAME && text.toLowerCase().includes(USER_NAME)) why.push('user name');
  for (const f of checkFile({ file: 'pairs.jsonl', text, denylist })) why.push(`${f.check}: ${f.reason}`);
  return why;
}

const word = (message, summary) => norm(summary).includes(norm(message));
const SUMMARIES = `${OUTDIR}/summaries.json`;
const hasTopic = (text, slug) => topics[slug].some((w) => new RegExp('\\b' + w, 'i').test(text));

// Reads each job's first summary from its session file and keeps them outside the repo, so the set can be rebuilt without more runs.
function pairs() {
  const first = existsSync(SUMMARIES) ? JSON.parse(readFileSync(SUMMARIES, 'utf8')) : {};
  for (const s of sessions) first[s.slug] = harvest(s)[0];
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(SUMMARIES, JSON.stringify(first, null, 1));
  rebuild();
}

// Fifteen messages with their own job's first summary, fifteen with another job's. A message is used once.
function rebuild() {
  const denylist = parseDenylist(readFileSync(DENYLIST, 'utf8'));
  const saved = JSON.parse(readFileSync(SUMMARIES, 'utf8'));
  const rand3 = mulberry32(3);
  const rand4 = mulberry32(4);
  const shuffle = (list) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand3() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const usable = {};
  const entries = sessions.flatMap((s) => s.turns.map((message) => ({ slug: s.slug, message, band: band(message.length) })));
  for (const [slug, summary] of Object.entries(saved)) {
    if (!summary) continue;
    usable[slug] = summary;
  }
  const own = {};
  for (const e of entries) {
    if (!usable[e.slug]) continue;
    const why = unsafe(e.message, usable[e.slug], denylist);
    if (why.length) console.log(`dropped: ${e.slug} message of ${e.message.length} chars, own summary (${[...new Set(why)].join('; ')})`);
    else own[e.message] = usable[e.slug];
  }
  const order = shuffle([...entries]).sort((x, y) => x.band.localeCompare(y.band));
  let n = 0;
  const ownList = [];
  const otherList = [];
  for (const e of order) {
    if (own[e.message] && n++ % 3 !== 2) ownList.push({ ...e, summary: own[e.message], kind: 'own' });
    else otherList.push(e);
  }
  const others = [];
  for (const e of shuffle(otherList)) {
    const options = Object.keys(usable).filter((slug) => slug !== e.slug
      && !topics[slug].some((w) => topics[e.slug].includes(w))
      && !hasTopic(usable[slug], e.slug)
      && !word(e.message, usable[slug])
      && !unsafe(e.message, usable[slug], denylist).length);
    if (!options.length) { console.log(`dropped: ${e.slug} message of ${e.message.length} chars, no other summary fits`); continue; }
    const slug = options[Math.floor(rand4() * options.length)];
    others.push({ ...e, summary: usable[slug], kind: 'other' });
  }
  const chosen = [...shuffle(ownList).slice(0, WANT / 2), ...others.slice(0, WANT / 2)];
  const kept = shuffle(chosen).map((p, i) => ({ id: `r${String(i + 1).padStart(3, '0')}`, band: p.band, stratum: 'realism', message: p.message, summary: p.summary, age: 1, kind: p.kind, _synthetic: true }));
  const per = { band: {}, kind: {}, verbatim: { own: [0, 0], other: [0, 0] } };
  for (const p of kept) {
    per.band[p.band] = (per.band[p.band] ?? 0) + 1;
    per.kind[p.kind] = (per.kind[p.kind] ?? 0) + 1;
    per.verbatim[p.kind][0]++;
    if (word(p.message, p.summary)) per.verbatim[p.kind][1]++;
  }
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(`${OUTDIR}/pairs.jsonl`, kept.map((p) => JSON.stringify(p)).join('\n') + '\n');
  console.log(`first summaries held for ${Object.keys(usable).length} of ${sessions.length} jobs`);
  console.log(`written ${kept.length}, per band ${JSON.stringify(per.band)}, per kind ${JSON.stringify(per.kind)}`);
  console.log(`word for word: own ${per.verbatim.own[1]} of ${per.verbatim.own[0]}, other ${per.verbatim.other[1]} of ${per.verbatim.other[0]}`);
}

function clean() {
  for (const base of [projects(), join(process.env.TEMP ?? '', 'claude')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).filter((n) => n.includes(TAG))) {
      rmSync(join(base, name), { recursive: true, force: true });
      console.log('removed', join(base.replace(HOME, '~'), name));
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'all') { await run(); pairs(); }
else if (cmd === 'run') await run(rest.length ? rest : undefined);
else if (cmd === 'pairs') pairs();
else if (cmd === 'rebuild') rebuild();
else if (cmd === 'clean') clean();
else { console.error('usage: make.mjs run [slug ...] | pairs | clean | all'); process.exit(2); }
