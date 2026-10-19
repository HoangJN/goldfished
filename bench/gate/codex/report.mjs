#!/usr/bin/env node
// Builds bench/proof/results/decay-codex.md from the session results. Usage: node report.mjs <freeze sha> <date>
// Needs GFGATE_MODEL for the header line. Usage totals come from the state files in GFGATE_ROOT.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GFGATE_ROOT ?? 'D:/Dev/gf-scratch/B19x';
const [freeze, date] = process.argv.slice(2);
const sessions = [1, 2, 3].map((n) => join(here, 'results', `session-${n}.json`)).filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const PAIRS = [['g1', 'c1', 12], ['r2', 'w1', 23], ['x1', 'w2', 37], ['r4', 'w3', 52]];
const pick = (a, mode) => (mode === 'rule' ? a.anchor ?? a.floor : mode === 'floor' ? a.floor : a.anchor);
const L = (x) => (x ? x[0].toUpperCase() : '');
const inWindow = (r) => r.k >= 10 && r.k <= 20;

function loses(s, mode) {
  const bad = [];
  for (let i = 0; i + 1 < s.compactions.length; i++) {
    const [p, q] = [s.compactions[i], s.compactions[i + 1]];
    if (!inWindow(p) || !inWindow(q)) continue;
    for (const [id, a] of Object.entries(p.atoms)) {
      const b = q.atoms[id];
      if (a.live && b?.live && pick(a, mode) && pick(b, mode) && pick(a, mode) !== 'kept' && pick(b, mode) !== 'kept') bad.push(`${id} at k ${p.k} and ${q.k}`);
    }
  }
  return bad;
}

function byAge(ss, mode) {
  const rows = {};
  for (const s of ss) {
    const first = {};
    for (const r of s.compactions) for (const [id, a] of Object.entries(r.atoms)) {
      if (!a.live) continue;
      first[id] ??= r.k;
      const label = pick(a, mode);
      if (!label) continue;
      const age = r.k - first[id] + 1;
      const row = (rows[age] ??= { kept: 0, reworded: 0, gone: 0 });
      row[label]++;
    }
  }
  const out = ['| age | kept | reworded | gone |', '| --- | --- | --- | --- |'];
  for (const age of Object.keys(rows).map(Number).sort((x, y) => x - y)) out.push(`| ${age} | ${rows[age].kept} | ${rows[age].reworded} | ${rows[age].gone} |`);
  return out.join('\n');
}

function grid(s) {
  const ids = [...new Set(s.compactions.flatMap((r) => Object.keys(r.atoms)))];
  const out = [`| k | turn | ${ids.join(' | ')} |`, `| --- | --- | ${ids.map(() => '---').join(' | ')} |`];
  for (const r of s.compactions) out.push(`| ${r.k} | ${r.turn} | ${ids.map((id) => { const a = r.atoms[id]; return a?.live ? L(pick(a, 'rule')) + (a.anchor ? '*' : '') : ''; }).join(' | ')} |`);
  return out.join('\n');
}

function stale(s) {
  return PAIRS.map(([old, now, at]) => {
    const ks = s.compactions.filter((r) => r.turn > at && pick(r.atoms[old], 'rule') === 'kept' && pick(r.atoms[now], 'rule') !== 'kept').map((r) => r.k);
    return `${old} with ${now}: ${ks.length ? `carried at k ${ks.join(', ')}` : 'not carried'}`;
  }).join('; ');
}

function versus(s) {
  const rows = s.compactions.filter((r) => Object.values(r.atoms).some((a) => a.anchor));
  return rows.map((r) => {
    const live = Object.entries(r.atoms).filter(([, a]) => a.live);
    const f = live.filter(([, a]) => a.floor === 'kept').length, a = live.filter(([, x]) => x.anchor === 'kept').length;
    const lostByAnchor = live.filter(([, x]) => x.floor === 'kept' && x.anchor !== 'kept').map(([id]) => id);
    const savedBySummary = live.filter(([, x]) => x.floor !== 'kept' && x.anchor === 'kept').map(([id]) => id);
    return `| ${r.k} | ${live.length} | ${f} | ${a} | ${lostByAnchor.join(' ') || '-'} | ${savedBySummary.join(' ') || '-'} |`;
  });
}

function usage(n) {
  const f = join(ROOT, `state-${n}.json`);
  if (!existsSync(f)) return 'not available';
  const c = JSON.parse(readFileSync(f, 'utf8')).calls;
  return `${c.length} turns, running totals at the end: input ${c.at(-1).input}, of which cached ${c.at(-1).cached}, output ${c.at(-1).output} tokens`;
}

const done = sessions.filter((s) => s.complete && s.compactions.length >= 20);
const lost = done.filter((s) => loses(s, 'rule').length);
const verdict = lost.length >= 2 ? 'Codex loses' : done.length >= 2 && done.length - lost.length >= 2 ? 'Codex holds' : done.length >= 2 && lost.length === 1 ? 'sessions disagree' : 'not settled';
const first = sessions[0];
const md = [
  '# Context decay on Codex: saga-02',
  '',
  `Date: ${date}. ${first.codexVersion}. Model: ${process.env.GFGATE_MODEL} (gate-allow). Rule frozen in commit ${freeze}, before any real run, in \`bench/gate/codex/RULE.md\`. Compaction limit ${first.limit} tokens.`,
  '',
  'Caveats: one invented story, one model (gate-allow), natural compaction in a read-only sandbox, not kept means not kept word for word and never "forgotten". The floor is the text of the kept history, which holds the user messages raw and so over-counts kept, and it cannot see Codex\'s encrypted summary, so a floor not kept is not proof of loss. The anchor is the only look at the summary, and it is a question the user would not ask.',
  '',
  'What Codex keeps, seen on throwaway sessions first: each compacted record holds every user message word for word, oldest dropped past about 256,000 characters, no assistant replies, and one encrypted summary that cannot be read. So the floor is a view of the raw window, and only the anchor shows whether the summary adds anything.',
  '',
  `## Verdict`,
  '',
  `**${verdict}.** ${done.length} complete session${done.length === 1 ? '' : 's'}, ${lost.length} lost. The rule used the anchor label at k = 10, 15 and 20 and the floor label at every other compaction.`,
  '',
  ...sessions.flatMap((s) => {
    const rule = loses(s, 'rule'), floor = loses(s, 'floor');
    return [
      `## Session ${s.session}`, '',
      `${s.complete ? 'Complete' : 'Incomplete'}: ${s.turns} turns, ${s.compactions.length} compactions (${(s.turns / s.compactions.length).toFixed(1)} turns each). Anchors taken at k ${Object.values(s.anchors).join(', ') || 'none'}. Usage: ${usage(s.session)}.`, '',
      `Rule verdict: ${rule.length ? `**loses**, ${rule.length} atom-pairs not kept twice running, atoms ${[...new Set(rule.map((x) => x.split(' ')[0]))].join(' ')}, first at ${rule[0]}` : '**holds**'}. Floor labels alone: ${floor.length ? `loses, ${floor.length} atom-pairs not kept twice running` : 'holds'}. Anchor misses: ${s.compactions.filter((r) => Object.values(r.atoms).some((a) => a.anchor)).map((r) => `k ${r.k}: ${Object.entries(r.atoms).filter(([, a]) => a.live && a.anchor && a.anchor !== 'kept').map(([id]) => id).join(' ') || 'none'}`).join('; ') || 'no anchors'}.`, '',
      'K kept, R reworded, G gone, blank not live, * anchor label (the rest are floor).', '', grid(s), '',
      `Stale carried: ${stale(s)}.`, '',
      'Floor against anchor at the anchor points (live atoms):', '', '| k | live | floor kept | anchor kept | floor kept, anchor not | anchor kept, floor not |', '| --- | --- | --- | --- | --- | --- |', ...versus(s), '',
    ];
  }),
  '## By age, all sessions', '',
  'An atom\'s age at k is k minus the first compaction it is live at, plus one. Counts of live atom readings.', '',
  'The rule\'s labels:', '', byAge(sessions, 'rule'), '',
  'Floor labels only:', '', byAge(sessions, 'floor'), '',
  'Anchor labels only:', '', byAge(sessions, 'anchor'), '',
];
writeFileSync(join(here, '../../proof/results/decay-codex.md'), md.join('\n'));
console.log(verdict, done.length, lost.length);
