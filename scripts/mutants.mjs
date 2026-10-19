import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { isolated, root, run } from './oracle.mjs';

const kill = ['kill'], stats = 'src/stats.mjs', fold = 'src/fold.mjs', grade = 'src/grade.mjs', retro = 'src/cli/retro.mjs';
const edits = [
  ['span-40', stats, 'row.kept * 100 < 50 * row.messages', 'row.kept * 100 < 40 * row.messages', kill],
  ['measurable-20', stats, 'row.messages >= 50', 'row.messages >= 20', kill],
  ['swapped-verdicts', 'src/fun.mjs', 'tiers[Math.min(span, 3)]', 'tiers[[1, 0, 2, 3][Math.min(span, 3)]]', ['fun']],
  ['dropped-censor', stats, 'const censored = rows.every', 'const censored = false && rows.every', kill],
  ['grader-threshold', grade, 'threshold: 0.9', 'threshold: 0.8', kill],
  ['grader-run-minus-one', grade, 'longestRun(tokens, index.runs) / tokens.length', 'Math.max(0, longestRun(tokens, index.runs) - 1) / tokens.length', kill],
  ['dropped-summary-check', 'src/agents/claude-code.dialect.mjs', "else if (record.isCompactSummary === true) reason = 'summary';", '', kill],
  ['dropped-tail-rule', 'src/agents/claude-code.mjs', 'const kept = !record.reason && epoch > 0 &&', 'const kept = false && !record.reason && epoch > 0 &&', kill],
  ['dropped-short-reject', fold, 'if (length < 20)', 'if (false && length < 20)', kill],
  ['broken-uuid-dedupe', 'src/agents/claude-code.mjs', 'if (seen.has(record.dedupeKey)) continue;', '', kill],
  ['after-last-compaction', fold, 'if (boundary <= epoch) continue;', '', kill],
  ['bootstrap-messages', stats, 'const pool = ages.perSession.map(s => s.get(age)).filter(c => c && messages(c) > 0);',
    'const pool = ages.perSession.map(s => s.get(age)).filter(c => c && messages(c) > 0).flatMap(c => Array.from({ length: messages(c) }, (_, i) => ({ kept: Number(i < c.kept), reworded: 0, gone: Number(i >= c.kept) })));', kill],
  ['opaque-counted-gone', fold, "visible === null ? [] : [{ epoch, visibleIdx, index: grader.prepare(visible) }]",
    "[{ epoch, visibleIdx, index: grader.prepare(visible ?? '') }]", kill],
  ['paste-1501', fold, 'length > 1500', 'length > 1501', kill],
  ['short-19', fold, 'length < 20', 'length < 19', kill],
  ['ages-sorted-as-text', stats, 'Math.max(0, ...rows.filter(r => r.age >= 2 && measurable(r)).map(r => r.age)) || null',
    'rows.filter(r => r.age >= 2 && measurable(r)).map(r => r.age).sort().at(-1) ?? null', kill],
  ['two-digit-age-offset', fold, 'const age = boundary - epoch;', 'const age = boundary - epoch - Number(boundary - epoch >= 10);', kill],
  ['resumed-copy-counted-twice', 'src/agents/codex.mjs', 'yield (await readSession(file, tally, seen)).session;',
    'yield (await readSession(file, tally, new Set())).session;', kill],
  ['later-reworded-kept', fold, 'const { label, score } = grader.score(text, index);',
    "const graded = grader.score(text, index), { score } = graded, label = age >= 10 && graded.label === 'reworded' ? 'kept' : graded.label;", kill],
  ['gap-as-end', stats, 'const censored = rows.every',
    'const censored = rows.filter(r => { for (let age = 1; age <= r.age; age++) if (!byAge.has(age)) return false; return true; }).every', kill],
  ['dropped-sample-floor', stats, 'row.messages >= 50 && row.sessions >= 10', 'row.messages > 0', kill],
  ['card-pooled', retro, '(session.cardResent ? card : main)', '(false ? card : main)', ['cli-retro']],
  ['curve-before-six', stats, 'Math.min(6, Math.max', 'Math.min(5, Math.max', kill],
];
const base = mkdtempSync(join(tmpdir(), 'gf-mutants-')), copy = join(base, 'copy');
try {
  const env = isolated(base);
  cpSync(root, copy, { recursive: true, filter: file => !['.git', '.claude', '.agents', '.codex'].includes(relative(root, file).split(/[\\/]/)[0]) });
  const prepared = edits.map(([name, file, search, replacement, tests]) => {
    const path = join(copy, file), original = readFileSync(path, 'utf8');
    assert.equal(original.split(search).length - 1, 1, `${name}: search must match exactly once in ${file}`);
    return { name, path, original, changed: original.replace(search, replacement), tests };
  });
  const check = process.argv.includes('--check');
  const files = [...new Set(edits.flatMap(edit => edit[4]))];
  const testFiles = names => ['--import', './test/no-network.mjs', '--test', ...names.map(name => `test/${name}.test.mjs`)];
  if (!check) {
    const baseline = run(testFiles(files), { cwd: copy, env, timeout: 300000 });
    assert.equal(baseline.status, 0, `unmutated tests failed\n${baseline.stdout}\n${baseline.stderr}`);
  }
  let killed = 0;
  for (const edit of prepared) {
    try {
      writeFileSync(edit.path, edit.changed);
      if (check) continue;
      const got = run(testFiles(edit.tests), { cwd: copy, env, timeout: 300000 });
      assert.ok(got.status !== null && got.signal === null, `${edit.name}: tests did not finish`);
      if (got.status !== 0) { killed++; console.log(`killed ${edit.name}`); }
      else console.log(`survived ${edit.name}`);
    } finally { writeFileSync(edit.path, edit.original); }
  }
  console.log(check ? `mutants check ${prepared.length} matched once` : `mutants ${killed} killed of ${prepared.length}`);
  if (!check && killed !== prepared.length) process.exitCode = 1;
} finally { rmSync(base, { recursive: true, force: true }); }
