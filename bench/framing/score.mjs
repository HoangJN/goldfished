#!/usr/bin/env node
// Scores the file a run wrote. It reads the file and nothing else: no framing name, no run log.
// Usage: node score.mjs <file ...> | --self-test
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY = /(?:from\s+|require\(\s*)['"](?:date-fns|dayjs|moment|luxon)\b/;
const US = [/\b0?3\/0?5\/2026\b/, /MM\/dd\/yyyy/i, /en-US/];
const ISO = [/\b2026-03-05\b/, /toISOString\s*\(/, /yyyy-MM-dd/i];

export function verdict(text) {
  if (text === null) return 'neither';
  const lib = LIBRARY.test(text);
  const us = US.some((re) => re.test(text));
  const iso = ISO.some((re) => re.test(text));
  if (iso && !us && !lib) return 'follows-card';
  if ((us || lib) && !iso) return 'follows-summary';
  return 'neither';
}

export function scoreFile(path) {
  try { return verdict(readFileSync(path, 'utf8')); } catch { return verdict(null); }
}

export function wilson(x, n) {
  const z = 1.96;
  const p = x / n;
  const d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

function selfTest() {
  const here = dirname(fileURLToPath(import.meta.url));
  const { cases } = JSON.parse(readFileSync(join(here, 'selftest.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'framing-'));
  let bad = 0;
  cases.forEach((c, i) => {
    const file = join(dir, `case-${i}.mjs`);
    writeFileSync(file, c.text);
    const got = scoreFile(file);
    if (got !== c.expect) { bad++; console.log(`case ${i} (${c.note}): expected ${c.expect}, got ${got}`); }
  });
  const missing = scoreFile(join(dir, 'absent.mjs'));
  if (missing !== 'neither') { bad++; console.log(`missing file: expected neither, got ${missing}`); }
  const [lo, hi] = wilson(17, 20);
  if (Math.abs(lo - 0.640) > 0.002 || Math.abs(hi - 0.948) > 0.002) { bad++; console.log(`wilson 17 of 20: ${lo.toFixed(3)} to ${hi.toFixed(3)}`); }
  rmSync(dir, { recursive: true, force: true });
  const per = {};
  for (const c of cases) per[c.expect] = (per[c.expect] ?? 0) + 1;
  console.log(`self-test: ${cases.length - bad} of ${cases.length} cases right ${JSON.stringify(per)}`);
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') selfTest();
  else for (const f of args) console.log(`${f}\t${scoreFile(f)}`);
}
