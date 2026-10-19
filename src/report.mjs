import { wrap, number, plural, per100, size, secs, date } from './wrap.mjs';
import { FISH, verdict } from './fun.mjs';
import { measurable } from './stats.mjs';

const span = a => a.span === null ? 'too few' : `${a.censored ? 'at least ' : ''}${number(a.span)}`;
const labels = { kept: 'kept', reworded: 'partly there', gone: 'not found' };
const init = 'Keep your goal and rules in front of your agent: npx goldfished init';
const columns = (cells, widths) => cells.map((c, i) => String(c).padEnd(Math.max(String(c).length + 1, widths[i] ?? 0))).join('').trimEnd();

export function text(r, { tty = false, noColor = false } = {}) {
  const lines = [], add = line => lines.push(line);
  const agents = r.agents.filter(a => a.status !== 'none');
  const a = agents.find(a => a.id === r.headlineAgent);
  if (!agents.length) return wrap(`goldfished found no sessions. It looked in: ${r.roots.join(', ')}. Point it at a folder with: goldfished retro --agent <id> --dir <path>`);
  add(`${tty && !noColor ? FISH : ''}goldfished retro   ${r.window.days ? `last ${number(r.window.days)} days` : 'all sessions'}   ${r.save ? 'writes counts only to ~/.goldfished' : 'read-only, nothing leaves this machine'}`);
  add(`read ${plural(r.files, 'file')} (${size(r.bytes)}) in ${secs(r.secs)}. not graded: ${plural(r.notGraded.auto, 'automated session')}, ${plural(r.notGraded.sub, 'subagent file')}`);
  add('');
  if (agents.every(a => !a.compacted && a.status !== 'drift')) {
    add(`${plural(agents.reduce((n, a) => n + (a.sessions ?? 0), 0), 'session')} read, none compacted yet. Nothing has been lost yet.`);
    if (!r.cardTrusted) add(init);
    return wrap(lines.join('\n'));
  }
  for (const d of agents.filter(a => a.status === 'drift')) add(`format drift in ${d.id}: goldfished read ${plural(d.drift.files, 'file')} but could not understand ${plural(d.drift.unread, 'compaction record')}, so its numbers are not shown. Run goldfished shapes --agent ${d.id} and paste the output (counts only) into an issue.`);
  if (a && a.status !== 'drift' && a.status !== 'not_recorded') {
    if (a.headline) {
      add(`Memory span: ${a.span === null ? 'too few compactions to say yet' : `${a.censored ? 'at least ' : ''}${plural(a.span, 'compaction')}${a.censored ? ' so far' : ''}`}`);
      const h = a.headline;
      add(`${number(h.keptPer100)} in 100 of your messages were still in front of the agent after ${plural(h.age, 'compaction')}`);
      add(`(95% range ${number(h.ci95[0])} to ${number(h.ci95[1])}), ${plural(h.messages, 'message')}, ${plural(h.sessions, 'session')}, ${a.id}, ${date(a.firstMs)} to ${date(a.lastMs)}.`);
    } else {
      const last = [...a.curve].filter(row => row.messages).sort((x, y) => y.age - x.age)[0];
      if (last) add(`Too few to give a rate yet: ${number(last.kept)} of ${plural(last.messages, 'message')} (${plural(last.sessions, 'session')}) were still there after ${plural(last.age, 'compaction')}.`);
    }
    add((a.verdict ?? verdict(a)).line);
    if (r.history?.[a.id]) add(`Span last time (${date(r.history[a.id].date)}): ${span(r.history[a.id])}. Now: ${span(a)}.`);
    if (a.card) add(a.card.keptPer100 === null ? `${plural(a.card.sessions, 'session')} had the card re-sent after compaction; they are counted apart.` : `With the card re-sent after compaction (${plural(a.card.sessions, 'session')}): ${number(a.card.keptPer100)} in 100 kept after ${plural(a.card.age, 'compaction')}.`);
    add('This counts your words in what the agent can still see (the summary and the recent messages it keeps), not whether it still acted on them.');
    add('');
  }
  if (agents.length >= 2) {
    const k = a?.headlineAge ?? 1, widths = [14, 11, 12, 11, 15];
    add(columns(['agent', 'sessions', 'compacted', 'messages', 'memory span', `kept after ${number(k)}`], widths));
    for (const b of [...agents].sort((x, y) => (y.messages ?? 0) - (x.messages ?? 0))) {
      const row = b.curve.find(row => row.age === k);
      add(columns(b.status === 'drift' || b.status === 'not_recorded' ? [b.id, b.status === 'drift' ? 'format drift' : 'not recorded'] : [b.id, number(b.sessions), number(b.compacted), number(b.messages), span(b), row && measurable(row) ? `${per100(row.kept, row.messages)} in 100` : 'too few'], widths));
    }
    add('Agents compact differently and you use them differently. This compares your');
    add('sessions, not the tools.');
  }
  if (r.probes.length) add(`Your own probes: ${r.probes.map(p => `${p.agent} ${p.kept ? 'kept the card' : 'did not'} (${date(p.date)})`).join('; ')}.`);
  if (a && !['drift', 'not_recorded'].includes(a.status)) {
    if (lines.at(-1) !== '') add('');
    add(`${a.id}, by times compacted`);
    add(columns(['times compacted', 'your messages', 'kept', 'partly there', 'not found'], [18, 16, 7, 15]));
    const highest = Math.max(0, ...a.curve.filter(row => row.messages).map(row => row.age));
    for (const row of a.curve.filter(row => row.age <= highest).sort((x, y) => x.age - y.age)) add(columns([number(row.age), number(row.messages), ...['kept', 'reworded', 'gone'].map(key => measurable(row) ? `${per100(row[key], row.messages)}%` : 'too few')], [18, 16, 7, 15]));
    add('(each row counts the messages that went through exactly that many compactions)');
    if (a.composition) add(`Same messages throughout: kept after 1 / 2 / 3 = ${[1, 2, 3].map(age => { const row = a.composition.find(row => row.age === age); return per100(row.kept, row.messages); }).join(' / ')} in 100.`);
    add('');
    add(`not counted: ${plural(a.notCounted.short, 'short reply', 'short replies')} under 20 characters, ${plural(a.notCounted.pasted, 'paste')} over 1,500 characters`);
    if (a.note) add(a.note);
  }
  if (agents.some(a => a.id === 'claude-code')) add('Claude Code deletes session files after 30 days by default, so older sessions are not here.');
  if (!r.cardTrusted) add(init);
  for (const s of r.show ?? []) add(`  [${s.agent} ${s.project} age ${number(s.age)}] ${s.text}`);
  for (const s of r.audit ?? []) {
    add(`  [${s.agent} ${s.project} age ${number(s.age)}] ${labels[s.label]} (score ${s.score.toFixed(2)})`);
    add(`    you: ${s.you}`);
    add(`    summary: ${s.summary}`);
  }
  return wrap(lines.join('\n'));
}

const isoDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rows = curve => curve?.map(({ age, messages, sessions, kept, reworded, gone }) => ({ age, messages, sessions, kept, reworded, gone })) ?? null;
export function json(r) {
  const a = r.agents.find(a => a.id === r.headlineAgent), h = a?.headline;
  return {
    schema: 1, tool_version: r.toolVersion, grader: r.grader ? { id: r.grader.id, threshold: r.grader.threshold } : null,
    window: { days: r.window.days, from: isoDate(r.window.fromMs), to: isoDate(r.window.toMs) },
    headline: h ? { agent: a.id, age: h.age, kept_per_100: h.keptPer100, ci95: [...h.ci95], messages: h.messages, sessions: h.sessions } : null,
    agents: r.agents.filter(a => a.status !== 'none').map(a => {
      const hidden = ['not_recorded', 'drift'].includes(a.status);
      return { id: a.id, status: a.status, sessions: hidden ? null : a.sessions, compacted: hidden ? null : a.compacted, messages: hidden ? null : a.messages,
        span: hidden ? null : a.span, span_censored: hidden ? null : a.censored, verdict: hidden || a.status === 'too_few' ? null : (a.verdict ?? verdict(a)).id,
        curve: hidden ? [] : rows(a.curve), composition: hidden ? null : rows(a.composition), not_counted: hidden ? null : { short: a.notCounted.short, pasted: a.notCounted.pasted },
        drift: a.drift ? { files: a.drift.files, unread: a.drift.unread } : null,
        card: hidden || !a.card ? null : { sessions: a.card.sessions, age: a.card.age, kept_per_100: a.card.keptPer100 } };
    }),
    span_rule: 'largest k with every age 1..k measurable and at 50 or more kept per 100; measurable = 50 messages from 10 sessions',
  };
}
