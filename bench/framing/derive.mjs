#!/usr/bin/env node
// Cuts the two weaker framings out of spec.txt, which `goldfished card` wrote. The card entries are not touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'framings');
const FOLLOW = ' If the summary and the card disagree, follow the card, unless you can see the user said otherwise after that date.';
const ONE = "goldfished: the user's card, copied as typed, with the date each entry was set.";

const spec = readFileSync(join(dir, 'spec.txt'), 'utf8').replace(/\n[\d,]+ bytes of [\d,]+\.\n$/, '\n');
const [first, ...rest] = spec.split('\n\n');
if (!first.includes(FOLLOW)) throw new Error('the follow-the-card sentence is not in spec.txt');
const before = rest.pop();
if (!before.startsWith('BEFORE YOUR NEXT ACTION')) throw new Error('no BEFORE line in spec.txt');
const entries = rest.join('\n\n');

writeFileSync(join(dir, 'spec.txt'), spec);
writeFileSync(join(dir, 'nofollow.txt'), [first.replace(FOLLOW, ''), entries, before].join('\n\n'));
writeFileSync(join(dir, 'short.txt'), `${ONE}\n\n${entries}\n`);
console.log('framings written');
