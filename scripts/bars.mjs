import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { agreement, chance, confusion, kappa, labels, printMatrix, readRows, total } from './kappa.mjs';

export function wilson(k, n) {
  if (!Number.isFinite(k) || !Number.isInteger(n) || k < 0 || k > n || n < 0) throw new Error('invalid Wilson counts');
  if (!n) return [NaN, NaN];
  const z = 1.959963984540054, p = k / n, d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
}
function metric(id, k, n, threshold, upper = false, count = false) {
  const value = count ? k : k / n, [lo, hi] = wilson(k, n).map(v => v * (count ? n : 1));
  return { id, value, lo, hi, threshold, result: n > 0 && (upper ? value <= threshold : value >= threshold) ? 'pass' : 'fail' };
}
export const b1 = m => metric('B1', m.reduce((sum, row, i) => sum + row[i], 0), total(m), 0.85);
export function b2(m) {
  const result = b1(m), expected = chance(m);
  return { ...result, id: 'B2', value: kappa(m), lo: (result.lo - expected) / (1 - expected),
    hi: (result.hi - expected) / (1 - expected), threshold: 0.75, result: kappa(m) >= 0.75 ? 'pass' : 'fail' };
}
export const b3 = m => [metric('B3p', m[0][0], m.reduce((n, row) => n + row[0], 0), 0.90),
  metric('B3r', m[0][0], m[0].reduce((a, b) => a + b, 0), 0.90)];
export const b4 = m => metric('B4', m[0][2] + m[2][0], total(m), 3, true, true);
export const b5 = pairs => ({ ...b1(confusion(pairs)), id: 'B5', threshold: 0.80,
  result: agreement(confusion(pairs)) >= 0.80 ? 'pass' : 'fail' });
const falseKept = pairs => pairs.filter(([label, predicted]) => label !== 'kept' && predicted === 'kept').length;
export const b6 = pairs => metric('B6', falseKept(pairs), pairs.length, 1, true, true);
export const b7 = pairs => ['kept', 'reworded'].map((label, i) =>
  metric(i ? 'B7r' : 'B7k', pairs.filter(([, predicted]) => predicted === label).length, pairs.length, i ? 0.05 : 0.01, true));
export const b7n = pairs => ({ ...b6(pairs), id: 'B7n' });
export function b8(m) {
  const n = total(m), actual = m[0].reduce((a, b) => a + b, 0), predicted = m.reduce((a, row) => a + row[0], 0);
  const p = wilson(predicted, n);
  return { id: 'B8', value: (predicted - actual) / n, lo: p[0] - actual / n, hi: p[1] - actual / n, threshold: 0, result: 'report' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, flag, modulePath, ...extra] = process.argv.slice(2);
    if (!file || (flag && (flag !== '--grader' || !modulePath)) || extra.length) throw new Error('usage: bars.mjs <pairs.jsonl> [--grader <module path>]');
    const rows = readRows(file);
    for (const row of rows) {
      if (!['short', 'mid', 'long'].includes(row.band) || typeof row.stratum !== 'string' || !row.stratum ||
        typeof row.message !== 'string' || typeof row.summary !== 'string') throw new Error(`${row.id}: invalid pair`);
    }
    const grader = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : new URL('../src/grade.mjs', import.meta.url).href);
    const indices = rows.map(row => grader.prepare(row.summary));
    const predict = (message, index) => {
      const { label } = grader.score(message, index);
      if (!labels.includes(label)) throw new Error(`invalid grader label: ${label}`);
      return label;
    };
    const pairs = rows.map((row, i) => [row.label, predict(row.message, indices[i])]);
    const cross = [];
    rows.forEach((row, i) => rows.forEach((_, j) => { if (i !== j) cross.push(['gone', predict(row.message, indices[j])]); }));
    const subset = (field, value) => pairs.filter((_, i) => rows[i][field] === value);
    const m = confusion(pairs);
    const bars = [b1(m), b2(m), ...b3(m), b4(m), b5(subset('band', 'short')), b6(subset('stratum', 'condition')),
      ...b7(cross), b7n(subset('stratum', 'near_miss')), b8(m)];
    for (const b of bars) console.log(`bar=${b.id} value=${b.value} lo=${b.lo} hi=${b.hi} threshold=${b.threshold} result=${b.result}`);
    printMatrix(m);
    const pass = bars.every(b => b.result !== 'fail');
    console.log(`bars=${pass ? 'pass' : 'fail'}`);
    process.exitCode = pass ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
