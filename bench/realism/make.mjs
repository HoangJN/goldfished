#!/usr/bin/env node
// Builds the realism pairs: invented messages, real compaction summaries.
// Usage: node make.mjs run | pairs | clean | all
// Runs happen under ROOT. The session files Claude Code writes go under ~/.claude/projects in
// folders with gfreal in the name. `clean` removes those folders and nothing else.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../../src/prng.mjs';
import { band, sessions } from './sessions.mjs';
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
  for (const [i, turn] of s.turns.entries()) {
    const r = await claude(cwd, turn, id);
    log(`${s.slug} turn ${i + 1}/${s.turns.length}: exit ${r.status}, error ${r.result?.is_error}, cost ${r.result?.total_cost_usd}`);
    if (r.status !== 0 || r.result?.is_error || !r.sessionId) { stats.failures.push(`${s.slug} turn ${i + 1}`); return; }
    id = r.sessionId;
  }
  const r = await claude(cwd, '/compact', id);
  log(`${s.slug} compact: exit ${r.status}, error ${r.result?.is_error}, cost ${r.result?.total_cost_usd}`);
  if (r.status !== 0 || r.result?.is_error) stats.failures.push(`${s.slug} compact`);
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
    const summary = records.filter((r) => r.isCompactSummary === true).map((r) => trim(bodyOf(r))).at(-1);
    if (summary) hits.push({ summary, typed: new Set(records.filter((r) => r.type === 'user' && !r.isCompactSummary && !r.isMeta).map((r) => norm(bodyOf(r)))) });
  }
  if (hits.length !== 1) throw new Error(`${s.slug}: ${hits.length} sessions with a summary`);
  const missing = s.turns.filter((t) => !hits[0].typed.has(norm(t)));
  if (missing.length) throw new Error(`${s.slug}: ${missing.length} typed messages not found in the session file`);
  return scrub(hits[0].summary, s.slug);
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

function pairs() {
  const denylist = parseDenylist(readFileSync(DENYLIST, 'utf8'));
  const all = [];
  for (const s of sessions) {
    const summary = harvest(s);
    for (const message of s.turns) {
      const why = unsafe(message, summary, denylist);
      if (why.length) { console.log(`dropped: ${s.slug} message of ${message.length} chars (${[...new Set(why)].join('; ')})`); continue; }
      all.push({ band: band(message.length), stratum: 'realism', message, summary, _synthetic: true });
    }
  }
  const rand = mulberry32(3);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const kept = all.slice(0, WANT).map((p, i) => ({ id: `r${String(i + 1).padStart(3, '0')}`, ...p }));
  const per = {};
  for (const p of kept) per[p.band] = (per[p.band] ?? 0) + 1;
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(`${OUTDIR}/pairs.jsonl`, kept.map((p) => JSON.stringify(p)).join('\n') + '\n');
  console.log(`safe pairs ${all.length}, written ${kept.length}, per band ${JSON.stringify(per)}`);
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
else if (cmd === 'clean') clean();
else { console.error('usage: make.mjs run [slug ...] | pairs | clean | all'); process.exit(2); }
