import test from 'node:test';
import assert from 'node:assert/strict';
import { FISH, verdict } from '../src/fun.mjs';

test('fish and all verdict lines are literal', () => {
  assert.equal(FISH, '><(((o>   ');
  const lines = [
    ['goldfish', 'Goldfish. More than half your words were gone after the first compaction.'],
    ['short', 'Short memory. More than half your words are gone by the second compaction.'],
    ['fair', 'Fair memory. Half your words are still there after two, not after three.'],
    ['long', 'Long memory. At least half your words survive 3 compactions.'],
  ];
  lines.forEach(([id, line], span) => assert.deepEqual(verdict({ span, censored: false }), { id, line }));
  for (const span of [1, 2, 3, 6]) assert.deepEqual(verdict({ span, censored: true }),
    { id: 'at_least', line: `At least ${span} ${span === 1 ? 'compaction' : 'compactions'} so far.` });
  for (const censored of [false, true]) assert.deepEqual(verdict({ span: null, censored }),
    { id: 'too_early', line: 'Too early to say. Too few compacted messages so far.' });
  assert.deepEqual(verdict({ span: 6, censored: false }),
    { id: 'long', line: 'Long memory. At least half your words survive 6 compactions.' });
});
