import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../scripts/check-labels.mjs';

function clean() {
  const rows = [];
  const strata = ['condition', 'fragment', 'exact', 'paraphrase', 'paste', 'near_miss'];
  for (const band of ['short', 'mid', 'long']) {
    for (const label of ['kept', 'reworded', 'gone']) {
      for (let n = 0; n < 16; n++) {
        const id = `entry${rows.length}`;
        const message = Array.from({ length: band === 'short' ? 3 : band === 'mid' ? 10 : 40 }, (_, i) => `${id}w${i}`).join(' ');
        rows.push({ id, band, stratum: strata[rows.length % 6], message, summary: 'Invented test note.', label, _synthetic: true });
      }
    }
  }
  return rows;
}

function run(rows, count = 144) {
  return check(rows.map(row => JSON.stringify(row)), { count });
}

test('clean in-memory set passes with an explicit count', () => {
  assert.deepEqual(run(clean()), []);
});

const faults = [
  ['missing field', rows => { delete rows[0].summary; }, /field missing: summary/],
  ['wrong band', rows => { rows[0].band = 'mid'; }, /band wrong for length/],
  ['duplicate id', rows => { rows[1].id = rows[0].id; }, /duplicate id/],
  ['provenance', rows => { rows[0]._synthetic = false; }, /_synthetic must be true/],
  ['invalid label', rows => { rows[0].label = 'lost'; }, /invalid label/],
  ['invalid stratum', rows => { rows[0].stratum = 'odd'; }, /invalid stratum/],
  ['invalid band', rows => { rows[0].band = 'tiny'; }, /invalid band/],
  ['wrong field type', rows => { rows[0].summary = 42; }, /summary must be a non-empty string/],
  ['empty id', rows => { rows[0].id = ''; }, /id must be a non-empty string/],
  ['short quota', rows => { rows.splice(0, 9); }, /band quota: short/],
  ['label quota', rows => { rows.slice(0, 9).forEach(row => { row.label = 'gone'; }); }, /label quota: short\/kept/],
  ['stratum quota', rows => { rows.forEach(row => { if (row.stratum === 'paste') row.stratum = 'other'; }); }, /stratum quota: paste/],
  ['lower length limit', rows => { rows[0].message = 'tiny'; }, /band wrong for length 4/],
  ['upper length limit', rows => { rows[0].message = 'x'.repeat(1501); }, /band wrong for length 1501/],
];

for (const [name, change, expected] of faults) {
  test(`catches ${name}`, () => {
    const rows = clean();
    change(rows);
    assert.match(run(rows, rows.length).join('\n'), expected);
  });
}

test('shared runs ignore punctuation and case and name both ids', () => {
  const rows = clean();
  rows[0].message = 'Copper slate plum fern ochre';
  rows[1].message = 'COPPER, slate! plum; fern: ochre.';
  assert.match(run(rows).join('\n'), /shared 5-word run: entry0 and entry1: "copper slate plum fern ochre"/);
});

test('a four-word overlap and repeated runs within one message pass', () => {
  const rows = clean();
  rows[0].message = 'Copper slate plum fern ochre';
  rows[1].message = 'Copper slate plum fern russet';
  rows[48].message = 'violet reed sand clay stone violet reed sand clay stone violet reed sand clay stone';
  assert.deepEqual(run(rows), []);
});

test('length boundaries use code points', () => {
  for (const [length, band] of [[20, 'short'], [60, 'short'], [61, 'mid'], [300, 'mid'], [301, 'long'], [1500, 'long']]) {
    const rows = clean();
    rows[0].message = '\u{1f41f}'.repeat(length);
    rows[0].band = band;
    assert.deepEqual(run(rows), []);
  }
});

test('malformed lines, non-objects and blank interior lines are reported', () => {
  for (const bad of ['{', 'null', '[]', '7', '']) {
    assert.match(check([bad], { count: 0 }).join('\n'), /line 1: invalid JSON object/);
  }
});

test('count defaults to 160 and a trailing newline is accepted', () => {
  const rows = clean();
  assert.match(check(rows.map(row => JSON.stringify(row))).join('\n'), /expected 160, found 144/);
  assert.deepEqual(check(rows.map(row => JSON.stringify(row)).join('\r\n') + '\r\n', { count: 144 }), []);
});

