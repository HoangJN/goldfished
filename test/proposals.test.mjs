import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialise, add, take } from '../src/proposals.mjs';
import { add as addCard } from '../src/card.mjs';

test('proposals round-trip with masked, bounded source and clean notes', () => {
  const list = parse(''), before = serialise(list);
  const result = add(list, { quote: 'Keep dependencies at zero.', note: '\u001b[31mNo\nnew\rservices\u0007\u2028' + '🐟'.repeat(90), from: 'reader@example.test ' + '魚🐟'.repeat(200) });
  assert.equal(serialise(list), before); assert.equal(result.id, 'p1');
  const entry = result.list.entries[0];
  assert.equal([...entry.note].length, 80); assert.ok(entry.note.startsWith('Nonewservices'));
  assert.ok(entry.from.startsWith('[hidden] ')); assert.equal([...entry.from].length, 160);
  assert.deepEqual(parse(serialise(result.list)), result.list);
  const taken = take(result.list, 'p1'); assert.deepEqual(taken.proposal, entry);
  assert.equal(taken.list.entries.length, 0); assert.equal(add(taken.list, entry).id, 'p2');
  assert.ok(take(taken.list, 'p1').refused);
  const card = addCard({ goal: null, rules: [], out: [], errors: [] }, [], 'out', { label: 'Dependencies', quote: taken.proposal.quote }, '2026-10-18').card;
  assert.equal(card.out[0].quote, entry.quote); assert.ok(!JSON.stringify(card).includes(entry.note));
});

test('malformed proposal state fails instead of losing entries', () => {
  for (const source of ['bad', '{}', '{"next":0,"entries":[]}', '{"next":1,"entries":[{"id":"p1","quote":"a","note":"b","from":"c"}]}']) assert.throws(() => parse(source));
});
