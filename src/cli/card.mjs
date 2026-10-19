import { homedir } from 'node:os';
import * as actions from '../actions.mjs';
import * as project from '../project.mjs';
import * as store from '../store.mjs';
import * as proposals from '../proposals.mjs';
import { adapters } from '../agents/index.mjs';

export function inHome(io, fn) {
  const previous = process.env.GOLDFISHED_HOME;
  try {
    if (io.env.GOLDFISHED_HOME === undefined) delete process.env.GOLDFISHED_HOME;
    else process.env.GOLDFISHED_HOME = io.env.GOLDFISHED_HOME;
    return fn();
  } finally {
    if (previous === undefined) delete process.env.GOLDFISHED_HOME;
    else process.env.GOLDFISHED_HOME = previous;
  }
}
export function command(name, usage, flags, fn, terminal = false) {
  return async (args, io) => {
    const fail = text => { io.err(text); return 1; };
    if (args.flags.help === true) { io.out(`goldfished ${name}${usage ? ` ${usage}` : ''}`); return 0; }
    if (terminal && !io.isTTY) return fail("goldfished: this changes the user's card, so it only runs in a terminal the user is typing in. Agents: use goldfished propose." +
      (io.env.MSYSTEM ? ` In Git Bash, run it as: winpty goldfished ${name}, or use PowerShell or Windows Terminal.` : ''));
    for (const [key, value] of Object.entries(args.flags)) {
      if (!Object.hasOwn(flags, key)) return fail(`goldfished: unknown flag --${key}. Try: goldfished ${name} --help`);
      if (typeof value !== flags[key]) return fail(`goldfished: invalid --${key}. Try: goldfished ${name} --help`);
    }
    try { return await fn(args, io); }
    catch (error) {
      const code = fail(`goldfished: could not run ${name}. Check your files and try again.`);
      if (io.env.GOLDFISHED_DEBUG === '1') io.err(error?.stack ?? String(error));
      return code;
    }
  };
}
const definitions = {
  goal: ['"<text>"', {}, 1], rule: ['"<text>"', {}, 1], out: ['"<label>" --quote "<words>"', { quote: 'string' }, 1],
  edit: ['<id> "<text>"', {}, 2], drop: ['<id>', {}, 1], restore: ['<id>', {}, 1],
  list: ['', {}, 0], card: ['[--agent <id>]', { agent: 'string' }, 0],
  accept: ['<pN> ["<label>"|--rule]', { rule: 'boolean' }, [1, 2]], reject: ['<pN>', {}, 1], trust: ['', {}, 0],
};
export const commands = Object.fromEntries(Object.entries(definitions).map(([name, [usage, flags, arity]]) => [name,
  command(name, usage, flags, (args, io) => {
    const count = args.positional.length, valid = Array.isArray(arity) ? arity.includes(count) : count === arity;
    if (!valid || (name === 'out' && !args.flags.quote) || (name === 'accept' && args.flags.rule && count !== 1)) {
      io.err(`goldfished: missing or extra arguments. Try: goldfished ${name} --help`); return 1;
    }
    const values = [...args.positional];
    if (name === 'out') values.push('--quote', args.flags.quote);
    if (name === 'card' && args.flags.agent) values.push('--agent', args.flags.agent);
    if (name === 'accept' && args.flags.rule) values.push('--rule');
    const { cwd: directory } = io;
    const { code, reply } = inHome(io, () => actions.run(project.topLevel(directory), name, values, { today: io.today, via: 'cli' }));
    io[code ? 'err' : 'out'](reply); return code;
  }, !['list', 'card'].includes(name)),
]));
const normal = text => text.trim().replace(/\s+/gu, ' ').toLowerCase();
commands.propose = command('propose', '--quote "<words>" --note "<why>"', { quote: 'string', note: 'string' }, async (args, io) => {
  const { quote, note } = args.flags;
  if (args.positional.length || quote === undefined || note === undefined) {
    io.err('goldfished: missing or extra arguments. Try: goldfished propose --help'); return 1;
  }
  const { cwd: directory } = io;
  const top = project.topLevel(directory), typed = await Promise.all(adapters.map(adapter =>
    adapter.findTyped(top, adapter.roots(io.env, homedir()), { sinceMs: io.nowMs - 2 * 86400000 })));
  if (typed.every(messages => messages === null)) {
    io.err('goldfished: cannot check quotes on this agent, so nothing was saved. Ask the user to run: goldfished out "<label>" --quote "<their words>"'); return 1;
  }
  const q = normal(quote), sentence = text => normal(text).replace(/[.!?]+$/u, '');
  const from = typed.flatMap(messages => messages ?? []).find(text =>
    normal(text) === q || text.split(/[.!?\r\n]+/u).some(part => normal(part) && normal(part) === sentence(quote)));
  if (Array.from(quote).length < 12 || q.split(' ').length < 3 || from === undefined) {
    io.err('goldfished: that quote is not something the user typed in this project in the last two days, so it was not saved.'); return 1;
  }
  const result = inHome(io, () => {
    const loaded = store.load(top);
    if (!loaded.trusted) {
      const line = loaded.card.errors[0]?.line;
      return { refused: `goldfished: this card is not trusted on this machine (${loaded.reason}), so nothing was changed. ` +
        (line ? `Fix line ${line} in .goldfished/card.md, then run: goldfished trust` : 'If the card is yours, run: goldfished trust') };
    }
    const added = proposals.add(loaded.proposals, { quote, note, from });
    store.save(top, { ...loaded, proposals: added.list }); return added;
  });
  if (result.refused) { io.err(result.refused); return 1; }
  io.out(`goldfished: proposed ${result.id}. The user can accept it with: goldfished accept ${result.id} "<label>"`); return 0;
});
