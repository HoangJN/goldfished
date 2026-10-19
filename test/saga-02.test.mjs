import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderPaste, renderStory } from '../scripts/saga-pastes.mjs';

const PATH = new URL('./long/saga-02.story.jsonl', import.meta.url);
const PINNED = ['012bc345026407bd', '70410843423c182b', '36364e9e5965f5f7', '1335f0b75c43296d'].join('');
const started = Date.now();
const rawLines = readFileSync(PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const [head, ...raw] = rawLines;
const rendered = renderStory(PATH);
const [, ...turns] = rendered.trim().split('\n').map((l) => JSON.parse(l));
const atoms = raw.filter((t) => t.atom).map((t) => ({ ...t.atom, turn: t.turn }));
const all = turns.map((t) => t.text).join('\n');
const count = (hay, needle) => hay.split(needle).length - 1;

test('the story parses and has sixty turns', () => {
  assert.equal(head._synthetic, true);
  assert.equal(head.compactEvery, 2);
  assert.ok(Number.isInteger(head.seed) && head.cwd.startsWith('/'));
  assert.deepEqual(raw.map((t) => t.turn), Array.from({ length: 60 }, (_, i) => i + 1));
  for (const t of raw) assert.ok(t.reworded.length >= 20 && t.reworded.length <= 1500, `reworded on turn ${t.turn}`);
});

test('18 to 22 atoms with the kind mix, spread so no gap passes five turns', () => {
  assert.ok(atoms.length >= 18 && atoms.length <= 22);
  const kinds = (k) => atoms.filter((a) => a.kind === k).length;
  assert.ok(kinds('goal') >= 1 && kinds('change') >= 3 && kinds('rule') >= 7);
  assert.ok(kinds('ruled_out') >= 4 && kinds('withdraw') >= 3 && kinds('value') >= 2);
  assert.ok(atoms.some((a) => raw[a.turn - 1].text.startsWith('rule:')));
  assert.ok(atoms.some((a) => a.kind === 'rule' && !raw[a.turn - 1].text.startsWith('rule:')));
  assert.equal(atoms[0].turn, 1);
  assert.ok(atoms.at(-1).turn <= 56);
  atoms.forEach((a, i) => i && assert.ok(a.turn - atoms[i - 1].turn <= 5, `gap before turn ${a.turn}`));
  assert.equal(new Set(atoms.map((a) => a.id)).size, atoms.length);
});

test('every atom is a typed span that occurs once in the whole rendered story', () => {
  for (const a of atoms) {
    const words = a.text.split(/\s+/).length;
    assert.ok(words >= 5 && words <= 12, `${a.id} has ${words} words`);
    assert.equal(raw[a.turn - 1].paste, undefined, `${a.id} sits in a paste turn`);
    assert.ok(raw[a.turn - 1].text.includes(a.text), `${a.id} is not in its turn`);
    assert.equal(count(all, a.text), 1, `${a.id} occurs ${count(all, a.text)} times`);
    assert.ok(!raw.some((t) => t.reworded.includes(a.text)), `${a.id} leaks into a reworded line`);
  }
});

test('a superseded atom has a later replacing turn that is a change or a withdrawal', () => {
  for (const a of atoms.filter((x) => x.supersededAt !== null)) {
    assert.ok(a.supersededAt > a.turn && a.supersededAt <= 60, `${a.id} supersededAt`);
    assert.ok(atoms.some((b) => b.turn === a.supersededAt && ['change', 'withdraw'].includes(b.kind)), `${a.id} replacer`);
  }
});

test('each compaction renders 40,000 to 60,000 characters of new user text', () => {
  for (let k = 0; k < 30; k++) {
    const size = turns[2 * k].text.length + turns[2 * k + 1].text.length;
    assert.ok(size >= 40000 && size <= 60000, `compaction ${k + 1} renders ${size}`);
  }
});

test('pastes are plain ASCII with no URL or user path', () => {
  const pasted = turns.filter((t) => raw[t.turn - 1].paste).map((t) => t.text.slice(raw[t.turn - 1].text.length)).join('');
  assert.doesNotMatch(pasted, /https?:|www\.|\/home\/|\/Users\/|[A-Za-z]:\\|[^\x20-\x7e\n]/);
  assert.throws(() => renderPaste({ kind: 'poem', seed: 1, tokens: 10 }, head));
});

test('rendering twice gives the same bytes, pinned, inside five seconds', () => {
  assert.equal(renderStory(PATH), rendered);
  assert.equal(createHash('sha256').update(rendered).digest('hex'), PINNED);
  assert.ok(Date.now() - started < 5000);
});
