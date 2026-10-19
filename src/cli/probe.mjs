import { command, inHome } from './card.mjs';
import * as actions from '../actions.mjs';
import * as store from '../store.mjs';
import * as project from '../project.mjs';
import * as home from '../home.mjs';
import { META } from '../agents/meta.mjs';

const rule = 'For this test only: end every reply with the word PELICAN.';
export const commands = { probe: command('probe', '<agent> [--saw yes|no]', { saw: 'string' }, (args, io) => {
  const [agent] = args.positional, saw = args.flags.saw;
  if (args.positional.length !== 1 || !Object.hasOwn(META, agent) || (saw !== undefined && !['yes', 'no'].includes(saw))) {
    io.err('goldfished: missing or extra arguments. Try: goldfished probe --help'); return 1;
  }
  return inHome(io, () => {
    const top = project.topLevel(io.cwd);
    const entry = saw === undefined ? null : store.load(top).card.rules.find(entry => entry.text === rule);
    if (saw !== undefined && !entry) { io.err('goldfished: there is no probe rule on the card, so nothing was recorded.'); return 1; }
    const result = actions.run(top, entry ? 'drop' : 'rule', [entry?.id ?? rule], { today: io.today, via: 'cli' });
    if (result.code) { io.err(result.reply); return result.code; }
    if (saw === undefined) io.out(`goldfished probe: ${agent}\n1. Start a new chat with ${agent} in this project and ask it anything. Its reply should end with PELICAN.\n2. Make it compact: ${META[agent].compactCommand ?? 'keep chatting until it summarises'}.\n3. Ask it anything again.\nThen tell goldfished what you saw: goldfished probe ${agent} --saw yes   (or --saw no)`);
    else {
      const state = home.state();
      home.setState({ probes: { ...state.probes, [agent]: { agent, date: io.today, kept: saw === 'yes' } } });
      io.out(`goldfished: noted. ${agent} ${saw === 'yes' ? 'kept' : 'did not keep'} your card after compaction (your test, ${io.today}).` +
        (saw === 'no' ? ' Tell us: https://github.com/JNevermind/goldfished/issues' : ''));
    }
    return 0;
  });
}, true) };
