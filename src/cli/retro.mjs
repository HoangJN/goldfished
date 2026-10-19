import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { adapters } from '../agents/index.mjs';
import { META } from '../agents/meta.mjs';
import * as grader from '../grade.mjs';
import { foldSession } from '../fold.mjs';
import { combine, curve, bootstrap, measurable, span, shifted } from '../stats.mjs';
import { verdict } from '../fun.mjs';
import { mask } from '../mask.mjs';
import { mulberry32 } from '../prng.mjs';
import { per100 } from '../wrap.mjs';
import * as report from '../report.mjs';
import { DEMO } from '../demo.mjs';
import * as home from '../home.mjs';
import * as store from '../store.mjs';
import { topLevel } from '../project.mjs';
import { command, inHome } from './card.mjs';
const day = 86400000, EXAMPLE = 'Invented example, not real data.', version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const cut = s => Array.from(mask(s.replace(/[\u0000-\u001f\u007f-\u009f\s]+/gu, ' ').trim(), 'display')).slice(0, 80).join('').trimEnd();
const blank = id => ({ id, label: META[id]?.label ?? id, status: 'none', sessions: 0, compacted: 0, messages: 0,
  firstMs: null, lastMs: null, curve: [], composition: null, span: null, censored: false, headlineAge: null,
  headline: null, verdict: null, note: META[id]?.note ?? null, card: null, drift: null, notCounted: { short: 0, pasted: 0 } });
const unread = (id, patch) => ({ ...blank(id), sessions: null, compacted: null, messages: null, censored: null, notCounted: null, ...patch });
const flags = { agent: 'string', dir: 'string', days: 'string', names: 'boolean', show: 'boolean', audit: 'boolean', json: 'boolean', save: 'boolean', demo: 'boolean' };
function shown(root, userHome) {
  const path = root.replaceAll('\\', '/'), base = userHome.replaceAll('\\', '/').replace(/\/$/u, '');
  return path === base ? '~' : path.startsWith(base + '/') ? '~' + path.slice(base.length) : path;
}
function summarise(agent, main, card) {
  const ages = combine(main);
  agent.curve = curve(ages);
  Object.assign(agent, span(agent.curve));
  const comp = curve(combine(main, 'comp'));
  agent.composition = shifted(agent.curve, comp) ? comp : null;
  const row = agent.curve.find(r => r.age === agent.headlineAge);
  if (row) {
    const [lo, hi] = bootstrap(ages, row.age, { B: 1000, seed: 1 }).map(Math.round);
    agent.headline = { age: row.age, keptPer100: per100(row.kept, row.messages), ci95: [lo, hi], messages: row.messages, sessions: row.sessions };
  }
  if (card.length) {
    const c = curve(combine(card)).find(r => r.age === agent.headlineAge);
    agent.card = { sessions: card.length, age: agent.headlineAge, keptPer100: c && measurable(c) ? per100(c.kept, c.messages) : null };
  }
}
function headlineOf(agents) {
  const pool = agents.filter(a => ['ok', 'too_few'].includes(a.status));
  const key = pool.some(a => a.headline) ? a => a.headline?.messages ?? -1 : a => a.messages;
  return [...pool].sort((a, b) => key(b) - key(a))[0]?.id ?? null;
}
function probesOf(state, top) {
  const probes = state.projects?.[top]?.probes ?? state.probes ?? {};
  return Object.entries(probes).flatMap(([key, p]) => {
    const agent = p.agent ?? key, at = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(p.date);
    return META[agent] && at && typeof p.kept === 'boolean' ? [{ agent, date: new Date(+at[1], at[2] - 1, +at[3], 12).getTime(), kept: p.kept }] : [];
  });
}
async function retro(args, io) {
  const f = args.flags, fail = line => { io.err(line); return 1; };
  if (args.positional.length) return fail('goldfished: missing or extra arguments. Try: goldfished retro --help');
  if (f.dir !== undefined && (!f.agent || f.agent === 'all'))
    return fail('goldfished: --dir needs --agent, because each agent keeps its files somewhere different.');
  const days = f.days === undefined ? 30 : Number(f.days);
  if (f.days !== undefined && (!/^\d+$/u.test(f.days) || !Number.isSafeInteger(days) || days * day > 8.64e15))
    return fail('goldfished: invalid --days. Try: goldfished retro --help');
  if (f.json) for (const key of ['show', 'audit', 'names', 'save']) if (f[key])
    return fail(`goldfished: --${key} cannot be used with --json. Try: goldfished retro --help`);
  if (f.agent && f.agent !== 'all' && !Object.hasOwn(META, f.agent))
    return fail('goldfished: unknown agent. Try: goldfished retro --help');
  const finish = (result, tty) => f.json ? (io.err(report.text(result, { tty: false })), io.out(JSON.stringify(report.json(result)))) :
    io.out(report.text(result, { tty, noColor: io.env.NO_COLOR !== undefined }));
  if (f.demo) {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      if (f.json) io.err(EXAMPLE); else io.out(EXAMPLE);
      finish({ ...DEMO, grader: grader.GRADER }, false);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
    return 0;
  }
  if (f.show || f.audit) io.err(`${f.show ? '--show' : '--audit'} prints pieces of your own messages. Do not paste this output anywhere.`);
  const started = Date.now(), userHome = io.env.USERPROFILE || io.env.HOME || homedir(), sinceMs = days ? io.nowMs - days * day : 0;
  const result = { toolVersion: version, grader: grader.GRADER, window: { days, fromMs: sinceMs || null, toMs: io.nowMs },
    files: 0, bytes: 0, secs: 0, notGraded: { auto: 0, sub: 0 }, roots: [], cardTrusted: false, save: Boolean(f.save),
    probes: [], headlineAgent: null, agents: [], show: null, audit: null, history: null };
  const jobs = [];
  for (const adapter of adapters.filter(a => !f.agent || f.agent === 'all' || a.id === f.agent)) {
    const roots = f.dir ? [resolve(io.cwd, f.dir)] : adapter.roots(io.env, userHome), files = [];
    for (const root of roots) {
      result.roots.push(shown(root, userHome));
      files.push(...await adapter.listFiles(root, { sinceMs }));
    }
    result.files += files.length; result.bytes += files.reduce((n, file) => n + file.size, 0);
    jobs.push({ adapter, files });
  }
  let done = 0, progressed = false, seen = 0;
  const rng = mulberry32(1), audit = [], gone = [];
  const timer = io.errTTY ? setInterval(() => {
    if (Date.now() - started >= 2000) { progressed = true; io.err(`\rreading ${done} of ${result.files} files`); }
  }, 100) : null;
  try {
    for (const { adapter, files } of jobs) {
      const before = done, agent = blank(adapter.id), main = [], card = [];
      const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0,
        types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
      let readable = false;
      for await (const session of adapter.sessions(files, tally)) {
        done = before + tally.files;
        if (session.auto) result.notGraded.auto++;
        if (session.sub) result.notGraded.sub++;
        if (session.auto || session.sub) continue;
        agent.sessions++; agent.compacted += Number(session.compactions.length > 0);
        if (session.firstMs != null) agent.firstMs = Math.min(agent.firstMs ?? Infinity, session.firstMs);
        if (session.lastMs != null) agent.lastMs = Math.max(agent.lastMs ?? -Infinity, session.lastMs);
        readable ||= session.compactions.some(c => c.visible !== null);
        const fold = foldSession(session, grader, { sampleSeed: 1 });
        agent.messages += fold.typed;
        agent.notCounted.short += fold.notCounted.short; agent.notCounted.pasted += fold.notCounted.pasted;
        (session.cardResent ? card : main).push({ ages: fold.ages, comp: fold.comp });
        if (f.show) {
          gone.push(...fold.goneSamples.map(s => ({ ...s, agent: adapter.id, project: session.project, text: cut(s.text) })));
          gone.sort((a, b) => b.lastMs - a.lastMs); gone.splice(20);
        }
        if (f.audit) for (const sample of fold.auditPool) {
          seen++; const slot = seen <= 5 ? seen - 1 : Math.floor(rng() * seen);
          if (slot < 5) audit[slot] = { agent: adapter.id, project: session.project, age: sample.age, label: sample.label,
            score: sample.score, you: cut(sample.text), summary: cut(grader.bestMatch(sample.text, mask(session.compactions[sample.visibleIdx].visible, 'display'))) };
        }
      }
      summarise(agent, main, card);
      const drift = adapter.driftCheck(tally), first = agent.curve.find(r => r.age === 1);
      agent.status = !files.length ? 'none' : !drift.ok ? 'drift' : !readable ? 'not_recorded' : first && measurable(first) ? 'ok' : 'too_few';
      if (agent.status === 'ok') agent.verdict = verdict(agent);
      result.agents.push(agent.status === 'drift' ? unread(adapter.id, { status: 'drift', drift: { files: files.length, unread: drift.unread } }) : agent);
      done = before + files.length;
    }
  } finally { if (timer) clearInterval(timer); if (progressed) io.err('\r' + ' '.repeat(79) + '\r'); }
  for (const [id, folder] of [['gemini', '.gemini/tmp'], ['cursor', '.cursor'], ['copilot', '.copilot']]) {
    if (f.agent && f.agent !== 'all' && f.agent !== id) continue;
    if (!existsSync(join(userHome, folder)) || !statSync(join(userHome, folder)).isDirectory()) continue;
    result.agents.push(unread(id, { status: 'not_recorded' }));
  }
  result.headlineAgent = headlineOf(result.agents);
  const aliases = new Map(), display = sample => {
    if (!aliases.has(sample.project)) aliases.set(sample.project, `project-${aliases.size + 1}`);
    return { ...sample, project: f.names ? cut(sample.project) : aliases.get(sample.project) };
  };
  result.show = f.show ? gone.map(({ lastMs, ...s }) => display(s)) : null;
  result.audit = f.audit ? audit.map(display) : null;
  if (!days) result.window.fromMs = Math.min(io.nowMs, ...result.agents.map(a => a.firstMs ?? io.nowMs));
  result.secs = (Date.now() - started) / 1000;
  if (f.save || existsSync(io.env.GOLDFISHED_HOME || join(homedir(), '.goldfished'))) inHome(io, () => {
    const loaded = store.load(topLevel(io.cwd));
    result.cardTrusted = existsSync(loaded.cardPath) && loaded.trusted;
    result.probes = probesOf(home.state(), topLevel(io.cwd));
    if (f.save) {
      for (const agent of result.agents) {
        const old = home.lastHistory(agent.id, io.nowMs - 7 * day);
        if (old) result.history = { ...result.history, [agent.id]: { date: Date.parse(old.date), span: old.span, censored: old.span_censored } };
      }
      for (const agent of report.json(result).agents) home.appendHistory({ ...agent, date: new Date(io.nowMs).toISOString() });
    }
  });
  finish(result, io.outTTY === true);
  return 0;
}
export const commands = { retro: command('retro', '[--agent <id>|all] [--dir <path>] [--days <n>] [--names] [--show] [--audit] [--json] [--save] [--demo]', flags, retro) };
