import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { topLevel, commonDir, mainCheckout, exclude } from '../src/project.mjs';

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'goldfished-project-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('plain repo and nested path with spaces', t => {
  const top = join(scratch(t), 'plain repo');
  const nested = join(top, 'one', 'two');
  mkdirSync(join(top, '.git'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  assert.equal(topLevel(nested), top);
  assert.equal(topLevel(top), top);
  assert.equal(commonDir(top), join(top, '.git'));
  assert.equal(mainCheckout(top), top);
});

test('no repo returns the supplied cwd', t => {
  const cwd = join(scratch(t), 'no repo');
  mkdirSync(cwd);
  assert.equal(topLevel(cwd), cwd);
});

for (const absolute of [false, true]) {
  test(`linked worktree with ${absolute ? 'absolute' : 'relative'} gitdir`, t => {
    const root = scratch(t);
    const main = join(root, 'main checkout');
    const shared = join(main, '.git');
    const admin = join(shared, 'worktrees', 'linked');
    const linked = join(root, 'linked checkout');
    mkdirSync(admin, { recursive: true });
    mkdirSync(join(linked, 'nested'), { recursive: true });
    writeFileSync(join(linked, '.git'), `gitdir: ${absolute ? admin : relative(linked, admin)}\n`);
    writeFileSync(join(admin, 'commondir'), '../..\n');
    writeFileSync(join(admin, 'gitdir'), join(linked, '.git') + '\n');
    assert.equal(topLevel(join(linked, 'nested')), linked);
    assert.equal(commonDir(linked), shared);
    assert.equal(mainCheckout(linked), main);
    assert.deepEqual(exclude(linked, '.goldfished/'), { added: true });
    assert.equal(readFileSync(join(shared, 'info', 'exclude'), 'utf8'), '.goldfished/\n');
  });
}

test('submodule-style gitdir file', t => {
  const root = scratch(t);
  const sub = join(root, 'submodule');
  const admin = join(root, '.git', 'modules', 'submodule');
  mkdirSync(admin, { recursive: true });
  mkdirSync(join(sub, 'nested'), { recursive: true });
  writeFileSync(join(sub, '.git'), `gitdir: ${relative(sub, admin)}\n`);
  assert.equal(topLevel(join(sub, 'nested')), sub);
  assert.equal(commonDir(sub), admin);
  assert.equal(mainCheckout(sub), dirname(admin));
});

for (const initial of ['', '# existing\n', '# existing\r\n', '# no final newline', '.goldfished/more\n']) {
  test(`exclude adds an exact line once: ${JSON.stringify(initial)}`, t => {
    const top = scratch(t);
    const info = join(top, '.git', 'info');
    mkdirSync(info, { recursive: true });
    const file = join(info, 'exclude');
    writeFileSync(file, initial);
    const eol = initial.includes('\r\n') ? '\r\n' : '\n';
    const expected = initial + (initial && !initial.endsWith('\n') ? eol : '') + '.goldfished/' + eol;
    assert.deepEqual(exclude(top, '.goldfished/'), { added: true });
    assert.equal(readFileSync(file, 'utf8'), expected);
    assert.deepEqual(exclude(top, '.goldfished/'), { added: false });
    assert.equal(readFileSync(file, 'utf8'), expected);
  });
}
