import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { command, inHome } from './card.mjs';
import { hookStep } from './misc.mjs';
import * as pointer from '../pointer.mjs';
import * as store from '../store.mjs';
import * as project from '../project.mjs';
import * as home from '../home.mjs';
import { parse, serialise, hash } from '../card.mjs';
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
async function yes(io, flags) {
  if (flags['dry-run']) return false;
  if (flags.yes) return true;
  if (!io.isTTY) return false;
  const prompt = 'Apply this plan? [y/N] ';
  if (io.question) return (await io.question(prompt)) === 'y';
  io.out(prompt);
  const terminal = createInterface({ input: process.stdin });
  try { return (await terminal.question('')) === 'y'; } finally { terminal.close(); }
}
export const commands = Object.fromEntries(['init', 'uninit'].map(name => [name,
  command(name, name === 'init' ? '[--agents <ids>] [--shared] [--commit] [--yes] [--dry-run]' : '[--yes]',
    name === 'init' ? { agents: 'string', shared: 'boolean', commit: 'boolean', yes: 'boolean', 'dry-run': 'boolean' } : { yes: 'boolean' },
    async (args, io) => {
      if (args.positional.length) { io.err(`goldfished: missing or extra arguments. Try: goldfished ${name} --help`); return 1; }
      const top = project.topLevel(io.cwd), flags = args.flags;
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
        tracked[path] = isTracked(top, path);
      }
      const source = name === 'init' ? read(join(top, '.goldfished/card.md')) : null;
      const main = project.mainCheckout(top), copy = name === 'init' && source === null && main !== top ? read(join(main, '.goldfished/card.md')) : null;
      const card = parse(source ?? copy ?? '');
      const trusted = source === null || (homeExists && inHome(io, () => store.load(top).trusted));
      if (name === 'init' && source !== null && !trusted) {
        io.out(source); io.out('This card was already here. If it is yours, run: goldfished trust');
      }
      if (name === 'init' && copy !== null) io.out('Copy the main checkout\'s card with this plan?');
      const changes = name === 'init' ? pointer.plan({ top, agents, shared: flags.shared, commit: flags.commit, existing, tracked, recorded, card, trusted })
        : pointer.removePlan({ top, existing, recorded });
      if (name === 'init' && source === null) diff(io, '.goldfished/card.md', null, serialise(card));
      for (const change of changes) {
        if (change.skipped || change.left) io.out(change.skipped ?? change.left);
        else diff(io, change.path, change.before, change.after);
      }
      const exclusions = name === 'init' ? [flags.commit ? '.goldfished/proposed.md' : '.goldfished/', ...(flags.commit ? ['.goldfished/archive.md'] : []),
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
          const steps = hookStep(agent);
          if (steps.length) { io.out('To bring the card back after compaction, run:'); for (const text of steps) io.out(text); }
        }
      };
      if (!await yes(io, flags)) { if (flags['dry-run']) showHooks(); return 0; }
      const reports = pointer.apply(changes), failed = new Set(reports.map(report => report.path));
      for (const { left } of reports) io.out(left);
      for (const change of changes) if (!change.skipped && !change.left && !failed.has(change.path)) {
        if (name === 'uninit') delete recorded[change.path];
        else if (change.kind === 'owned') recorded[change.path] = hash(change.after);
        else if (change.eolAdded) recorded[change.path] = { hash: hash(change.after), eolAdded: true };
        else if (change.before === null) recorded[change.path] = hash(change.after);
      }
      inHome(io, () => {
        home.setState({ projects: { ...state.projects, [top]: { ...settings, agents: name === 'init' ? agents : [], commit: flags.commit ?? settings.commit, recorded } } });
        if (name === 'init' && source === null) store.save(top, { ...store.load(top), card });
      });
      for (const line of exclusions) project.exclude(top, line);
      showHooks();
      return reports.length ? 1 : 0;
    }),
]));
