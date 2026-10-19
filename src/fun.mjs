import { plural } from './wrap.mjs';

export const FISH = '><(((o>   ';

export function verdict({ span, censored }) {
  if (span === null) return { id: 'too_early', line: 'Too early to say. Too few compacted messages so far.' };
  if (censored) return { id: 'at_least', line: `At least ${plural(span, 'compaction')} so far.` };
  const tiers = [
    ['goldfish', 'Goldfish. More than half your words were gone after the first compaction.'],
    ['short', 'Short memory. More than half your words are gone by the second compaction.'],
    ['fair', 'Fair memory. Half your words are still there after two, not after three.'],
    ['long', `Long memory. At least half your words survive ${plural(span, 'compaction')}.`],
  ];
  const [id, line] = tiers[Math.min(span, 3)];
  return { id, line };
}
