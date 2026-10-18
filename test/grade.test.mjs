import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADER, prepare, score, bestMatch } from '../src/grade.mjs';

// Invented: a catalogue with a restriction buried in the middle.
const catalogue = 'Preserve the crystallographic calibration catalogue throughout publication. Display representative measurements alongside descriptive annotations. The background synchronisation process must never replace unpublished observations. Retain chronological ordering, identifiable provenance, reversible transformations and comprehensive validation diagnostics. Present inconsistent measurements separately, without automatically correcting unexpected numerical differences or suppressing investigative warnings.';
// Invented: a long display request with two independent parts.
const observatory = 'Arrange the observatory instrument descriptions alphabetically beneath the demonstration photograph. Preserve the original measurement identifiers beside their descriptive headings, and display calibration uncertainties without rounding intermediate calculations. Keep explanatory paragraphs selectable during magnification. Separate the chronological maintenance record from the instrument catalogue, with independent navigation controls and a persistent heading identifying the selected instrument.';

const cases = [
  // Invented: short, kept, five-word run.
  { band: 'short', label: 'kept', message: 'Keep copper lantern labels visible.', summary: 'Next request: Keep copper lantern labels visible.', _synthetic: true },
  // Invented: short, kept, exact substring under five words.
  { band: 'short', label: 'kept', message: 'Preserve the silver weathercock.', summary: 'Preserve the silver weathercock. Finish the drawing.', _synthetic: true },
  // Invented: short, reworded, significant words survive.
  { band: 'short', label: 'reworded', message: 'Preserve copper lantern markings.', summary: 'Copper lantern markings should remain intact.', _synthetic: true },
  // Invented: short, reworded, a different verb.
  { band: 'short', label: 'reworded', message: 'Retain purple sundial headings.', summary: 'Purple sundial headings stay legible.', _synthetic: true },
  // Invented: short, gone, four opening words coincide.
  { band: 'short', label: 'gone', message: 'Keep the paper crane folded at launch.', summary: 'Keep the paper crane illustration beside the title.', _synthetic: true },
  // Invented: short, gone, colour alone survives.
  { band: 'short', label: 'gone', message: 'Prevent violet turbines restarting.', summary: 'The gallery shows a violet stone.', _synthetic: true },
  // Invented: mid, kept, the whole instruction.
  { band: 'mid', label: 'kept', message: 'Retain the cobalt drawer selection when the details panel closes, including after a keyboard edit.', summary: 'Retain the cobalt drawer selection when the details panel closes, including after a keyboard edit.', _synthetic: true },
  // Invented: mid, kept, a small trim at the leading edge.
  { band: 'mid', label: 'kept', message: 'Well please preserve the amber cabinet selection while the adjacent drawer opens and closes during keyboard navigation.', summary: 'Please preserve the amber cabinet selection while the adjacent drawer opens and closes during keyboard navigation.', _synthetic: true },
  // Invented: mid, reworded, only a quoted fragment remains.
  { band: 'mid', label: 'reworded', message: 'Keep the brass telescope aligned with the north marker and display a warning whenever calibration fails.', summary: 'Request fragment: "Keep the brass telescope aligned with the north marker". The warning was omitted.', _synthetic: true },
  // Invented: mid, reworded, wording changes but significant words remain.
  { band: 'mid', label: 'reworded', message: 'Preserve copper compass markings during export and retain the selected calibration preset after a failed save.', summary: 'Export must preserve the selected calibration preset and retain copper compass markings.', _synthetic: true },
  // Invented: mid, gone, a shared opening describes different work.
  { band: 'mid', label: 'gone', message: 'Place the blue kite control beside the altitude entry and disable its action until the draft is valid.', summary: 'Place the blue kite sketch beside the cloud illustration in the guide.', _synthetic: true },
  // Invented: mid, gone, unrelated work.
  { band: 'mid', label: 'gone', message: 'Reject empty labels before saving the miniature submarine route and retain all entered coordinates after an error.', summary: 'Adjust the chapter heading and centre its decorative illustration.', _synthetic: true },
  // Invented: long, kept, intact catalogue request.
  { band: 'long', label: 'kept', message: catalogue, summary: 'Outstanding request: ' + catalogue, _synthetic: true },
  // Invented: long, kept, intact observatory request.
  { band: 'long', label: 'kept', message: observatory, summary: observatory + ' The illustration is separate.', _synthetic: true },
  // Invented: long, reworded, the condition word is dropped.
  { band: 'long', label: 'reworded', message: catalogue, summary: catalogue.replace('must never replace', 'must replace'), _synthetic: true },
  // Invented: long, reworded, only the opening part is quoted.
  { band: 'long', label: 'reworded', message: observatory, summary: 'Quoted request: "' + observatory.split(' Keep explanatory')[0] + '"', _synthetic: true },
  // Invented: long, gone, the same first four words lead elsewhere.
  { band: 'long', label: 'gone', message: catalogue, summary: 'Preserve the crystallographic calibration drawing in the chapter artwork folder. Fix the page margin next.', _synthetic: true },
  // Invented: long, gone, a completion claim supplies no instructions.
  { band: 'long', label: 'gone', message: observatory, summary: 'The observatory illustration is finished. Next proofread the guide introduction.', _synthetic: true },
];

for (const [i, row] of cases.entries()) test(`${row.band} ${row.label}: ${i + 1}`, () => {
  const length = [...row.message].length;
  assert.equal(row._synthetic, true);
  assert.ok(row.band === 'short' ? length >= 20 && length <= 60 : row.band === 'mid' ? length > 60 && length <= 300 : length > 300 && length <= 1500);
  assert.equal(score(row.message, prepare(row.summary)).label, row.label);
});

test('the selected grader and the table cover all nine cells', () => {
  assert.deepEqual(GRADER, { id: 'G2', threshold: 0.9 });
  for (const band of ['short', 'mid', 'long']) for (const label of ['kept', 'reworded', 'gone']) {
    assert.ok(cases.filter(row => row.band === band && row.label === label).length >= 2);
  }
});

test('normalisation treats both sides alike', () => {
  // Invented: capitals, spaces, straight and curved quotes, backticks and stars.
  const plain = 'Keep the copper lantern visible';
  const decorated = '  **KEEP**\n the\t`copper`  \u201clantern\u201d "VISIBLE"  ';
  assert.deepEqual(score(decorated, prepare(plain)), { label: 'kept', score: 1 });
  assert.deepEqual(score(plain, prepare(decorated)), { label: 'kept', score: 1 });
  // Invented: removed quotes join letters even inside a short substring.
  assert.equal(score('The owls bell', prepare('The owl\u2019s `bell`')).label, 'kept');
  // Invented: exact means a substring, including inside a larger word.
  assert.equal(score('copper', prepare('A copperplate illustration')).label, 'kept');
});

test('empty input and missing short phrases stay gone', () => {
  // Invented: no words, an empty summary and a short near match.
  for (const [message, summary] of [['', 'A lantern'], [' ** ` " ', 'A lantern'], ['Keep it', ''], ['Keep it', 'Keep this']]) {
    assert.deepEqual(score(message, prepare(summary)), { label: 'gone', score: 0 });
  }
});

test('a prepared summary serves repeated scores without changing', () => {
  // Invented: the hand-built table supplies a mixture of matching instructions.
  for (const row of cases) {
    const index = prepare(row.summary);
    for (let pass = 0; pass < 3; pass++) for (const { message } of cases) {
      assert.deepEqual(score(message, index), score(message, prepare(row.summary)));
    }
  }
});

test('short exact lookup agrees with substring search', () => {
  // Invented: a deterministic alphabet exercises branching and repeated substrings.
  let seed = 831;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let trial = 0; trial < 100; trial++) {
    const visible = Array.from({ length: 100 }, () => String.fromCharCode(97 + random() % 7)).join('');
    const index = prepare(visible);
    for (let j = 0; j < 30; j++) {
      const query = j < 15 ? visible.slice(j, j + 1 + random() % 12) : Array.from({ length: 1 + random() % 12 }, () => String.fromCharCode(97 + random() % 7)).join('');
      assert.equal(score(query, index).label, visible.includes(query) ? 'kept' : 'gone');
    }
  }
});

test('four megabytes prepare under two seconds and score a thousand times under one', t => {
  // Invented: repeated background prose, a distant match and an absent ending.
  const needle = 'Preserve the copper pendulum beside the dial during resets.';
  const visible = ('The quiet workshop displays wooden carvings beside a window. '.repeat(72000)).slice(0, 4 * 1024 * 1024 - needle.length - 1) + ' ' + needle;
  assert.equal(Buffer.byteLength(visible), 4 * 1024 * 1024);
  const start = performance.now(), index = prepare(visible), prepared = performance.now() - start;
  const messages = [needle, 'copper pendulum', 'The quiet workshop absent', 'wooden carvings absent'];
  const expected = ['kept', 'kept', 'reworded', 'reworded'];
  const scoring = performance.now();
  for (let i = 0; i < 1000; i++) assert.equal(score(messages[i % 4], index).label, expected[i % 4]);
  const scored = performance.now() - scoring;
  t.diagnostic(`prepare=${prepared.toFixed(1)}ms score1000=${scored.toFixed(1)}ms`);
  assert.ok(prepared < 2000, `prepare took ${prepared}ms`);
  assert.ok(scored < 1000, `score took ${scored}ms`);
});

test('audit returns an original eighty-character window with the most shared words', () => {
  // Invented: isolated matches compete with a cluster at the end.
  const visible = 'copper ' + '.'.repeat(90) + ' lantern ' + '.'.repeat(90) + ' Copper lantern pendulum visible beside the brass dial. ' + '.'.repeat(100);
  const window = bestMatch('Keep the copper lantern pendulum visible', visible);
  assert.equal(window.length, 80);
  assert.ok(visible.includes(window));
  assert.match(window, /Copper lantern pendulum visible/);
  const shared = text => new Set((text.toLowerCase().match(/\b\w+\b/g) ?? []).filter(word => ['keep', 'the', 'copper', 'lantern', 'pendulum', 'visible'].includes(word))).size;
  for (let i = 0; i <= visible.length - 80; i++) assert.ok(shared(window) >= shared(visible.slice(i, i + 80)));
  // Invented: a short summary and a summary without any matching word.
  assert.equal(bestMatch('copper lantern', 'Tiny lantern.'), 'Tiny lantern.');
  assert.equal(bestMatch('missing', '.'.repeat(100)), '.'.repeat(80));
  assert.equal(bestMatch('missing', ''), '');
});

// Invented: edge restrictions fit even the short band.
const restrictions = [
  'Never let a red fox sit by a blue cup on a low box.',
  'Only let a tan dog lie by a red pot on a dry mat.',
];
// Invented: small words extend a request without adding long-word evidence.
const tail = ' Let the red bar and the blue dot stay as they are in view all day.';
const guardCases = [];
for (const [band, repeat] of [['short', 0], ['mid', 1], ['long', 6]]) {
  for (const message of restrictions.map(text => text + tail.repeat(repeat))) {
    // Invented: a lost edge restriction used to pass as a small trim.
    guardCases.push({ guard: 'meaning', band, label: 'reworded', message, summary: message.replace(/^\w+ /, ''), _synthetic: true });
  }
  // Invented: the restriction and its run survive together.
  const intact = restrictions[0] + tail.repeat(repeat);
  guardCases.push({ guard: 'meaning', band, label: 'kept', message: intact, summary: intact, _synthetic: true });
}
for (const [band, repeat] of [['short', 1], ['mid', 3], ['long', 14]]) {
  for (const [message, summary] of [
    // Invented: the action changes, but the small-word instruction survives.
    ['Keep the last used blue pin.', 'The blue pin must stay as it was last used.'],
    // Invented: a second short instruction uses no words over four letters.
    ['Keep the new oak box shut.', 'The oak box must stay shut as a new item.'],
  ]) guardCases.push({ guard: 'short', band, label: 'reworded', message: (message + ' ').repeat(repeat).trim(), summary, _synthetic: true });
  // Invented: an intact small-word request remains kept in every band.
  const intact = 'Keep the last used blue pin. '.repeat(repeat).trim();
  guardCases.push({ guard: 'short', band, label: 'kept', message: intact, summary: intact, _synthetic: true });
}
for (const [band, repeat] of [['short', 0], ['mid', 1], ['long', 6]]) {
  for (const [message, summary] of [
    // Invented: four opening words lead to a different instruction.
    ['Keep the silver marker fixed.', 'Keep the silver marker sketch near the chapter title.'],
    // Invented: a different opening has the same false evidence.
    ['Place the golden compass upright.', 'Place the golden compass sketch above the lesson text.'],
  ]) guardCases.push({ guard: 'near', band, label: 'gone', message: message + tail.repeat(repeat), summary, _synthetic: true });
  // Invented: a three-word fragment still supplies the original word rule.
  const message = 'Preserve copper lantern markings. '.repeat(repeat * 4 + 1).trim();
  const summary = 'Copper lantern markings should remain intact.';
  guardCases.push({ guard: 'near', band, label: 'reworded', message, summary, _synthetic: true });
}
for (const [i, row] of guardCases.entries()) test(`${row.guard} guard ${row.band}: ${i + 1}`, () => {
  const length = [...row.message].length;
  assert.equal(row._synthetic, true);
  assert.ok(row.band === 'short' ? length >= 20 && length <= 60 : row.band === 'mid' ? length > 60 && length <= 300 : length > 300 && length <= 1500);
  assert.equal(score(row.message, prepare(row.summary)).label, row.label);
});

// Invented: each listed meaning word belongs to an instruction of its own.
const clauses = [
  ['not', 'The register must not discard an unread entry.'],
  ['never', 'The register must never discard an unread entry.'],
  ['no', 'Keep no unread entries in the discard pile.'],
  ['unless', 'Keep an unread entry unless its owner releases it.'],
  ['only', 'Discard an unread entry only with its owner present.'],
  ['except', 'Keep every entry except those its owner releases.'],
  ['without', 'Keep the entry without changing its original heading.'],
  ['until', 'Keep an unread entry until its owner releases it.'],
  ['before', 'Check each entry before discarding its original heading.'],
  ['after', 'Check each entry after restoring its original heading.'],
  ['if', 'Discard an unread entry if its owner releases it.'],
  ["don't", "Please don't discard an unread entry from the register."],
  ['mustn\u2019t', 'We mustn\u2019t discard an unread entry from the register.'],
];
for (const [word, clause] of clauses) test(`meaning run survives: ${word}`, () => {
  // Invented: enough independent instructions remain for a near quotation.
  const message = observatory + ' ' + clause + ' ' + observatory;
  const missing = observatory + ' ' + clause.replace(word, '') + ' ' + observatory;
  const elsewhere = missing + ' ' + word + ' belongs to another note.';
  assert.equal(score(message, prepare('Request: ' + message)).label, 'kept');
  assert.equal(score(message, prepare(missing)).label, 'reworded');
  assert.equal(score(message, prepare(elsewhere)).label, 'reworded');
});

test('every occurrence of a meaning word needs its own surviving run', () => {
  // Invented: one copy survives elsewhere, while the other loses its context.
  const message = observatory + ' Never discard entries. Never reset headings. ' + observatory;
  assert.equal(score(message, prepare(message.replace('Never reset headings.', 'Reset headings.'))).label, 'reworded');
  // Invented: an ordinary word ending in nt is not a contraction.
  const ordinary = 'Paint a red fox by a blue cup on a low box at dawn.';
  assert.equal(score(ordinary, prepare(ordinary.replace('Paint ', ''))).label, 'kept');
});

test('a meaning word needs the whole short phrase when there are fewer than five words', () => {
  // Invented: punctuation and quote changes leave the short instruction intact.
  assert.equal(score('Never drop this', prepare('We said: NEVER drop this.')).label, 'kept');
  // Invented: keeping only the action cannot restore the lost restriction.
  assert.equal(score('Never drop this', prepare('Drop this.')).label, 'gone');
});

test('near runs inside sentences do not earn word overlap alone', () => {
  // Invented: the shared four words occur inside a later sentence.
  const message = 'Keep the silver marker fixed.';
  const summary = 'The guide has a new title. Please keep the silver marker sketch near that title.';
  assert.equal(score(message, prepare(summary)).label, 'gone');
  // Invented: punctuation cannot turn a shared run into independent evidence.
  assert.equal(score(message, prepare('Please keep, the silver marker sketch near that title.')).label, 'gone');
  // Invented: a run cannot cross a sentence boundary to erase independent words.
  const separate = 'The silver. Marker must stay fixed.';
  assert.equal(score(message, prepare(separate)).label, 'reworded');
});

test('the longest near run wins over an earlier shorter match', () => {
  // Invented: both openings share words; the later one contains the longer run.
  const message = 'Place the golden compass upright.';
  const summary = 'Place the golden object here. Later place the golden compass sketch above the title.';
  assert.equal(score(message, prepare(summary)).label, 'gone');
});

test('every invented short case stays gone against unrelated prose', () => {
  // Invented: the bakery mural supplies no surviving instruction from the cases.
  const index = prepare('The bakery mural depicts a cheerful otter.');
  for (const row of [...cases, ...guardCases].filter(row => row.band === 'short')) {
    assert.equal(score(row.message, index).label, 'gone', row.message);
  }
});
