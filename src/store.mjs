import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as cardIO from './card.mjs';
import * as proposalIO from './proposals.mjs';
import * as home from './home.mjs';
import * as pointer from './pointer.mjs';
import { mask } from './mask.mjs';

const sections = { g: 'goal', r: 'rules', x: 'out' }, titles = { goal: 'GOAL', rules: 'RULES', out: 'RULED OUT' };
function read(file) {
  try { return readFileSync(file, 'utf8'); }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null; throw error; }
}
function archiveText(archive) {
  return '# goldfished archive\n\n' + archive.map(({ section, entry, reason, date }) => {
    const card = { goal: null, rules: [], out: [], [section]: section === 'goal' ? entry : [entry] };
    return `## ${titles[section]}\n` + cardIO.serialise(card).split('\n').filter(line => /^(\[|  )/.test(line)).join('\n') + ` (${reason} ${date})`;
  }).join('\n\n') + '\n';
}
function archiveParse(source) {
  return [...source.replace(/\r\n/g, '\n').matchAll(/^\[([grx]\d{2,}) \| [^\n]+(?:\n  [^\n]*)*/gm)].map(([text, id]) => {
    const end = / \((dropped|replaced|edited) (\d{4}-\d{2}-\d{2})\)$/.exec(text), section = sections[id[0]];
    if (!end) throw new SyntaxError('Invalid archive entry.');
    const parsed = cardIO.parse(`## ${titles[section]}\n${text.slice(0, end.index)}\n`);
    if (parsed.errors.length) throw new SyntaxError('Invalid archive entry.');
    return { section, entry: section === 'goal' ? parsed.goal : parsed[section][0], reason: end[1], date: end[2] };
  });
}
export function load(top) {
  const dir = join(top, '.goldfished'), cardPath = join(dir, 'card.md'), stored = read(cardPath), source = stored ?? '';
  const card = cardIO.parse(source), reason = card.errors.length ? `parse error on line ${card.errors[0].line}` : stored === null ? null : home.untrustReason(cardPath, cardIO.hash(source));
  return { cardPath, source, card, archive: archiveParse(read(join(dir, 'archive.md')) ?? ''), proposals: proposalIO.parse(read(join(dir, 'proposed.md')) ?? ''), trusted: reason === null, ...(reason ? { reason } : {}) };
}
export function save(top, { card, archive, proposals }) {
  const dir = join(top, '.goldfished'), source = mask(cardIO.serialise(card), 'card');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of [['archive.md', mask(archiveText(archive), 'card')], ['proposed.md', proposalIO.serialise(proposals)], ['card.md', source]]) {
    const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
    try { writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' }); renameSync(temp, join(dir, name)); }
    finally { rmSync(temp, { force: true }); }
  }
  home.trust(join(dir, 'card.md'), cardIO.hash(source));
  const state = home.state(), project = state.projects?.[top] ?? {}, recorded = { ...project.recorded };
  const settings = { top, agents: project.agents ?? [], shared: true, commit: project.commit ?? false, existing: {}, tracked: {}, recorded, card: cardIO.parse(source), trusted: true };
  const cline = read(join(top, '.clinerules'));
  if (cline !== null) settings.existing['.clinerules'] = cline;
  for (const { path, kind } of pointer.plan(settings)) if (kind === 'owned') {
    const text = read(join(top, path));
    if (text !== null) settings.existing[path] = text;
  }
  const changes = pointer.plan(settings);
  changes.splice(0, changes.length, ...changes.filter(change => change.kind === 'owned'));
  const failed = new Set(pointer.apply(changes).map(report => report.path));
  let inlineUpdated = 0;
  for (const change of changes) if (!change.skipped && !failed.has(change.path)) {
    recorded[change.path] = cardIO.hash(change.after);
    if (change.before !== change.after) inlineUpdated++;
  }
  home.setState({ projects: { ...state.projects, [top]: { ...project, recorded } } });
  return { inlineUpdated };
}
