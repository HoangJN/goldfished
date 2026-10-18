import { readFileSync } from 'node:fs';

const message = readFileSync(process.argv[2], 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('#'));

const problems = [];
if (message.some((line) => /^\s*co-authored-by\s*:/i.test(line))) { // gate-allow
  problems.push('a Co-Authored-By trailer'); // gate-allow
}
if (message.some((line) => /generated with/i.test(line))) { // gate-allow
  problems.push('a "Generated with" line'); // gate-allow
}

if (problems.length > 0) {
  console.error(`commit rejected: the message carries ${problems.join(' and ')}.`);
  console.error('Commits here go out under the local git identity alone. Remove the line and try again.');
  process.exit(1);
}
