import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTracked } from '../src/git.mjs';

test('tracked, untracked, no repo and missing git', t => {
  const top = mkdtempSync(join(tmpdir(), 'goldfished-git-'));
  const empty = mkdtempSync(join(tmpdir(), 'goldfished-empty-'));
  t.after(() => {
    rmSync(top, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });
  for (const args of [['init'], ['add', '--', 'tracked file.txt', '-option.txt']]) {
    if (args[0] === 'add') {
      writeFileSync(join(top, 'tracked file.txt'), 'synthetic\n');
      writeFileSync(join(top, '-option.txt'), 'synthetic\n');
    }
    const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], {
      cwd: top, shell: false, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(isTracked(top, 'tracked file.txt'), true);
  assert.equal(isTracked(top, '-option.txt'), true);
  assert.equal(isTracked(top, 'missing.txt'), false);
  assert.equal(isTracked(empty, 'missing.txt'), null);
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(isTracked(top, 'tracked file.txt'), null);
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }
});
