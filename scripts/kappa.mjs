import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const labels = ['kept', 'reworded', 'gone'];
export function confusion(pairs) {
  const matrix = labels.map(() => labels.map(() => 0));
  for (const [label, predicted] of pairs) {
    if (!labels.includes(label) || !labels.includes(predicted)) throw new Error(`invalid labels: ${label}, ${predicted}`);
    matrix[labels.indexOf(label)][labels.indexOf(predicted)]++;
  }
  return matrix;
}
export const total = m => m.flat().reduce((a, b) => a + b, 0);
export const agreement = m => m.reduce((sum, row, i) => sum + row[i], 0) / total(m);
export function chance(m) {
  return m.reduce((sum, row, i) => sum + row.reduce((a, b) => a + b, 0) * m.reduce((a, r) => a + r[i], 0), 0) / total(m) ** 2;
}
export function kappa(m) {
  const expected = chance(m);
  return expected === 1 ? NaN : (agreement(m) - expected) / (1 - expected);
}
export function readRows(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new Error(`${path}: empty label set`);
  const ids = new Set();
  return text.split(/\r?\n/).map((line, i) => {
    const row = JSON.parse(line);
    if (!row || typeof row.id !== 'string' || !row.id || !labels.includes(row.label)) throw new Error(`${path}:${i + 1}: invalid id or label`);
    if (ids.has(row.id)) throw new Error(`${path}:${i + 1}: duplicate id ${row.id}`);
    ids.add(row.id);
    return row;
  });
}
export function printMatrix(m) {
  console.log(`confusion rows=label columns=predicted ${labels.join(' ')}`);
  m.forEach((row, i) => console.log(`${labels[i]} ${row.join(' ')}`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: kappa.mjs <a.jsonl> <b.jsonl>');
    const a = readRows(process.argv[2]), b = readRows(process.argv[3]);
    const other = new Map(b.map(row => [row.id, row.label]));
    const own = new Set(a.map(row => row.id));
    for (const row of a) if (!other.has(row.id)) throw new Error(`id mismatch: ${row.id} missing from second set`);
    for (const row of b) if (!own.has(row.id)) throw new Error(`id mismatch: ${row.id} missing from first set`);
    const m = confusion(a.map(row => [row.label, other.get(row.id)]));
    console.log(`agreement=${agreement(m)}`);
    printMatrix(m);
    console.log(`disagreeing ids: ${a.filter(row => row.label !== other.get(row.id)).map(row => row.id).join(' ')}`);
    console.log(`kappa=${kappa(m)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
