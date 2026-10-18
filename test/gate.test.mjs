import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkFile, parseDenylist } from '../scripts/gate.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'goldfished-gate-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const EM = String.fromCharCode(0x2014);
const ANT_KEY = ['sk', 'ant', 'x'.repeat(12)].join('-');

function run(file, body, denylist = []) {
  const path = join(scratch, `${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(path, body);
  return checkFile({ file, text: readFileSync(path, 'utf8'), denylist });
}

test('an em-dash is caught, with its line number', () => {
  const found = run('notes.md', `fine\nbroken ${EM} here\n`);
  assert.deepEqual(found.map((f) => [f.check, f.line]), [['em-dash', 2]]);
});

test('a secret shape is caught', () => {
  const found = run('config.json', `{"key": "${ANT_KEY}"}\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].check, 'secrets');
});

test('a long mixed run is caught, a long plain word is not', () => {
  assert.equal(run('a.txt', `${'ab12'.repeat(8)}\n`).length, 1);
  assert.equal(run('a.txt', `${'abcd'.repeat(9)}\n`).length, 0);
});

test('the allow marker exempts its own line only', () => {
  const found = run('a.txt', `${ANT_KEY} gate-allow\n${ANT_KEY}\nbroken ${EM} gate-allow\n`);
  assert.deepEqual(found.map((f) => f.line), [2]);
});

test('a network import in src is caught, and only in src', () => {
  const body = "import http from 'node:http';\nconst r = require('child_process');\nawait fetch('x');\n";
  assert.deepEqual(run('src/a.mjs', body).map((f) => f.line), [1, 2, 3]);
  assert.equal(run('scripts/a.mjs', body).length, 0);
});

test('an unprefixed network import is caught', () => {
  assert.equal(run('src/a.mjs', "import dns from 'dns/promises';\n").length, 1);
});

test('denylist matches any case, and short all-caps patterns need a word boundary', () => {
  const list = parseDenylist('# comment\nBadWord\nABC\n');
  assert.equal(run('a.md', 'a BADWORD appears\n', list).length, 1);
  assert.equal(run('a.md', 'abc stands alone\n', list).length, 1);
  assert.equal(run('a.md', 'abcdef does not\n', list).length, 0);
  assert.equal(run('a.md', 'BadWord gate-allow\n', list).length, 0);
});

test('absolute user paths are caught', () => {
  const win = ['C:', 'Users', 'someone'].join('\\');
  assert.equal(run('a.md', `see ${win}\\file\n`).length, 1);
  assert.equal(run('a.md', 'see /home/someone/file\n').length, 1); // gate-allow
  assert.equal(run('a.md', 'see ./relative/file\n').length, 0);
});

test('fixtures must say they are synthetic, canaries skip the secret scan', () => {
  const key = `{"_synthetic": true, "_canary": true, "text": "${ANT_KEY}"}\n`;
  assert.equal(run('test/fixtures/c.jsonl', key).length, 0);
  assert.equal(run('src/c.jsonl', key).length, 1);
  assert.equal(run('test/fixtures/d.jsonl', '{"text": "plain"}\n').length, 1);
  assert.equal(run('test/fixtures/e.jsonl', '{"_synthetic": true}\n').length, 0);
});
