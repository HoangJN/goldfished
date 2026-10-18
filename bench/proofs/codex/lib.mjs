// Shared by the Codex platform proofs. Everything it writes stays under GFPROOF_ROOT.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.GFPROOF_ROOT ?? 'D:/Dev/gf-scratch/b12x-gfproof';
export const HOME = `${ROOT}/codex-home`;
export const PROJ = `${ROOT}/proj`;
export const OUT = `${ROOT}/out`;
const BACKSLASH = String.fromCharCode(92);
const PROBE = join(here, 'probe.mjs').replaceAll(BACKSLASH, '/');
const model = process.env.GFPROOF_MODEL ? ['-m', process.env.GFPROOF_MODEL] : [];
export function findCodex() {
  const bin = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  const found = existsSync(bin) ? readdirSync(bin).map((d) => join(bin, d, 'codex.exe')).filter(existsSync) : [];
  return found.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0] ?? 'codex';
}
export const CODEX = findCodex();
export const version = () => spawnSync(CODEX, ['--version'], { encoding: 'utf8', env: childEnv() }).stdout.trim();
// Fresh scratch folders. The sign-in file is copied from GFPROOF_AUTH and is deleted again by finish().
export function init() {
  const auth = process.env.GFPROOF_AUTH;
  if (!auth || !existsSync(auth)) throw new Error('Set GFPROOF_AUTH to the auth.json of a signed-in Codex home.');
  rmSync(ROOT, { recursive: true, force: true });
  for (const d of [HOME, PROJ, OUT]) mkdirSync(d, { recursive: true });
  copyFileSync(auth, `${HOME}/auth.json`);
}
export function finish() {
  rmSync(`${HOME}/auth.json`, { force: true });
  return !existsSync(`${HOME}/auth.json`);
}
const b64 = (s) => 'b64:' + Buffer.from(String(s), 'utf8').toString('base64url');
// spec: {event, tag, mode, args, matcher, where}. where: toml | json | ptoml | pjson.
const command = (dir, s) => ['node', PROBE, dir, s.tag, s.event, s.mode, ...(s.args ?? []).map(b64)].join(' ');
function groups(specs, dir) {
  const by = {};
  for (const s of specs) (by[s.event] ??= []).push({ ...(s.matcher ? { matcher: s.matcher } : {}), hooks: [{ type: 'command', command: command(dir, s), timeout: 10 }] });
  return by;
}
const q = (s) => JSON.stringify(s);
function toml(by, head = '') {
  let t = head;
  for (const [event, gs] of Object.entries(by)) for (const g of gs) {
    t += `\n[[hooks.${event}]]\n${g.matcher ? `matcher = ${q(g.matcher)}\n` : ''}`;
    for (const h of g.hooks) t += `[[hooks.${event}.hooks]]\ntype = "command"\ncommand = ${q(h.command)}\ntimeout = ${h.timeout}\n`;
  }
  return t;
}
// Writes the hook files for one run: the home's config.toml and hooks.json, the project's .codex/config.toml and .codex/hooks.json.
export function configure(dir, specs = [], { agents } = {}) {
  const place = (where) => specs.filter((s) => (s.where ?? 'toml') === where);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${PROJ}/.codex`, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const files = { toml: `${HOME}/config.toml`, json: `${HOME}/hooks.json`, ptoml: `${PROJ}/.codex/config.toml`, pjson: `${PROJ}/.codex/hooks.json`, agents: `${HOME}/AGENTS.md` };
  for (const f of Object.values(files)) rmSync(f, { force: true });
  const project = place('ptoml').length || place('pjson').length;
  const head = project ? `[projects.'${PROJ.replaceAll('/', BACKSLASH)}']\ntrust_level = "trusted"\n` : '';
  writeFileSync(files.toml, toml(groups(place('toml'), dir), head));
  if (place('json').length) writeFileSync(files.json, JSON.stringify({ hooks: groups(place('json'), dir) }, null, 1));
  if (place('ptoml').length) writeFileSync(files.ptoml, toml(groups(place('ptoml'), dir)));
  if (place('pjson').length) writeFileSync(files.pjson, JSON.stringify({ hooks: groups(place('pjson'), dir) }, null, 1));
  if (agents !== undefined) writeFileSync(files.agents, agents);
}
export function childEnv(env = {}) {
  return { ...process.env, ...env, CODEX_HOME: HOME };
}
// Talks to the app server, which the terminal screen and desktop app also use. react(message, send) returns a value to finish.
function appServer(react) {
  return new Promise((resolve, reject) => {
    const c = spawn(CODEX, ['app-server'], { cwd: PROJ, env: childEnv() });
    const seen = [];
    let buf = '';
    const send = (o) => c.stdin.write(JSON.stringify(o) + String.fromCharCode(10));
    const end = (fn, v) => { clearTimeout(timer); c.kill(); fn(v); };
    const timer = setTimeout(() => end(reject, new Error('app-server gave no answer')), 120000);
    c.stderr.on('data', () => {});
    c.stdout.on('data', (d) => {
      const lines = (buf + d).split(String.fromCharCode(10));
      buf = lines.pop();
      for (const l of lines) {
        const m = JSON.parse(l);
        seen.push(m);
        if (m.id === 1) send({ method: 'initialized' });
        const done = react(m, send, seen);
        if (done) setTimeout(() => end(resolve, done), 300);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'gfproof', title: null, version: '0' } } });
  });
}
// Every hook Codex resolves for the project folder, with its source file and trust state. No model call.
export async function hooksList() {
  return appServer((m, send, seen) => {
    if (m.id === 1) send({ id: 2, method: 'hooks/list', params: { cwds: [PROJ] } });
    if (m.id === 2) return { home: seen[0].result.codexHome, hooks: m.result.data[0].hooks, warnings: m.result.data[0].warnings };
  });
}
// What a user does by pressing "Trust all" in Codex: each hook's current hash goes into hooks.state in config.toml.
export async function trustAll() {
  const { hooks } = await hooksList();
  let t = '';
  for (const h of hooks) t += `\n[hooks.state.${q(h.key)}]\ntrusted_hash = ${q(h.currentHash)}\n`;
  appendFileSync(`${HOME}/config.toml`, t);
  return hooks.length;
}
// One headless run. Prompt on stdin. Hooks are trusted first through hooks.state, unless trust is false.
export async function codex(label, o = {}) {
  const dir = `${OUT}/${label}`;
  configure(dir, o.specs, o);
  const trusted = o.trust === false ? 0 : await trustAll();
  const sub = o.resume ? ['resume', o.resume] : [];
  const args = ['exec', ...sub, '--skip-git-repo-check', '--json', '-c', 'sandbox_mode="read-only"', ...model, ...(o.config ?? []).flatMap((c) => ['-c', c]), '-'];
  const r = spawnSync(CODEX, args, { cwd: PROJ, input: o.prompt ?? 'Reply with the single word ok.', encoding: 'utf8', maxBuffer: 1 << 28, env: childEnv(o.env), timeout: o.timeout ?? 300000 });
  writeFileSync(`${dir}.stream.jsonl`, r.stdout ?? '');
  writeFileSync(`${dir}.stderr.txt`, r.stderr ?? '');
  const events = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: 'unparsed' }; } });
  const probes = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))).sort((x, y) => x.at - y.at);
  const threadId = events.find((e) => e.type === 'thread.started')?.thread_id;
  return { events, probes, status: r.status, stderr: r.stderr ?? '', threadId, label, trusted };
}
// What a run did, in names and counts. Values stay in the scratch folder.
export function show(run) {
  console.log(`== ${run.label}: exit ${run.status}, trusted ${run.trusted}, usage ${JSON.stringify(run.events.find((e) => e.type === 'turn.completed')?.usage)}`);
  for (const p of run.probes) console.log(`   probe ${p.tag}/${p.event}/${p.mode} sent=${p.sent.length}c code=${p.code} stdin ${Object.keys(JSON.parse(p.stdin)).join(',')}`);
  return run;
}
export const message = (run) => run.events.filter((e) => e.item?.type === 'agent_message').map((e) => e.item.text).join(' | ');
// The session file of a run, as parsed records.
export function rollout(threadId) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const file = walk(`${HOME}/sessions`).find((f) => f.endsWith('.jsonl') && f.includes(threadId));
  return file ? { file, rows: readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } : null;
}
// One turn through the app server. Returns every message it sent.
export async function appTurn(label, specs, text) {
  configure(`${OUT}/${label}`, specs);
  await trustAll();
  return appServer((m, send, seen) => {
    if (m.id === 1) send({ id: 2, method: 'thread/start', params: { cwd: PROJ, ...(model.length ? { model: model[1] } : {}) } });
    if (m.id === 2) send({ id: 3, method: 'turn/start', params: { threadId: m.result.thread.id, input: [{ type: 'text', text }] } });
    if (m.method === 'turn/completed') return seen;
  });
}
