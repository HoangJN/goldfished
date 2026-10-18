import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { home, trust, trusted, untrustReason, state, setState, appendHistory, lastHistory, logError } from '../src/home.mjs';

test('home storage stays private and inside its temporary home', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'gfh-test-'));
  const dir = join(root, 'home');
  const original = process.env.GOLDFISHED_HOME;
  process.env.GOLDFISHED_HOME = dir;
  const before = readdirSync(root);
  try {
    assert.deepEqual(before, []);
    assert.equal(home(process.env), dir);
    const card = join(dir, 'Card.md');
    writeFileSync(card, 'synthetic card', { mode: 0o600 });

    await t.test('trust round trip and exact reasons', () => {
      assert.equal(trusted(card, 'aa'), false);
      assert.equal(untrustReason(card, 'aa'), 'never saved through goldfished on this machine');
      trust(card, 'aa');
      assert.equal(trusted(card, 'aa'), true);
      assert.equal(untrustReason(card, 'aa'), null);
      const records = JSON.parse(readFileSync(join(dir, 'trust.json')));
      const key = process.platform === 'win32' ? realpathSync(card).toLowerCase() : realpathSync(card);
      assert.equal(untrustReason(card, 'bb'), `changed by hand since ${records[key].date.slice(0, 10)}`);
    });

    await t.test('path spellings share one trust record', () => {
      if (process.platform === 'win32') {
        trust(card.toUpperCase(), 'aa');
        assert.equal(trusted(card.toUpperCase(), 'aa'), true);
      }
      const alias = join(dir, 'alias.md');
      let linked = false;
      try {
        symlinkSync(card, alias);
        linked = true;
      } catch (err) {
        if (!['EPERM', 'EACCES', 'ENOSYS'].includes(err.code)) throw err;
      }
      if (linked) {
        assert.equal(trusted(alias, 'aa'), true);
        trust(alias, 'bb');
        assert.equal(trusted(card, 'bb'), true);
      }
      assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, 'trust.json')))).length, 1);
    });

    await t.test('state shallow merge and corrupt files', () => {
      assert.deepEqual(state(), {});
      setState({ _synthetic: true, probe: { agent: 'sample', kept: true } });
      setState({ probe: { kept: false }, count: 2 });
      assert.deepEqual(state(), { _synthetic: true, probe: { kept: false }, count: 2 });
      for (const content of ['{broken', 'null', '[]']) {
        writeFileSync(join(dir, 'trust.json'), content);
        writeFileSync(join(dir, 'state.json'), content);
        assert.equal(untrustReason(card, 'aa'), 'never saved through goldfished on this machine');
        assert.deepEqual(state(), {});
      }
      setState({ _synthetic: true });
      trust(card, 'aa');
      assert.equal(trusted(card, 'aa'), true);
      assert.deepEqual(state(), { _synthetic: true });
    });

    await t.test('history round trip and inclusive date boundary', () => {
      assert.equal(lastHistory('sample', Infinity), null);
      const first = { _synthetic: true, id: 'sample', date: '2026-01-01T00:00:00.000Z', count: 1 };
      const later = { ...first, date: '2026-01-03T00:00:00.000Z', count: 2 };
      appendHistory(later);
      appendHistory({ ...first, id: 'other' });
      appendHistory(first);
      const ms = Date.parse(first.date);
      assert.equal(lastHistory('sample', ms - 1), null);
      assert.deepEqual(lastHistory('sample', ms), first);
      assert.deepEqual(lastHistory('sample', ms + 1), first);
      assert.deepEqual(lastHistory('sample', Infinity), later);
      assert.equal(lastHistory('absent', Infinity), null);
      assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 3);
    });

    await t.test('error log excludes handled input and keeps newest whole lines within 64 KB', () => {
      const canary = 'synthetic-private-canary-92641';
      let failure;
      try {
        const err = new Error('synthetic failure');
        err.input = canary;
        err.arguments = [canary];
        err.text = canary;
        throw err;
      } catch (err) {
        failure = err;
      }
      for (let i = 0; i < 2000; i++) logError(failure);
      const file = join(dir, 'errors.log');
      const text = readFileSync(file, 'utf8');
      assert.ok(statSync(file).size <= 64 * 1024);
      assert.ok(text.length > 0);
      assert.equal(text.includes(canary), false);
      for (const line of text.trim().split('\n')) {
        const entry = JSON.parse(line);
        assert.deepEqual(Object.keys(entry), ['date', 'message', 'stack']);
        assert.equal(entry.message, failure.message);
        assert.equal(entry.stack, failure.stack);
        assert.ok(Number.isFinite(Date.parse(entry.date)));
      }
      logError(new Error('newest synthetic failure'));
      assert.match(readFileSync(file, 'utf8').trim().split('\n').at(-1), /newest synthetic failure/);
      logError(new Error('x'.repeat(70000)));
      assert.ok(statSync(file).size <= 64 * 1024);
    });

    await t.test('permissions and directory contents', () => {
      if (process.platform !== 'win32') {
        chmodSync(dir, 0o755);
        home(process.env);
        assert.equal(statSync(dir).mode & 0o777, 0o700);
        for (const name of ['trust.json', 'state.json', 'history.jsonl', 'errors.log']) {
          assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600);
        }
      }
      assert.deepEqual(readdirSync(root), ['home']);
      const expected = ['Card.md', 'errors.log', 'history.jsonl', 'state.json', 'trust.json'];
      if (existsSync(join(dir, 'alias.md')) && lstatSync(join(dir, 'alias.md')).isSymbolicLink()) expected.push('alias.md');
      assert.deepEqual(readdirSync(dir).sort(), expected.sort());
    });
  } finally {
    if (original === undefined) delete process.env.GOLDFISHED_HOME;
    else process.env.GOLDFISHED_HOME = original;
    rmSync(root, { recursive: true, force: true });
  }
});
