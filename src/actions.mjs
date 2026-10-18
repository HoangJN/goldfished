import * as cardIO from './card.mjs';
import * as proposalIO from './proposals.mjs';
import * as store from './store.mjs';
import * as home from './home.mjs';
import { mask } from './mask.mjs';
import { META } from './agents/meta.mjs';

const number = n => n.toLocaleString('en-GB');
const count = (n, noun) => `${number(n)} ${noun}${n === 1 ? '' : 's'}`;
const verbs = ['goal', 'rule', 'out', 'edit', 'drop', 'restore', 'accept', 'reject', 'trust', 'list', 'card', 'off', 'on', 'help'];
const chatVerbs = ['rule', 'goal', 'out', 'list', 'drop', 'restore', 'card', 'accept', 'help', 'off', 'on'];
const entries = card => [...(card.goal ? [card.goal] : []), ...card.rules, ...card.out];
function agent(top) {
  return (home.state().projects?.[top]?.agents ?? []).filter(id => META[id]).sort((a, b) => META[a].budget - META[b].budget)[0] ?? 'claude-code';
}
function saved(top, card, id) {
  const target = agent(top), { bytes, budget } = cardIO.gauge(cardIO.parse(mask(cardIO.serialise(card), 'card')), META[target].budget);
  return `goldfished: saved ${id}. ${count(card.rules.length, 'rule')}, ${count(card.goal ? 1 : 0, 'goal')}, ${number(card.out.length)} ruled out.` +
    (bytes > budget * 0.7 ? ` The card uses ${number(bytes)} of ${number(budget)} bytes on ${target}.` : '');
}
export function run(top, verb, args, { today = new Date().toISOString().slice(0, 10), via = 'cli' } = {}) {
  const done = (reply, code = 0) => ({ reply, code });
  if (!(via === 'chat' ? chatVerbs : verbs).includes(verb)) return done(`goldfished: unknown command "${verb}". Try ${via === 'chat' ? 'gf:' : 'goldfished'} help`, 1);
  if (verb === 'help') return done('gf: goal <text>\ngf: out <label> -- <quote>\ngf: list\ngf: drop <id>\ngf: restore <id>\ngf: card\ngf: accept <pN> <label>\ngf: help\ngf: off\ngf: on');
  if (verb === 'off' || verb === 'on') {
    const state = home.state();
    home.setState({ projects: { ...state.projects, [top]: { ...state.projects?.[top], off: verb === 'off' } } });
    return done(`goldfished: re-sends are ${verb} in this project.`);
  }
  const loaded = store.load(top), { card, archive, proposals } = loaded;
  if (verb === 'list') return done(loaded.source + (loaded.source && !loaded.source.endsWith('\n') ? '\n' : '') +
    (loaded.trusted ? 'trusted on this machine' : `not trusted: ${loaded.reason}. If the card is yours, run: goldfished trust`) +
    proposals.entries.map(p => '\n' + mask(`${p.id}  "${p.quote}"  (${p.note})  from: "${p.from}"`, 'display')).join(''));
  if (verb === 'card') {
    const target = args[0] === '--agent' ? args[1] : agent(top);
    if (!META[target]) return done(`goldfished: unknown agent "${target}".`, 1);
    const { budget, rulesFile } = META[target], commit = home.state().projects?.[top]?.commit ?? false;
    const { text } = cardIO.block(card, { trusted: loaded.trusted && !(rulesFile && commit), budget, maxChars: target === 'claude-code' ? Infinity : 6000, kind: rulesFile ? 'inline' : 'resend' });
    return done(`${text}${count(Buffer.byteLength(text), 'byte')} of ${number(budget)}.`);
  }
  if (verb === 'trust') {
    try { home.trust(loaded.cardPath, cardIO.hash(loaded.source)); return done('goldfished: this card is now trusted on this machine.'); }
    catch { return done('goldfished: could not trust the card on this machine.', 1); }
  }
  if (!loaded.trusted) {
    const line = card.errors[0]?.line, next = line ? `Fix line ${line} in .goldfished/card.md, then run: goldfished trust` : 'If the card is yours, run: goldfished trust';
    return done(`goldfished: this card is not trusted on this machine (${loaded.reason}), so nothing was changed. ${next}`, 1);
  }
  let result = { card, archive, proposals }, reply;
  if (verb === 'accept' || verb === 'reject') {
    if (verb === 'accept' && !args[1]) return done(`goldfished: give it a label in your own words: goldfished accept ${args[0]} "<label>"`, 1);
    const taken = proposalIO.take(proposals, args[0]);
    if (taken.refused) return done(taken.refused, 1);
    const rule = args[1] === '--rule';
    result = verb === 'reject' ? result : cardIO.add(card, archive, rule ? 'rules' : 'out', rule ? { text: taken.proposal.quote } : { label: args[1], quote: taken.proposal.quote }, today);
    result.proposals = taken.list;
    if (!result.refused) reply = verb === 'reject' ? `goldfished: ${args[0]} rejected.` : rule ? saved(top, result.card, result.id) : `goldfished: ruled out ${result.id}.`;
  } else if (['rule', 'goal', 'out'].includes(verb)) {
    if (typeof args[0] !== 'string' || (verb === 'out' && (args[1] !== '--quote' || typeof args[2] !== 'string'))) return done('goldfished: missing arguments. Try goldfished help', 1);
    result = cardIO.add(card, archive, verb === 'rule' ? 'rules' : verb, verb === 'out' ? { label: args[0], quote: args[2] } : { text: args[0] }, today);
    if (!result.refused) reply = verb === 'rule' ? saved(top, result.card, result.id) : verb === 'out' ? `goldfished: ruled out ${result.id}.` : `goldfished: goal set (${result.id}).` + (card.goal ? ' The old goal is in .goldfished/archive.md.' : '');
  } else {
    result = verb === 'edit' ? cardIO.edit(card, archive, args[0], args[1], today) : cardIO[verb](card, archive, args[0], today);
    reply = `goldfished: ${args[0]} ${verb === 'edit' ? 'changed.' : verb === 'restore' ? 'restored.' : `dropped. Bring it back with: goldfished restore ${args[0]}`}`;
  }
  if (result.refused) {
    let refused = result.refused.replace(/\b\d{4,}\b/g, digits => number(Number(digits)));
    if (via === 'chat' && verb === 'rule') refused = refused.replace('Nothing was changed. Shorten it, in your own words.', 'It was not saved; your message was sent as usual.');
    return done(refused, 1);
  }
  const notices = entries(result.card).flatMap(({ text, label, quote, id }) => {
    const raw = text ?? `${label}. User said: "${quote}"`, hidden = (mask(raw, 'card').match(/\[hidden\]/g) ?? []).length - (raw.match(/\[hidden\]/g) ?? []).length;
    return hidden ? [`goldfished: hid ${count(hidden, 'secret')} in ${id} as [hidden].`] : [];
  });
  try {
    const { inlineUpdated } = store.save(top, { ...result, proposals: result.proposals ?? proposals });
    return done(reply + (inlineUpdated ? ` Updated ${count(inlineUpdated, 'rules file')}.` : '') + notices.map(line => '\n' + line).join(''));
  } catch {
    let unchanged = false;
    try { unchanged = store.load(top).source === loaded.source; } catch {}
    return done(unchanged ? 'goldfished: could not save the card. It is unchanged in .goldfished/card.md.' : 'goldfished: could not finish saving the card. Check .goldfished/card.md before trying again.', 1);
  }
}
