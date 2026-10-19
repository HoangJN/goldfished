import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { command, inHome } from './card.mjs';
import { hookStep, hookIO, codexFile, codexHooks, readHooks, hasHooks } from './misc.mjs';
import * as pointer from '../pointer.mjs';
import * as store from '../store.mjs';
import * as project from '../project.mjs';
import * as home from '../home.mjs';
import { parse, serialise, hash, add, block } from '../card.mjs';
import { isTracked } from '../git.mjs';
import { POINTERS, detect } from '../agents/pointers.mjs';
import { META } from '../agents/meta.mjs';

const read = file => {
  try { return readFileSync(file, 'utf8'); }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null; throw error; }
};
const diff = (io, path, before, after) => {
  if (before === after) return;
  const lines = text => text?.match(/[^\n]*\n|[^\n]+$/gu) ?? [], previous = lines(before), next = lines(after);
  let leading = 0, trailing = 0;
  while (leading < Math.min(previous.length, next.length) && previous[leading] === next[leading]) leading++;
  while (trailing < Math.min(previous.length, next.length) - leading && previous.at(-1 - trailing) === next.at(-1 - trailing)) trailing++;
  const show = (rows, sign) => rows.flatMap(line => [sign + line.replace(/\n$/u, ''), ...(!line.endsWith('\n') ? ['\\ No newline at end of file'] : [])]);
  io.out(`--- ${before === null ? '/dev/null' : path}\n+++ ${after === null ? '/dev/null' : path}\n@@ -${before ? 1 : 0},${previous.length} +${after ? 1 : 0},${next.length} @@\n` +
    [...show(previous.slice(0, leading), ' '), ...show(previous.slice(leading, previous.length - trailing), '-'),
      ...show(next.slice(leading, next.length - trailing), '+'), ...show(previous.slice(previous.length - trailing), ' ')].join('\n'));
};
async function question(io, prompt) {
  if (io.question) return io.question(prompt);
  io.out(prompt);
  const terminal = createInterface({ input: process.stdin });
  try { return await terminal.question(''); } finally { terminal.close(); }
}
const yes = async (io, flags) => !flags['dry-run'] && (flags.yes || (io.isTTY && await question(io, 'Apply this plan? [y/N] ') === 'y'));
async function installHook(agent, io, flags) {
  const steps = hookStep(agent, io), show = () => { io.out('To bring the card back after compaction, run:'); steps.forEach(io.out); };
  if (!steps.length) return;
  const offer = flags['install-hook'] || (io.isTTY && !flags.yes);
  if (agent === 'claude-code') {
    const listed = io.run('claude', ['plugin', 'list']);
    if (listed.status === 0 && listed.stdout.includes('goldfished@goldfished')) { io.out('Claude Code: plugin installed'); return; }
    show();
    if (!offer) return;
    if (!flags['install-hook'] && await question(io, 'Install the Claude Code hook now? [y/N] ') !== 'y') return;
    for (const args of [['plugin', 'marketplace', 'add', 'HoangJN/goldfished'], ['plugin', 'install', 'goldfished@goldfished']]) {
      const result = io.run('claude', args);
      io.out(`claude ${args.join(' ')}: ${result.error?.code === 'ENOENT' ? 'claude not found on PATH' : `exit ${result.status}`}`);
      if (result.status !== 0 || result.error) return;
    }
  } else if (agent === 'codex') {
    if (!offer) { show(); return; }
    const wanted = codexHooks(io);
    if (!wanted) { show(); return; }
    let before, data;
    try { ({ before, data } = readHooks(io)); }
    catch { io.out('Could not parse Codex hooks.json. Nothing was written.'); show(); return; }
    if (!hasHooks(data, wanted)) {
      data.hooks ??= {};
      for (const [event, rows] of Object.entries(wanted)) data.hooks[event] = [...(data.hooks[event] ?? []), ...rows.filter(row => !hasHooks(data, { [event]: [row] }))];
      const after = JSON.stringify(data, null, 2) + '\n';
      diff(io, codexFile(io), before, after);
      if (!flags['install-hook'] && await question(io, 'Add the Codex hook now? [y/N] ') !== 'y') return;
      io.write(codexFile(io), after);
    }
    io.out('Codex asks you to trust a new hook once.');
  }
}
export const commands = Object.fromEntries(['init', 'uninit'].map(name => [name,
  command(name, name === 'init' ? '[--agents <ids>] [--goal <text>] [--install-hook] [--shared] [--commit] [--yes] [--dry-run]' : '[--yes]',
    name === 'init' ? { agents: 'string', goal: 'string', 'install-hook': 'boolean', shared: 'boolean', commit: 'boolean', yes: 'boolean', 'dry-run': 'boolean' } : { yes: 'boolean' },
    async (args, io) => {
      if (args.positional.length) { io.err(`goldfished: missing or extra arguments. Try: goldfished ${name} --help`); return 1; }
      const top = project.topLevel(io.cwd), flags = args.flags;
      hookIO(io);
      io.apply ??= pointer.apply; io.save ??= store.save; io.setState ??= home.setState; io.exclude ??= project.exclude; io.isTracked ??= isTracked;
      const agents = flags.agents === undefined ? detect(path => {
        try { return statSync(join(top, path)).isDirectory() ? 'dir' : 'file'; } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error;
        }
      }) : flags.agents.split(',');
      if (agents.some(agent => agent !== 'all' && !Object.hasOwn(META, agent))) {
        io.err('goldfished: unknown agent. Try: goldfished init --help'); return 1;
      }
      const homeExists = existsSync(io.env.GOLDFISHED_HOME || join(homedir(), '.goldfished'));
      const state = homeExists ? inHome(io, () => home.state()) : {}, settings = state.projects?.[top] ?? {};
      const recorded = { ...settings.recorded }, existing = {}, tracked = {};
      for (const path of [...POINTERS.map(row => row.target), '.clinerules']) {
        const text = read(join(top, path));
        if (text !== null) existing[path] = text;
      }
      const blocks = new Set(pointer.removePlan({ top, existing, recorded }).filter(change => change.kind === 'block' && !change.left).map(change => change.path));
      for (const [path, record] of Object.entries(recorded)) if (record?.eolAdded && !blocks.has(path)) delete recorded[path];
      if (name === 'init') for (const row of POINTERS.filter(row => row.agent === 'all' || agents.includes(row.agent))) {
        const path = row.agent === 'cline' && existing['.clinerules'] !== undefined ? '.clinerules' : row.target;
        tracked[path] = io.isTracked(top, path);
      }
      const source = name === 'init' ? read(join(top, '.goldfished/card.md')) : null;
      const main = project.mainCheckout(top), copy = name === 'init' && source === null && main !== top ? read(join(main, '.goldfished/card.md')) : null;
      let card = parse(source ?? copy ?? ''), changedGoal;
      const trusted = source === null || (homeExists && inHome(io, () => store.load(top).trusted));
      if (name === 'init' && source !== null && !trusted) {
        io.out(source); io.out('This card was already here. If it is yours, run: goldfished trust');
      }
      if (name === 'init' && copy !== null) io.out('Copy the main checkout\'s card with this plan?');
      if (name === 'init') {
        const goal = flags.goal ?? (!card.goal && io.isTTY && (io.question || process.stdin.isTTY) && !flags['dry-run'] ? await question(io, 'Your goal, in a line (Enter to skip): ') : '');
        if (goal || flags.goal !== undefined) {
          if (!trusted) { io.err('goldfished: this card is not trusted. Run: goldfished trust'); return 1; }
          const loaded = inHome(io, () => store.load(top));
          changedGoal = add(card, loaded.archive, 'goal', { text: goal }, io.today);
          if (changedGoal.refused) { io.err(changedGoal.refused); return 1; }
          card = changedGoal.card;
        }
      }
      const changes = name === 'init' ? pointer.plan({ top, agents, shared: flags.shared, commit: flags.commit, existing, tracked, recorded, card, trusted })
        : pointer.removePlan({ top, existing, recorded });
      if (name === 'init' && (source === null || changedGoal)) diff(io, '.goldfished/card.md', source, serialise(card));
      for (const change of changes) {
        if (change.skipped || change.left) io.out(change.skipped ?? change.left);
        else diff(io, change.path, change.before, change.after);
      }
      const hasGit = !!project.gitDir(top);
      const exclusions = name === 'init' && hasGit ? [flags.commit ? '.goldfished/proposed.md' : '.goldfished/', ...(flags.commit ? ['.goldfished/archive.md'] : []),
        ...changes.filter(change => !change.skipped && change.before === null && change.after !== null).map(change => change.path)] : [];
      const excludeBefore = read(join(project.commonDir(top), 'info/exclude'));
      let exclude = excludeBefore;
      for (const line of exclusions) if (!(exclude ?? '').split(/\r?\n/u).includes(line)) {
        const newline = exclude?.includes('\r\n') ? '\r\n' : '\n';
        const after = (exclude ?? '') + (exclude && !exclude.endsWith('\n') ? newline : '') + line + newline;
        exclude = after;
      }
      diff(io, '<git common dir>/info/exclude', excludeBefore, exclude);
      if (name === 'init' && changes.some(change => change.path === 'CONVENTIONS.md'))
        io.out('Aider reads CONVENTIONS.md only if you start it with --read CONVENTIONS.md or add read: CONVENTIONS.md to .aider.conf.yml.');
      const showHooks = () => {
        if (name === 'init') for (const agent of new Set(agents)) {
          const steps = hookStep(agent, io);
          if (steps.length) { io.out('To bring the card back after compaction, run:'); for (const text of steps) io.out(text); }
        }
      };
      if (!await yes(io, flags)) { showHooks(); return 0; }
      const reports = io.apply(changes), failed = new Set(reports.map(report => report.path));
      for (const { left } of reports) io.out(left);
      for (const change of changes) if (!change.skipped && !change.left && !failed.has(change.path)) {
        if (name === 'uninit') delete recorded[change.path];
        else if (change.kind === 'owned') recorded[change.path] = hash(change.after);
        else if (change.eolAdded) recorded[change.path] = { hash: hash(change.after), eolAdded: true };
        else if (change.before === null) recorded[change.path] = hash(change.after);
      }
      inHome(io, () => {
        io.setState({ projects: { ...state.projects, [top]: { ...settings, agents: name === 'init' ? agents : [], commit: flags.commit ?? settings.commit, recorded } } });
        if (name === 'init' && (source === null || changedGoal)) io.save(top, { ...store.load(top), ...changedGoal, card });
      });
      for (const line of exclusions) io.exclude(top, line);
      if (name === 'init') {
        if (!hasGit) io.out('No git repository here, so nothing was added to its exclude list.');
        for (const agent of new Set(agents)) await installHook(agent, io, flags);
        const loaded = inHome(io, () => store.load(top)), count = (n, noun) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
        const { left } = block(loaded.card, { trusted: loaded.trusted, budget: Math.min(...agents.map(agent => META[agent]?.budget ?? Infinity)), kind: 'resend' });
        const receipt = (loaded.trusted ? `goldfished: card re-sent after compaction: ${count(loaded.card.goal ? 1 : 0, 'goal')}, ${count(loaded.card.rules.length, 'rule')}, ${loaded.card.out.length.toLocaleString('en-GB')} ruled out.` :
          'goldfished: card re-sent as project documentation, because it is not trusted on this machine. If it is yours, run: goldfished trust') + (left.length ? ` ${left.length.toLocaleString('en-GB')} did not fit (${left.join(' ')}).` : '');
        io.out(`Done. Test it now: type /compact in your agent. You should see: ${receipt}`);
      }
      return reports.length ? 1 : 0;
    }),
]));
