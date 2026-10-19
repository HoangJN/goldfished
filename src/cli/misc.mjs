import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, parse } from 'node:path';
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
const noArgs = (args, name) => { if (args.positional.length) throw new Error(`Unexpected arguments for ${name}.`); };
export const commands = {
  shapes: command('shapes', '[--agent <id>] [--dir <path>]', { agent: 'string', dir: 'string' }, async (args, io) => {
    noArgs(args, 'shapes');
    const { cwd: directory } = io;
    if (args.flags.dir && (!args.flags.agent || args.flags.agent === 'all')) {
      io.err('goldfished: --dir needs --agent, because each agent keeps its files somewhere different.'); return 1;
    }
    const chosen = adapters.filter(adapter => !args.flags.agent || args.flags.agent === 'all' || adapter.id === args.flags.agent);
    if (!chosen.length) { io.err(`goldfished: unknown agent "${args.flags.agent}".`); return 1; }
    for (const adapter of chosen) {
      const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
      const roots = args.flags.dir ? [resolve(directory, args.flags.dir)] : adapter.roots(io.env, homedir());
      const files = (await Promise.all(roots.map(root => adapter.listFiles(root, {})))).flat();
      let compactions = 0;
      for await (const session of adapter.sessions(files, tally)) compactions += session.compactions.length;
      io.out(JSON.stringify({ agent: adapter.id, ...tally, types: Object.fromEntries([...tally.types].sort()),
        rejects: Object.fromEntries([...tally.rejects].sort()), compactions, drift: adapter.driftCheck(tally),
        lineBuckets: Array.from(tally.lineBuckets, (count, power) => ({ power, count: count ?? 0 })) }, null, 2));
    }
    return 0;
  }),
  doctor: command('doctor', '', {}, (args, io) => {
    noArgs(args, 'doctor');
    const { cwd: directory } = io, { version: nodeVersion } = process;
    const top = project.topLevel(directory), dir = homePath(io);
    io.out(`Node: ${nodeVersion}\nNode path: ${process.execPath}\ngoldfished home: ${dir}`);
    io.out(`Agents: ${adapters.filter(adapter => adapter.roots(io.env, homedir()).some(existsSync)).map(adapter => adapter.id).join(', ') || 'none'}`);
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
    if (agent === 'claude-code' && ['P1', 'P3', 'P5', 'P6', 'P6-auto', 'P10'].every(key => claude[key]))
      io.out('claude plugin marketplace add HoangJN/goldfished\nclaude plugin install goldfished@goldfished');
    else if (agent === 'codex' && codex.CX1 && codex.CX2) {
      const launcher = fileURLToPath(new URL('../../hooks/run.mjs', import.meta.url)).replaceAll('\\', '/');
      const hook = event => ({ type: 'command', command: `node "${launcher}" codex ${event}` });
      io.out('npm install -g goldfished\nPut these entries in your Codex home\'s hooks.json.\nCodex asks you to trust a new hook once.');
      io.out(JSON.stringify({ hooks: { SessionStart: [{ matcher: 'compact', hooks: [hook('session-start')] }], UserPromptSubmit: [{ hooks: [hook('prompt')] }] } }, null, 2));
    } else io.out(`goldfished: ${agent} has no hook goldfished can use yet. ${META[agent].rulesFile ? 'init gives it an inline rules file' : 'init gives it a pointer to the card'}. Check what it receives with: goldfished card --agent ${agent}`);
    return 0;
  }),
};
