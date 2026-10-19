import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const hook = [], bare = [];
const top = mkdtempSync(join(tmpdir(), 'goldfished-hook-bench-')), env = { ...process.env, GOLDFISHED_HOME: join(top, 'home') };
const input = JSON.stringify({ _synthetic: true, prompt: 'please tidy the tests', cwd: top, hook_event_name: 'UserPromptSubmit' });
try { for (let i = 0; i < 200; i++) {
  for (const [times, args] of [[bare, ['-e', '']], [hook, ['hooks/run.mjs', 'claude-code', 'prompt']]]) {
    const start = performance.now();
    const run = spawnSync(process.execPath, args, { input, env, encoding: 'utf8' });
    if (run.status !== 0 || run.stdout !== '') throw new Error('Hook benchmark child failed.');
    times.push(performance.now() - start);
  }
} } finally { rmSync(top, { recursive: true, force: true }); }
hook.sort((a, b) => a - b); bare.sort((a, b) => a - b);
const median = a => (a[99] + a[100]) / 2, difference = median(hook) - median(bare);
console.log(`hook median ${median(hook).toFixed(2)} ms; bare median ${median(bare).toFixed(2)} ms; difference ${difference.toFixed(2)} ms; hook p95 ${hook[189].toFixed(2)} ms`);
process.exitCode = difference > 30 ? 1 : 0;
