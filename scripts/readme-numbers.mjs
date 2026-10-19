import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const numbers = text => text.match(/\d+(?:[.,]\d+)*/gu) ?? [];
const allowed = new Map([
  ['640', 'The brief sets the banner width.'],
  ['20', 'SPEC Platforms requires Node 20 or newer.'],
  ['10', 'D-053 requires ten sessions at an age.'],
  ['50', 'D-053 requires fifty messages at an age; half defines span.'],
  ['95', 'SPEC names the 95% range.'],
  ['100', 'SPEC reports kept messages per hundred.'],
  ['6', 'D-063 limits the curve to age six.'],
  ['79', 'The brief records sealed three-way agreement at 79 in 100.'],
]);

function evidenceNumbers(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? evidenceNumbers(path) : numbers(readFileSync(path, 'utf8'));
  });
}

export function checkReadme(readme) {
  const evidence = new Set([
    ...allowed.keys(),
    ...numbers(readFileSync(resolve(root, 'TESTED.md'), 'utf8')),
    ...evidenceNumbers(resolve(root, 'bench/runs')),
  ]);
  const demo = spawnSync(process.execPath, ['bin/goldfished.mjs', 'retro', '--demo'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  const issues = [];
  if (demo.status !== 0) issues.push('retro --demo failed');
  const block = /(?:^|\n)```text\n(Invented example, not real data\.\n[\s\S]*?)```(?=\n|$)/gu;
  const blocks = [...readme.matchAll(block)];
  if (blocks.length !== 1 || blocks[0][1] !== demo.stdout) {
    issues.push('The demo block must be byte-identical to fresh retro --demo output');
  }
  const outside = blocks.length === 1 && blocks[0][1] === demo.stdout
    ? readme.replace(block, match => '\n'.repeat(match.split('\n').length - 1)) : readme;
  for (const [index, line] of outside.split('\n').entries()) {
    for (const number of numbers(line)) {
      if (!evidence.has(number)) issues.push(`README.md:${index + 1}: unmatched number ${number}`);
    }
  }
  return issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = checkReadme(readFileSync(resolve(root, process.argv[2] ?? 'README.md'), 'utf8'));
  for (const issue of issues) console.error(issue);
  if (issues.length) process.exitCode = 1;
  else console.log('README numbers and demo match their evidence.');
}
