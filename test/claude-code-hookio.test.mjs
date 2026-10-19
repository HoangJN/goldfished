import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as hookio from '../src/agents/claude-code.hookio.mjs';

const rows = readFileSync(new URL('../TESTED.md', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.startsWith('| claude-code |'))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map((c) => ({ proof: c[4], result: c[5], shown: c[6] }));

test('every export is there', () => {
  for (const k of ['inputKeys', 'contextOutput', 'screenOutput', 'blockOutput', 'contextCap', 'proved']) assert.ok(k in hookio, k);
});

test('input keys are the ones the proofs saw', () => {
  assert.deepEqual(hookio.inputKeys, { prompt: 'prompt', cwd: 'cwd', source: 'source', humanOrigin: null });
});

test('output builders return the shapes the proofs showed', () => {
  assert.deepEqual(hookio.contextOutput('card'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'card' } });
  assert.deepEqual(hookio.screenOutput('line'), { systemMessage: 'line' });
  assert.deepEqual(hookio.blockOutput('reply'), { decision: 'block', reason: 'reply' });
});

test('the context cap is what P5 found', () => {
  assert.deepEqual(hookio.contextCap, { chars: 10000, bytes: Infinity });
  assert.match(rows.find((r) => r.proof === 'P5').shown, /10,000 characters/);
});

test('proved says pass only where TESTED.md says pass', () => {
  assert.deepEqual(Object.keys(hookio.proved).sort(), rows.map((r) => r.proof).sort());
  for (const r of rows) assert.equal(hookio.proved[r.proof], r.result === 'pass', r.proof);
});
