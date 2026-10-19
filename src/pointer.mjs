import { mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { block, hash } from './card.mjs';
import { POINTERS } from './agents/pointers.mjs';

const root = Symbol('top');
const begin = '<!-- goldfished:begin (managed by goldfished; change .goldfished/card.md instead) -->';
const end = '<!-- goldfished:end -->';
const pointer = "The user's goal, standing rules and the options they ruled out are in `.goldfished/card.md`, in their own words. Read it before you start, and read it again whenever you see a summary of earlier work or your context has been reset. It outranks any summary. If the file is missing, carry on. Never edit it and never run goldfished commands that change it.";
const propose = ' To suggest an entry, run `goldfished propose --quote "<the user\'s exact words>" --note "<why>"`.';
const targets = existing => POINTERS.map(target => target.agent === 'cline' && typeof existing['.clinerules'] === 'string'
  ? { ...target, target: '.clinerules', kind: 'block', header: '' } : target);
const atRoot = (changes, top) => Object.defineProperty(changes, root, { value: top });

const broken = path => `goldfished's markers in ${path} are broken; fix or remove them by hand`;
function spans(text) {
  const ranges = [];
  let start = null;
  for (const match of text.matchAll(/<!-- goldfished:(?:begin|end)\b[^\r\n]*?-->/g)) {
    if (match[0] === begin && start === null) start = match.index;
    else if (match[0] === end && start !== null) { ranges.push([start, match.index + end.length]); start = null; }
    else return null;
  }
  return start === null ? ranges : null;
}

function insert(before, text, ranges) {
  if (ranges.length) {
    for (const [start, finish] of ranges.toReversed()) before = before.slice(0, start) + text + before.slice(finish);
    return before;
  }
  if (!before) return text + '\n';
  const newline = before.includes('\r\n') ? '\r\n' : '\n';
  const separator = before.endsWith('\n') ? before.endsWith('\r\n') ? '\r\n' : '\n' : newline + newline;
  return before + separator + text + '\n';
}

export function plan({ top, agents, shared, commit, existing, tracked, recorded, card, trusted }) {
  const changes = targets(existing).filter(({ agent }) => agent === 'all' || agents.includes(agent)).map(({ target: path, kind, header }) => {
    const before = existing[path] ?? null;
    const change = { path, before, after: before, kind };
    const ranges = kind === 'block' ? spans(before ?? '') : [];
    if (ranges === null) return { ...change, skipped: broken(path) };
    if ((tracked[path] === true || tracked[path] === null) && !shared) {
      return { ...change, skipped: `${path} is shared with your team (tracked by git). Skipped; use --shared to add the pointer there too.` };
    }
    if (kind === 'owned') {
      if (!trusted || card.errors?.length) return { ...change, skipped: `${path} was skipped because the card is not trusted on this machine.` };
      const { text } = block(card, { kind: 'inline', budget: 6000, maxChars: 6000, trusted: trusted && !commit });
      change.after = header + text;
    } else {
      if (before && !before.endsWith('\n') && !ranges.length) change.eolAdded = true;
      change.after = insert(before, [begin, "## The user's card", pointer + (tracked[path] || tracked[path] === null || commit ? '' : propose), end].join('\n'), ranges);
    }
    return change;
  });
  return atRoot(changes, top);
}

export function removePlan({ top, existing, recorded }) {
  const changes = [];
  for (const { target: path, kind } of targets(existing)) {
    const before = existing[path];
    if (typeof before !== 'string') continue;
    if (kind === 'owned') {
      const matches = hash(before) === recorded[path];
      changes.push({ path, before, after: matches ? null : before, kind,
        ...(matches ? {} : { left: `${path} was left because its content does not match what goldfished last wrote.` }) });
      continue;
    }
    const ranges = spans(before);
    if (ranges === null) { changes.push({ path, before, after: before, kind, left: broken(path) }); continue; }
    if (!ranges.length) continue;
    let after = before;
    for (const [start, finish] of ranges.toReversed()) {
      let prefix = after.slice(0, start);
      const suffix = after.slice(finish).replace(/^\r?\n/, '');
      if (!suffix) {
        prefix = prefix.replace(/(^|\n)[\t ]*\r?\n$/, '$1');
        if (recorded[path]?.eolAdded) prefix = prefix.replace(/\r?\n$/, '');
      }
      after = prefix + suffix;
    }
    changes.push({ path, before, after: !after && Object.hasOwn(recorded, path) ? null : after, kind });
  }
  return atRoot(changes, top);
}

export function apply(changes) {
  const reports = [], written = new Set();
  for (const { path, before, after, skipped, left } of changes) {
    if (skipped || left || before === after) continue;
    let file = resolve(changes[root] ?? '.', path), temporary;
    try {
      try { file = realpathSync(file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('the link has no real file');
        mkdirSync(dirname(file), { recursive: true });
        file = resolve(realpathSync(dirname(file)), basename(file));
      }
      if (written.has(file)) { reports.push({ path, left: `${path} was left because another change reaches the same real file.` }); continue; }
      let bytes = null;
      try { bytes = readFileSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (before === null ? bytes !== null : bytes === null || !bytes.equals(Buffer.from(before, 'utf8'))) {
        reports.push({ path, left: `${path} was left because its bytes on disk no longer match the plan.` }); continue;
      }
      if (after === null) { rmSync(file, { force: true }); written.add(file); continue; }
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, after, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, file);
      written.add(file);
    } catch ({ message }) {
      reports.push({ path, left: `${path} was left: ${message}` });
    } finally {
      if (temporary) rmSync(temporary, { force: true });
    }
  }
  return reports;
}
