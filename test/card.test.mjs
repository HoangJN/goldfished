import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, serialise, add, edit, drop, restore, hash, block, gauge } from '../src/card.mjs';
import { matchSnapshot } from './snapshot.mjs';

const today = '2026-10-18', empty = () => ({ goal: null, rules: [], out: [], errors: [] });
const example = readFileSync(new URL('./snapshots/card/spec-example.txt', import.meta.url), 'utf8');
const seed = { _synthetic: true, value: 609 };
const random = () => { seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0; return seed.value / 4294967296; };
const labelParts = ['Cache', 'café', '魚', '🐟', '"', "'", '.', ' ', 'file'];
const randomLabel = () => Array.from({ length: 1 + Math.floor(random() * 6) }, () => labelParts[Math.floor(random() * labelParts.length)]).join('');
const runBlock = (card, opts = {}) => block(card, { trusted: true, budget: 6000, maxChars: 6000, kind: 'resend', ...opts });

test('SPEC example is byte-exact, with four block snapshots', () => {
  const card = parse(example);
  assert.deepEqual(card.errors, []);
  assert.equal(serialise(card), example);
  assert.equal(card.rules.length, 2); assert.equal(card.out.length, 1);
  for (const kind of ['resend', 'inline']) for (const trusted of [true, false]) {
    const result = runBlock(card, { kind, trusted, budget: 9500 });
    matchSnapshot('card', `${kind}-${trusted ? 'trusted' : 'untrusted'}`, result.text);
    assert.equal(result.text.includes('BEFORE '), trusted); assert.deepEqual(result.left, []);
  }
});

test('every malformed section line is reported with its number', () => {
  const source = '# goldfished card\r\n## RULES\r\n  orphan\r\nbad\r\n[r01 | 2026-10-18] first\r\n  second\r\nwrong\r\n[r2 | 2026-10-18] wrong id\r\n\r\n## unknown\r\n';
  const card = parse(source);
  assert.deepEqual(card.errors.map(error => error.line), [3, 4, 7, 8, 10]);
  assert.equal(card.rules[0].text, 'first\nsecond');
  assert.equal(serialise(card).includes('\r'), false);
  assert.equal(parse('## GOAL\n[g01 | 2026-10-18] one\n[g02 | 2026-10-18] two').errors.length, 1);
  assert.equal(parse('## RULED OUT\n[x01 | 2026-10-18] no quote').errors.length, 1);
});

for (const [section, limit, subject] of [['goal', 600, 'goal'], ['rules', 1500, 'rule'], ['out', 200, 'ruled out entry']]) {
  for (const over of [0, 1]) test(`${section} ${over ? 'over' : 'at'} character cap`, () => {
    const card = empty(), archive = [], text = '🐟'.repeat(limit + over), before = serialise(card);
    const fields = section === 'out' ? { label: '', quote: text } : { text };
    const result = add(card, archive, section, fields, today);
    if (over) assert.equal(result.refused, `goldfished: that ${subject} is ${limit + 1} characters; the limit is ${limit}. Nothing was changed. Shorten it, in your own words.`);
    else assert.ok(result.id);
    assert.equal(serialise(card), before); assert.deepEqual(archive, []);
  });
}
for (const over of [false, true]) test(`ruled out count ${over ? 'over' : 'at'} cap`, () => {
  let card = empty();
  for (let i = 0; i < 7; i++) card = add(card, [], 'out', { label: 'Cache', quote: 'No service' }, today).card;
  if (over) card = add(card, [], 'out', { label: 'Cache', quote: 'No service' }, today).card;
  const before = serialise(card), result = add(card, [], 'out', { label: 'Other', quote: 'No service' }, today);
  if (over) assert.equal(result.refused, 'goldfished: that ruled out section is 9 entries; the limit is 8. Nothing was changed. Shorten it, in your own words.');
  else assert.equal(result.card.out.length, 8);
  assert.equal(serialise(card), before);
});

test('archive, replacements, edits, restores and ids stay immutable', () => {
  const first = add(empty(), [], 'goal', { text: 'First goal' }, today);
  const next = add(first.card, first.archive, 'goal', { text: 'Next goal' }, today);
  assert.equal(next.id, 'g02'); assert.equal(next.archive[0].reason, 'replaced');
  const removed = drop(next.card, next.archive, 'g02', today);
  const third = add(removed.card, removed.archive, 'goal', { text: 'Third goal' }, today);
  assert.equal(third.id, 'g03');
  const restored = restore(third.card, third.archive, 'g01', today);
  assert.equal(restored.card.goal.id, 'g01'); assert.equal(restored.card.goal.date, today);
  assert.equal(restored.archive.at(-1).entry.id, 'g03');
  const before = serialise(restored.card), saved = JSON.stringify(restored.archive);
  assert.ok(edit(restored.card, restored.archive, 'g01', 'a'.repeat(601), today).refused);
  assert.equal(serialise(restored.card), before); assert.equal(JSON.stringify(restored.archive), saved);
  assert.equal(edit(restored.card, restored.archive, 'g01', 'Changed', '2026-10-19').card.goal.date, '2026-10-19');
  const edited = edit(restored.card, restored.archive, 'g01', 'Changed', '2026-10-19');
  assert.deepEqual(edited.archive.at(-1), { section: 'goal', entry: restored.card.goal, reason: 'edited', date: '2026-10-19' });
  assert.match(restore(empty(), [edited.archive.at(-1)], 'g01', today).refused, /earlier wording, not a dropped entry/u);
  assert.ok(drop(empty(), [], 'r01', today).refused); assert.ok(restore(empty(), [], 'r01', today).refused);
});

test('200 seeded cards round-trip and pack whole entries within both caps', () => {
  for (let n = 0; n < 200; n++) {
    const card = empty();
    card.goal = { id: 'g01', date: today, text: 'Deliver 魚 🐟'.repeat(1 + Math.floor(random() * 40)) };
    for (let i = 0, length = n === 0 ? 200 : Math.floor(random() * 30); i < length; i++) card.rules.push({ id: `r${String(i + 1).padStart(2, '0')}`, date: today, text: i === 0 ? '🐟'.repeat(1500) : `Rule ${i} café\n${'魚 🐟'.repeat(1 + Math.floor(random() * 80))}` });
    for (let i = 0; i < Math.floor(random() * 9); i++) card.out.push({ id: `x0${i + 1}`, date: today, label: randomLabel(), quote: 'Keep it simple 🐟' });
    assert.deepEqual(parse(serialise(card)), card);
    const result = runBlock(card), ids = [...(card.goal ? [card.goal] : []), ...card.out, ...card.rules].map(entry => entry.id);
    assert.ok(Buffer.byteLength(result.text) <= 6000); assert.ok([...result.text].length <= 6000);
    assert.ok(result.shown.includes('g01')); assert.ok(result.text.includes(card.goal.text));
    assert.deepEqual([...result.shown, ...result.left].sort(), ids.sort());
    if (card.rules.length) { assert.ok(!result.shown.includes('r01')); assert.ok(result.left.includes('r01')); }
    for (const out of card.out) assert.ok(result.shown.includes(out.id));
    if (result.left.length) assert.ok(result.text.includes(`goldfished: ${result.left.length} of ${ids.length} entries not shown here (${result.left.slice(0, 10).join(', ')}${result.left.length > 10 ? ` and ${result.left.length - 10} more` : ''}). Run goldfished list to see them.`));
    else assert.ok(!result.text.includes('not shown here'));
  }
});

test('edit and restore enforce all caps without changing either input', () => {
  for (const [section, limit] of [['goal', 600], ['rules', 1500], ['out', 200]]) {
    const fields = section === 'out' ? { label: 'Cache', quote: 'Never' } : { text: 'Keep it simple' };
    const state = add(empty(), [], section, fields, today), before = JSON.stringify(state);
    const text = section === 'out' ? `. User said: "${'a'.repeat(limit + 1)}"` : 'a'.repeat(limit + 1);
    assert.ok(edit(state.card, state.archive, state.id, text, today).refused);
    const atLimit = section === 'out' ? `. User said: "${'🐟'.repeat(limit)}"` : '🐟'.repeat(limit);
    assert.ok(!edit(state.card, state.archive, state.id, atLimit, today).refused);
    assert.equal(JSON.stringify(state), before);
    const saved = [{ section, entry: { id: state.id, date: today, ...(section === 'out' ? { label: '', quote: 'a'.repeat(limit + 1) } : { text: 'a'.repeat(limit + 1) }) }, reason: 'dropped', date: today }];
    const savedBefore = JSON.stringify(saved);
    assert.ok(restore(empty(), saved, state.id, today).refused); assert.equal(JSON.stringify(saved), savedBefore);
  }
  let card = empty();
  for (let i = 0; i < 9; i++) {
    const added = add(card, [], 'out', { label: '', quote: 'No' }, today);
    if (i < 8) card = added.card;
    else assert.ok(restore(card, [{ section: 'out', entry: { id: 'x09', date: today, label: '', quote: 'No' }, reason: 'dropped', date: today }], 'x09', today).refused);
  }
});

test('packing skips oversized rules, reserves 200 bytes and honours maxChars', () => {
  const card = empty(); card.rules = [{ id: 'r01', date: today, text: 'a'.repeat(1500) }, { id: 'r02', date: today, text: 'Small' }];
  const baseline = runBlock({ ...empty(), rules: [card.rules[1]] });
  const budget = Buffer.byteLength(baseline.text) + 200;
  const packed = runBlock(card, { budget });
  assert.deepEqual(packed.shown, ['r02']); assert.deepEqual(packed.left, ['r01']);
  matchSnapshot('card', 'resend-trusted-overflow', packed.text);
  assert.ok(packed.text.includes('Small\n\ngoldfished: 1 of 2 entries'));
  assert.ok(packed.text.includes('to see them.\nBEFORE YOUR NEXT ACTION'));
  const characterCapped = runBlock(card, { budget: 9500, maxChars: 1200 });
  assert.deepEqual(characterCapped.shown, ['r02']); assert.ok([...characterCapped.text].length <= 1200);
  assert.throws(() => runBlock(card, { budget: 1 }), RangeError);
});

for (const [goal, rules, out, what] of [
  [false, false, false, ''], [true, false, false, 'GOAL'], [false, true, false, 'RULES'], [false, false, true, 'RULED OUT'],
  [true, true, false, 'GOAL'], [true, false, true, 'GOAL and RULED OUT'], [false, true, true, 'RULES and RULED OUT'], [true, true, true, 'GOAL and RULED OUT']
]) test(`BEFORE sections: goal=${goal}, rules=${rules}, out=${out}`, () => {
  const exampleCard = parse(example), card = { ...empty(), goal: goal ? exampleCard.goal : null, rules: rules ? exampleCard.rules : [], out: out ? exampleCard.out : [] };
  for (const kind of ['resend', 'inline']) {
    const { text } = runBlock(card, { kind });
    if (!what) assert.equal(text, '');
    else { assert.ok(text.includes(`check it against ${what}. If it ${goal ? 'does not serve the goal' : 'breaks a rule'}`)); assert.ok(/\n\nBEFORE /.test(text)); }
  }
});

for (const [name, label] of [['LF', 'Cache\nservice'], ['CR', 'Cache\rservice'], ['CRLF', 'Cache\r\nservice'], ['NEL', 'Cache\u0085service'], ['LS', 'Cache\u2028service'], ['PS', 'Cache\u2029service'], ['quote marker', 'Cache. User said: "no']]) {
  test(`add and edit refuse a label containing ${name} without changing the card or archive`, () => {
    const state = add(empty(), [], 'out', { label: 'Cache', quote: 'No service' }, today), before = serialise(state.card), saved = JSON.stringify(state.archive);
    assert.deepEqual(add(state.card, state.archive, 'out', { label, quote: 'No service' }, today), { refused: `goldfished: a label must be one line and cannot contain '. User said: "'. Nothing was changed.` });
    assert.deepEqual(edit(state.card, state.archive, state.id, { label, quote: 'No service' }, today), { refused: `goldfished: a label must be one line and cannot contain '. User said: "'. Nothing was changed.` });
    if (name !== 'quote marker') assert.deepEqual(edit(state.card, state.archive, state.id, `${label}. User said: "No service"`, today), { refused: `goldfished: a label must be one line and cannot contain '. User said: "'. Nothing was changed.` });
    assert.equal(serialise(state.card), before); assert.equal(JSON.stringify(state.archive), saved);
  });
}

test('a quote may contain the label marker in both forms of edit', () => {
  const quote = 'Keep the words . User said: "no" exactly.', state = add(empty(), [], 'out', { label: 'Cache', quote }, today);
  assert.deepEqual(parse(serialise(state.card)), state.card);
  for (const text of [{ label: 'Other', quote }, `Other. User said: "${quote}"`]) {
    const changed = edit(state.card, state.archive, state.id, text, today);
    assert.equal(changed.card.out[0].quote, quote); assert.deepEqual(parse(serialise(changed.card)), changed.card);
  }
});

test('empty sections, missing goal and all untrusted causes use the exact framing', () => {
  assert.deepEqual(runBlock(empty()), { text: '', shown: [], left: [] });
  const card = add(empty(), [], 'rules', { text: 'Keep it simple' }, today).card;
  const text = runBlock(card).text;
  assert.ok(text.includes('check it against RULES. If it breaks a rule or touches something ruled out'));
  assert.ok(!text.includes('GOAL (set')); assert.ok(!text.includes('\nRULED OUT'));
  for (const reason of ['hand edit', 'no trust record', 'parse error']) {
    const result = runBlock({ ...card, errors: reason === 'parse error' ? [{ line: 1, reason }] : [] }, { trusted: reason === 'parse error' });
    assert.ok(result.text.startsWith('goldfished: the card below came from the project folder'));
    assert.ok(!result.text.includes('BEFORE '));
  }
  assert.equal(hash('abc'), ['ba7816bf', '8f01cfea', '414140de', '5dae2223', 'b00361a3', '96177a9c', 'b410ff61', 'f20015ad'].join(''));
  assert.notEqual(hash('魚'), hash('鱼'));
  assert.deepEqual(gauge(parse(example), 9500), { bytes: Buffer.byteLength(runBlock(parse(example), { budget: 9500 }).text), budget: 9500 });
});
