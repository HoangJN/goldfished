import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

function span(text) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  return start < 0 || finish < 0 ? null : [start, finish + end.length];
}

function insert(before, text) {
  const range = span(before ?? '');
  if (range) return before.slice(0, range[0]) + text + before.slice(range[1]);
  if (!before) return text + '\n';
  const terminated = before.endsWith('\n');
  const separator = terminated ? before.endsWith('\r\n') ? '\r\n' : '\n' : '\n\n';
  return before + separator + text + (terminated ? '\n' : '');
}

export function plan({ top, agents, shared, commit, existing, tracked, recorded, card, trusted }) {
  const changes = targets(existing).filter(({ agent }) => agent === 'all' || agents.includes(agent)).map(({ target: path, kind, header }) => {
    const before = existing[path] ?? null;
    const change = { path, before, after: before, kind };
    if ((tracked[path] === true || tracked[path] === null) && !shared) {
      return { ...change, skipped: `${path} is shared with your team (tracked by git). Skipped; use --shared to add the pointer there too.` };
    }
    if (kind === 'owned') {
      if (!trusted || card.errors?.length) return { ...change, skipped: `${path} was skipped because the card is not trusted on this machine.` };
      const { text } = block(card, { kind: 'inline', budget: 6000, maxChars: 6000, trusted: trusted && !commit });
      change.after = header + text;
    } else {
      change.after = insert(before, [begin, "## The user's card", pointer + (tracked[path] || tracked[path] === null || commit ? '' : propose), end].join('\n'));
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
    const range = span(before);
    if (!range) continue;
    let prefix = before.slice(0, range[0]), suffix = before.slice(range[1]);
    const terminated = /^\r?\n/.test(suffix);
    prefix = prefix.replace(terminated ? /\r?\n$/ : /\r?\n\r?\n$/, '');
    suffix = suffix.replace(/^\r?\n/, '');
    changes.push({ path, before, after: prefix + suffix, kind });
  }
  return atRoot(changes, top);
}

export function apply(changes) {
  for (const { path, before, after, skipped, left } of changes) {
    if (skipped || left || before === after) continue;
    const file = resolve(changes[root] ?? '.', path);
    if (after === null) { rmSync(file, { force: true }); continue; }
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, after, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
