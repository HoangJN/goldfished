import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { generateBench, profile } from './gen-bench.mjs';
import { isolated, root, run } from './oracle.mjs';

export function measure(base, agent, folder, { nodeArgs = [], timeout = 300000 } = {}) {
  const env = isolated(base);
  const preload = join(base, 'rss.mjs');
  writeFileSync(preload, "process.on('exit', () => { const r = process.resourceUsage(); process.stderr.write('BENCH_RSS=' + r.maxRSS * 1024 + '\\nBENCH_CPU=' + (r.userCPUTime + r.systemCPUTime) / 1e6 + '\\n'); });\n");
  const started = performance.now();
  const got = run([...nodeArgs, '--import', pathToFileURL(preload).href, join(root, 'bin/goldfished.mjs'),
    'retro', '--json', '--dir', folder, '--agent', agent, '--days', '0'], { cwd: base, env, timeout });
  const seconds = (performance.now() - started) / 1000, match = /^BENCH_RSS=(\d+)$/mu.exec(got.stderr);
  assert.equal(got.status, 0, got.stderr);
  assert.ok(match, 'Peak memory was not reported');
  const result = JSON.parse(got.stdout), actual = result.agents.find(row => row.id === agent);
  assert.ok(actual && !['none', 'drift'].includes(actual.status), `Unexpected result: ${got.stdout}`);
  return { seconds, peakBytes: Number(match[1]), cpuSeconds: Number(/^BENCH_CPU=([\d.]+)$/mu.exec(got.stderr)?.[1]), actual };
}
export const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function bars(warm, fresh, scale) {
  const limits = profile.bars, warmSeconds = median(warm.map(row => row.seconds));
  const peak = Math.max(...[...warm, fresh, ...scale].map(row => row.peakBytes));
  const rates = profile.runs.scaleGiB.map(gib => median(scale.filter(row => row.gib === gib).map(row => row.seconds)) / gib);
  rates.push(median(warm.slice(0, profile.runs.scaleCount).map(row => row.seconds)) / profile.runs.warmGiB);
  const growth = Math.max(...rates) / rates[0] - 1;
  return [
    ['warm-median', warmSeconds <= limits.warmSeconds, `${warmSeconds.toFixed(3)}s <= ${limits.warmSeconds}s`],
    ['first-run', fresh.seconds <= limits.freshSeconds, `${fresh.seconds.toFixed(3)}s <= ${limits.freshSeconds}s`],
    ['peak-memory', peak <= limits.peakBytes, `${(peak / 1e6).toFixed(3)}MB <= ${limits.peakBytes / 1e6}MB`],
    ['time-per-GiB', growth <= limits.scaleTolerance, `${(growth * 100).toFixed(2)}% growth <= ${limits.scaleTolerance * 100}%; baseline=${rates[0].toFixed(3)}s/GiB; medians=3`],
  ];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = mkdtempSync(join(tmpdir(), 'gf-bench-')), results = new Map();
  console.log(`machine ${cpus()[0].model} memory=${(totalmem() / 2 ** 30).toFixed(2)}GiB ${platform()} node=${process.version}`);
  try {
    const agents = ['claude-code', 'codex'];
    for (const agent of agents) results.set(agent, { warm: [], scale: [] });
    const dataset = (gib, seed, label, copies = 1) => {
      const folder = join(base, label), manifest = generateBench({ gib, seed, out: folder });
      for (let copy = 1; copy <= copies; copy++) for (const agent of agents) {
        const got = measure(join(base, 'isolated'), agent, join(folder, agent));
        assert.equal(got.actual.sessions, manifest[agent].files);
        assert.equal(got.actual.messages, manifest[agent].typed);
        console.log(`run ${agent} ${label}-${copy} gib=${gib} bytes=${manifest[agent].bytes} wall=${got.seconds.toFixed(3)}s cpu=${got.cpuSeconds.toFixed(3)}s peak=${(got.peakBytes / 1e6).toFixed(3)}MB`);
        const rows = results.get(agent);
        if (label === 'warm') rows.warm.push(got);
        else if (label === 'fresh') rows.fresh = got;
        else rows.scale.push({ ...got, gib });
      }
      rmSync(folder, { recursive: true, force: true });
    };
    dataset(profile.runs.warmGiB, profile.seed, 'warm', profile.runs.warmCount);
    for (const gib of profile.runs.scaleGiB) dataset(gib, profile.seed, `scale-${gib}`, profile.runs.scaleCount);
    dataset(profile.runs.warmGiB, profile.seed + 1, 'fresh');
    for (const [agent, rows] of results) for (const [name, pass, value] of bars(rows.warm, rows.fresh, rows.scale)) {
      console.log(`bar ${agent} ${name} ${pass ? 'pass' : 'fail'} ${value}`);
      if (!pass) process.exitCode = 1;
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
}
