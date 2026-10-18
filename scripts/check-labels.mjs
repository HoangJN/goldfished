import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const bands = ['short', 'mid', 'long'];
const labels = ['kept', 'reworded', 'gone'];
const strata = ['condition', 'fragment', 'exact', 'paraphrase', 'paste', 'near_miss', 'other'];
const fields = ['id', 'band', 'stratum', 'message', 'summary', 'label', '_synthetic'];

function parse(lines, problems) {
  const input = typeof lines === 'string' ? lines.split(/\r?\n/) : [...lines];
  if (typeof lines === 'string' && input.at(-1) === '') input.pop();
  return input.flatMap((line, index) => {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('expected object');
      return [{ row, at: `line ${index + 1}` }];
    } catch (error) {
      problems.push(`line ${index + 1}: invalid JSON object (${error.message})`);
      return [];
    }
  });
}

function tally(rows, field, values) {
  return Object.fromEntries(values.map(value => [value, rows.filter(({ row }) => row[field] === value).length]));
}

export function check(lines, { count = 160 } = {}) {
  const problems = [];
  const rows = parse(lines, problems);
  if (rows.length !== count) problems.push(`count: expected ${count}, found ${rows.length}`);
  const ids = new Map();
  const runs = new Map();
  for (const { row, at } of rows) {
    const name = typeof row.id === 'string' && row.id ? row.id : at;
    for (const field of fields) {
      if (!Object.hasOwn(row, field)) problems.push(`${name}: field missing: ${field}`);
      else if (field !== '_synthetic' && (typeof row[field] !== 'string' || !row[field].trim())) {
        problems.push(`${name}: ${field} must be a non-empty string`);
      }
    }
    if (typeof row.id === 'string') {
      if (ids.has(row.id)) problems.push(`${name}: duplicate id (first at ${ids.get(row.id)})`);
      else ids.set(row.id, at);
    }
    if (row._synthetic !== true) problems.push(`${name}: _synthetic must be true`);
    for (const [field, values] of [['band', bands], ['label', labels], ['stratum', strata]]) {
      if (!values.includes(row[field])) problems.push(`${name}: invalid ${field}: ${row[field]}`);
    }
    if (typeof row.message !== 'string') continue;
    const length = [...row.message].length;
    const band = length >= 20 && length <= 60 ? 'short'
      : length >= 61 && length <= 300 ? 'mid'
        : length >= 301 && length <= 1500 ? 'long' : null;
    if (!band || row.band !== band) problems.push(`${name}: band wrong for length ${length} (expected ${band ?? '20 to 1500 characters'})`);
    const words = row.message.toLowerCase().replace(/\p{P}/gu, '').trim().split(/\s+/u);
    const ownRuns = new Set();
    for (let i = 0; i + 5 <= words.length; i++) ownRuns.add(words.slice(i, i + 5).join(' '));
    for (const run of ownRuns) {
      if (runs.has(run)) problems.push(`shared 5-word run: ${runs.get(run)} and ${name}: "${run}"`);
      else runs.set(run, name);
    }
  }
  const bandCounts = tally(rows, 'band', bands);
  if (bandCounts.short < 40) problems.push(`band quota: short needs 40, found ${bandCounts.short}`);
  for (const band of bands) {
    for (const label of labels) {
      const found = rows.filter(({ row }) => row.band === band && row.label === label).length;
      if (found < 8) problems.push(`label quota: ${band}/${label} needs 8, found ${found}`);
    }
  }
  for (const stratum of strata.filter(value => value !== 'other')) {
    const found = rows.filter(({ row }) => row.stratum === stratum).length;
    if (found < 16) problems.push(`stratum quota: ${stratum} needs 16, found ${found}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = readFileSync(process.argv[2], 'utf8');
    const problems = check(input);
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exitCode = 1;
    } else {
      const rows = parse(input, []);
      for (const [field, values] of [['band', bands], ['stratum', strata], ['label', labels]]) {
        console.log(`${field}: ${JSON.stringify(tally(rows, field, values))}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
