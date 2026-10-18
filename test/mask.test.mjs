import test from 'node:test';
import assert from 'node:assert/strict';
import { mask } from '../src/mask.mjs';

const rules = [
  ['short key', 'sk-' + 'sample123'],
  ['long key', 'sk-' + 'ant-sample123'],
  ['token', 'ghp' + '_sample123'],
  ['fine token', 'github' + '_pat_sample123'],
  ['access key', 'AKIA' + 'sample123'],
  ['chat token', 'xox' + 'b-sample123'],
  ['encoded token', 'eyJ' + 'sample123.payload.signature'],
  ['key header', '-----' + 'BEGIN'],
  ['email', 'invented' + '@example.test'],
  ['mixed run', 'abcde12345'.repeat(2), false],
  ['commit', '0123456789abcdef'.repeat(2) + '01234567', false],
  ['version', '2.1.292', false],
];

for (const profile of ['card', 'display']) {
  for (const [name, input, card = true] of rules) {
    test(`${profile}: ${name}`, () => {
      const expected = profile === 'display' || card ? '[hidden]' : input;
      assert.equal(mask(`before ${input} after`, profile), `before ${expected} after`);
    });
  }
  test(`${profile}: plain text stays byte-identical`, () => {
    const plain = 'Keep tabs\tand spaces.\r\nCaf\u00e9\n' + 'a'.repeat(25) + ' 12345678901234567890';
    assert.equal(mask(plain, profile), plain);
  });
  test(`${profile}: prefixes start at a word boundary`, () => {
    for (const [, input, card = true] of rules.slice(0, 8)) {
      assert.equal(mask(`(${input})`, profile), '([hidden])');
      if (card) assert.equal(mask(`word${input}`, profile), `word${input}`);
    }
  });
}
