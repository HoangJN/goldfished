import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { strictEqual } from 'node:assert';
import { fileURLToPath } from 'node:url';

export function matchSnapshot(row, name, text) {
  if (![row, name].every(part => /^[a-z0-9_-]+$/i.test(part))) throw new Error('Invalid snapshot name.');
  const folder = new URL(`./snapshots/${row}/`, import.meta.url), file = new URL(`${name}.txt`, folder);
  const normalise = value => value.replace(/\r\n/g, '\n');
  if (process.env.UPDATE_SNAPSHOTS === '1') { mkdirSync(folder, { recursive: true }); writeFileSync(file, normalise(text), 'utf8'); }
  strictEqual(normalise(text), normalise(readFileSync(file, 'utf8')), fileURLToPath(file));
}
