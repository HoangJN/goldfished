import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { run } from '../git.mjs';
import { homedir } from 'node:os';
import { join, resolve, parse, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { command, inHome } from './card.mjs';
import { adapters } from '../agents/index.mjs';
import { META } from '../agents/meta.mjs';
import { proved as claude } from '../agents/claude-code.hookio.mjs';
import { proved as codex } from '../agents/codex.hookio.mjs';
import * as home from '../home.mjs';
import * as store from '../store.mjs';
import * as project from '../project.mjs';
import * as pointer from '../pointer.mjs';

const homePath = io => resolve(io.env.GOLDFISHED_HOME || join(homedir(), '.goldfished'));
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const pick = id => adapters.filter(adapter => !id || id === 'all' || adapter.id === id);
const REASONS = new Set(['not_user', 'summary', 'meta', 'tool_result', 'wrapper', 'origin_sdk', 'origin_sdk_legacy']);
async function read(adapter, roots, sinceMs) {
  const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
  const files = (await Promise.all(roots.map(root => adapter.listFiles(root, { sinceMs })))).flat();
  let compactions = 0;
  for await (const session of adapter.sessions(files, tally)) compactions += session.compactions.length;
  const known = new Map();
  for (const [reason, count] of tally.rejects) { const word = REASONS.has(reason) ? reason : 'other'; known.set(word, (known.get(word) ?? 0) + count); }
  tally.rejects = known;
  return { tally, compactions };
}
const noArgs = (args, name) => { if (args.positional.length) throw new Error(`Unexpected arguments for ${name}.`); };
export function hookIO(io) {
  io.run ??= (program, args) => run(program, args, { cwd: io.cwd, env: { ...process.env, ...io.env } });
  io.read ??= file => { try { return readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  io.write ??= (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  io.launcher ??= fileURLToPath(new URL('../../hooks/run.mjs', import.meta.url)).replaceAll('\\', '/');
  return io;
}
export const codexFile = io => join(io.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json');
export function codexHooks(io) {
  if (io.launcher.includes('_npx')) return null;
  const hook = event => ({ type: 'command', command: `node "${io.launcher}" codex ${event}` });
  return { SessionStart: [{ matcher: 'compact', hooks: [hook('session-start')] }], UserPromptSubmit: [{ hooks: [hook('prompt')] }] };
}
export function readHooks(io) {
  const before = io.read(codexFile(io)), data = before === null ? {} : JSON.parse(before);
  if (!data || Array.isArray(data) || typeof data !== 'object' || (data.hooks !== undefined && (!data.hooks || Array.isArray(data.hooks) || typeof data.hooks !== 'object')) ||
    Object.values(data.hooks ?? {}).some(rows => !Array.isArray(rows))) throw new SyntaxError('Invalid hooks.json.');
  return { before, data };
}
export const hasHooks = (data, wanted) => !!wanted && Object.entries(wanted).every(([event, rows]) => rows.every(row => data.hooks?.[event]?.some(item => item?.matcher === row.matcher && row.hooks.every(hook => item.hooks?.some(other => other?.type === hook.type && other.command === hook.command)))));
export function hookStep(agent, io = {}) {
  if (agent === 'claude-code' && ['P1', 'P3', 'P5', 'P6', 'P6-auto', 'P10'].every(key => claude[key]))
    return ['claude plugin marketplace add HoangJN/goldfished\nclaude plugin install goldfished@goldfished'];
  if (agent === 'codex' && codex.CX1 && codex.CX2) {
    const hooks = codexHooks(hookIO(io));
    if (!hooks) return ['The npx copy is temporary. Install a stable copy for the Codex hook:\nnpm install -g goldfished\ngoldfished init'];
    return ['npm install -g goldfished\nPut these entries in your Codex home\'s hooks.json.\nCodex asks you to trust a new hook once.',
      JSON.stringify({ hooks }, null, 2)];
  }
  return [];
}
export const commands = {
  shapes: command('shapes', '[--agent <id>] [--dir <path>]', { agent: 'string', dir: 'string' }, async (args, io) => {
    noArgs(args, 'shapes');
    const { cwd: directory } = io;
    if (args.flags.dir && (!args.flags.agent || args.flags.agent === 'all')) {
      io.err('goldfished: --dir needs --agent, because each agent keeps its files somewhere different.'); return 1;
    }
    const chosen = pick(args.flags.agent);
    if (!chosen.length) { io.err(`goldfished: unknown agent "${args.flags.agent}".`); return 1; }
    for (const adapter of chosen) {
      const roots = args.flags.dir ? [resolve(directory, args.flags.dir)] : adapter.roots(io.env, homedir());
      const { tally, compactions } = await read(adapter, roots, 0);
      io.out(JSON.stringify({ agent: adapter.id, ...tally, types: Object.fromEntries([...tally.types].sort()),
        rejects: Object.fromEntries([...tally.rejects].sort()), compactions, drift: adapter.driftCheck(tally),
        lineBuckets: Array.from(tally.lineBuckets, (count, power) => ({ power, count: count ?? 0 })) }, null, 2));
    }
    return 0;
  }),
  bug: command('bug', '[--agent <id>]', { agent: 'string' }, async (args, io) => {
    noArgs(args, 'bug');
    const chosen = pick(args.flags.agent);
    if (!chosen.length) { io.err(`goldfished: unknown agent "${args.flags.agent}".`); return 1; }
    const lines = ['goldfished bug report (counts only)', `goldfished ${version}`, `node ${process.versions.node.split('.')[0]}`,
      `platform ${process.platform} ${process.arch}`];
    for (const adapter of chosen) {
      const roots = adapter.roots(io.env, homedir());
      if (!roots.some(existsSync)) { lines.push(`${adapter.id}: no folder`); continue; }
      const { tally } = await read(adapter, roots, io.nowMs - 30 * 86400000);
      const rejects = [...tally.rejects].sort(([a], [b]) => (a < b ? -1 : 1)).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none';
      lines.push(`${adapter.id}: files ${tally.files}, compaction records understood ${tally.understood} of ${tally.compactLike}, ` +
        `malformed lines ${tally.malformed}, drift ${adapter.driftCheck(tally).ok ? 'no' : 'yes'}, rejects ${rejects}`);
    }
    const [card, probes] = inHome(io, () => {
      const top = project.topLevel(io.cwd), loaded = store.load(top), state = home.state(), list = state.projects?.[top]?.probes ?? state.probes ?? {};
      return [!existsSync(loaded.cardPath) ? 'none' : loaded.trusted ? 'trusted' : 'not trusted',
        Object.entries(list).filter(([key, probe]) => META[probe.agent ?? key] && typeof probe.kept === 'boolean').length];
    });
    io.out([...lines, `card: ${card}`, `probe results: ${probes}`, 'Paste this into a new issue: https://github.com/HoangJN/goldfished/issues/new/choose'].join('\n'));
    return 0;
  }),
  doctor: command('doctor', '', {}, (args, io) => {
    noArgs(args, 'doctor');
    const { cwd: directory } = io, { version: nodeVersion } = process;
    const top = project.topLevel(directory), dir = homePath(io);
    io.out(`Node: ${nodeVersion}\nNode path: ${process.execPath}\ngoldfished home: ${dir}`);
    io.out(`Agents: ${adapters.filter(adapter => adapter.roots(io.env, homedir()).some(existsSync)).map(adapter => adapter.id).join(', ') || 'none'}`);
    hookIO(io);
    const node = io.run('node', ['-p', 'process.execPath']), plugin = io.run('claude', ['plugin', 'list']);
    io.out(node.status === 0 ? `Hook node on PATH: ${node.stdout.trim()}` : 'node not found on PATH: the hook will not run');
    io.out(`Claude Code: ${plugin.error?.code === 'ENOENT' ? 'could not check' : plugin.status === 0 && plugin.stdout.includes('goldfished@goldfished') ? 'plugin installed' : 'plugin not found'}`);
    try {
      const data = readHooks(io).data;
      const launcher = data.hooks?.SessionStart?.flatMap(row => row?.hooks ?? []).map(hook => /^node "(.+\/hooks\/run\.mjs)" codex session-start$/u.exec(hook?.command)).find(Boolean)?.[1] ?? io.launcher;
      io.out(`Codex: ${hasHooks(data, codexHooks({ launcher })) ? 'hook entries present' : 'missing'}`);
    }
    catch { io.out('Codex: could not check hooks.json'); }
    io.out('Codex runs it only after you trust it once.');
    io.out('goldfished cannot read Codex trust state without starting Codex.');
    return inHome(io, () => {
      const loaded = store.load(top), state = home.state(), settings = state.projects?.[top] ?? {};
      io.out(`Card: ${!existsSync(loaded.cardPath) ? 'none' : loaded.trusted ? 'trusted' : `not trusted: ${loaded.reason}`}`);
      for (const error of loaded.card.errors) io.out(`Parse error on line ${error.line}.`);
      const planArgs = { top, agents: settings.agents ?? [], shared: true, commit: settings.commit ?? false,
        existing: {}, tracked: {}, recorded: settings.recorded ?? {}, card: loaded.card, trusted: loaded.trusted };
      for (const path of ['.clinerules', ...pointer.plan(planArgs).map(change => change.path)]) {
        const file = join(top, path);
        if (existsSync(file) && statSync(file).isFile()) planArgs.existing[path] = readFileSync(file, 'utf8');
      }
      for (const change of pointer.plan(planArgs)) {
        const file = join(top, change.path), current = !change.skipped && change.before === change.after;
        io.out(`Pointer ${change.path}: ${!existsSync(file) ? 'missing' : current ? 'current' : 'changed'}`);
      }
      const probes = settings.probes ?? state.probes ?? {};
      for (const [key, probe] of Object.entries(probes)) {
        const agent = probe.agent ?? key;
        if (META[agent] && /^\d{4}-\d{2}-\d{2}$/u.test(probe.date) && typeof probe.kept === 'boolean')
          io.out(`Probe ${agent}: ${probe.date}, ${probe.kept ? 'kept' : 'not kept'}`);
      }
      if (!Object.keys(probes).length) io.out('Probes: none');
      return 0;
    });
  }),
  purge: command('purge', '[--yes]', { yes: 'boolean' }, async (args, io) => {
    noArgs(args, 'purge');
    io.out('This forgets which cards you trusted. Every card becomes untrusted until you run goldfished trust in its project.');
    if (!args.flags.yes) {
      if (!io.isTTY) { io.err('goldfished: purge needs --yes or a typed y in a terminal.'); return 1; }
      io.out('Delete the goldfished home? Type y:');
      const reader = createInterface({ input: process.stdin });
      try { if ((await reader.question('')).trim().toLowerCase() !== 'y') { io.err('goldfished: purge cancelled. Nothing was deleted.'); return 1; } }
      finally { reader.close(); }
    }
    const dir = homePath(io);
    if (dir === parse(dir).root) throw new Error('Refusing a filesystem root.');
    rmSync(dir, { recursive: true, force: true }); io.out('goldfished: home deleted.'); return 0;
  }),
  hooks: command('hooks', '<agent>', {}, (args, io) => {
    const [agent] = args.positional;
    if (args.positional.length !== 1 || !META[agent]) { io.err('goldfished: give a known agent. Try: goldfished hooks --help'); return 1; }
    const steps = hookStep(agent, io);
    if (steps.length) for (const text of steps) io.out(text);
    else io.out(`goldfished: ${agent} has no hook goldfished can use yet. ${META[agent].rulesFile ? 'init gives it an inline rules file' : 'init gives it a pointer to the card'}. Check what it receives with: goldfished card --agent ${agent}`);
    return 0;
  }),
};
