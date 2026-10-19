import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkReadme } from '../scripts/readme-numbers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

test('the real README passes the numbers checker', () => {
  const result = spawnSync(process.execPath, ['scripts/readme-numbers.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test('a planted number reports its line and exits one', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gf-readme-'));
  try {
    const file = join(scratch, 'README.md');
    writeFileSync(file, `${readme}\nMeasured 98765432109876543210 sessions.\n`);
    const result = spawnSync(process.execPath, ['scripts/readme-numbers.mjs', file], {
      cwd: root, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /README\.md:\d+: unmatched number 98765432109876543210/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the demo cannot be changed or removed to hide numbers', () => {
  assert.ok(checkReadme(readme.replace('Memory span: 1 compaction', 'Memory span: 2 compactions'))
    .some(issue => issue.includes('byte-identical')));
  assert.ok(checkReadme(readme.replace(/```text\n[\s\S]*?```/u, ''))
    .some(issue => issue.includes('byte-identical')));
});

test('workflow actions use full hashes and only ordinary pull requests', () => {
  function check(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { check(path); continue; }
      if (!/\.ya?ml$/u.test(entry.name)) continue;
      const text = readFileSync(path, 'utf8');
      assert.ok(!text.includes('pull_request' + '_target'), path);
      for (const line of text.split('\n')) {
        if (/\buses\s*:/u.test(line)) {
          assert.match(line, /^\s*(?:-\s*)?uses:\s+[\w./-]+@[a-f\d]{40}\s*(?:#.*)?$/u, path);
        }
      }
    }
  }
  check(join(root, '.github/workflows'));
});

test('the release tag check accepts only the package version', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  const guard = /- name: Check release tag\n\s+run: node -e "([^"]+)"/u.exec(workflow);
  assert.ok(guard);
  assert.ok(guard.index < workflow.indexOf('- run: npm publish'));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [tag, expected] of [[`v${version}`, 0], [`v${version}-wrong`, 1], [version, 1]]) {
    const result = spawnSync(process.execPath, ['-e', guard[1]], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: tag },
    });
    assert.equal(result.status, expected, result.stderr);
  }
});
