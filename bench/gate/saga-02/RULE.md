# The decay gate's rule, saga-02

Frozen before any model call. It is not changed afterwards.

This is the rule in `bench/gate/RULE.md` applied to the heavy story `test/long/saga-02.story.jsonl`. The question is the same. The story is different: 60 turns, a compaction after every second turn (30 in all), and 10,000 to 15,000 tokens of pasted material in most turns, so the summary cannot list every message word for word and has to choose.

## Atoms

Twenty short spans, each copied word for word from a turn of the story. They are read from the `atom` field of that turn, so the story file is the one list; there is no second copy to drift. Each carries its turn and, for four of them, the turn that replaces it (`supersededAt`):

- g1 (turn 1), replaced at turn 12 by c1.
- r2 (turn 9), replaced at turn 23 by w1.
- x1 (turn 6), replaced at turn 37 by w2.
- r4 (turn 26), replaced at turn 52 by w3.

The turn text the model is given is the story rendered by `renderStory` in `scripts/saga-pastes.mjs`, pastes folded in. An atom's text is the user's own words in that turn, never part of a paste.

## Rule

- Compaction k happens after turn 2k, for k = 1 to 30. An atom is live at k when its turn is at most 2k and its `supersededAt` is null or above 2k.
- At each k, score every live atom with G3: `score(atom.text, prepare(summary_k))`, where `summary_k` is the text of the summary record that follows the k-th compact boundary in the session file. Kept means the label `kept`. Not kept is anything else.
- A session **loses** if some live atom is not kept at two consecutive compactions, both inside k = 10 to 30. A session that has fewer than 30 summaries is incomplete and cannot lose.
- Claude Code **loses** if at least 2 sessions lose. Sessions run one at a time. Session 3 runs only if sessions 1 and 2 disagree.

The window moves from B19's k = 10 to 20 to k = 10 to 30 because this story runs to 30 and five of its twenty atoms are first live after k = 20 and several more are only a few compactions old at 20, so a window ending at 20 would barely test them. The verdict on k = 10 to 20 alone is reported beside it, for comparison with B19. It is not part of the rule.

## Stale carried

A superseded atom is carried stale at k when k is at or after its replacement's compaction (the replacing turn divided by two, rounded up), the superseded atom is kept, and the atom of the turn that replaced it is not kept. The pairs, with the first k they can count at: g1 by c1 from 6; r2 by w1 from 12; x1 by w2 from 19; r4 by w3 from 26. Reported, never part of the rule.

## Also reported, never part of the rule

- G3's `kept`, `reworded` and `gone` labels per live atom per k.
- The same counts by age. An atom's age at k is k minus the first compaction it is live at, plus one. The first compaction an atom is live at is its turn divided by two, rounded up. Each live atom at each k is one reading; the table counts, for each age, the readings that were kept, reworded and gone.
- The summary's size in characters at each k.
