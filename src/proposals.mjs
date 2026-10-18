import { mask } from './mask.mjs';

const cut = (text, limit) => Array.from(text).slice(0, limit).join('');
/** A list is {next, entries: [{id,quote,note,from}]}; next survives removals. */
export function parse(source) {
  const list = source.trim() ? JSON.parse(source) : { next: 1, entries: [] };
  if (!Number.isSafeInteger(list.next) || list.next < 1 || !Array.isArray(list.entries) || list.entries.some(entry => !/^p[1-9]\d*$/.test(entry.id) || ['quote', 'note', 'from'].some(key => typeof entry[key] !== 'string')) || new Set(list.entries.map(entry => entry.id)).size !== list.entries.length || list.entries.some(entry => Number(entry.id.slice(1)) >= list.next)) throw new SyntaxError('Invalid proposals.');
  return list;
}

export function serialise(list) { return JSON.stringify(list, null, 2) + '\n'; }

/** Returns {list,id}; quote verification belongs to the caller. */
export function add(list, { quote, note, from }) {
  const id = `p${list.next}`;
  const entry = { id, quote, note: cut(note.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ''), 80), from: cut(mask(from, 'card'), 160) };
  return { list: { next: list.next + 1, entries: [...list.entries, entry] }, id };
}

/** Returns {list,proposal}, or {refused} when pid is absent. */
export function take(list, pid) {
  const proposal = list.entries.find(entry => entry.id === pid);
  return proposal ? { list: { ...list, entries: list.entries.filter(entry => entry !== proposal) }, proposal } : { refused: `goldfished: ${pid} was not found.` };
}
