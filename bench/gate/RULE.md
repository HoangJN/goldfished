# The decay gate's rule

Frozen before any model call. It is not changed afterwards.

The question: does Claude Code, with no help from goldfished, still hold the user's goal, rules and ruled-out options word for word between 10 and 20 compactions?

## Atoms

Ten short spans, each copied word for word from a turn of `test/long/saga-01.story.jsonl`. They are listed in `atoms.json`. Two have a turn that later replaces them: r2 (replaced at turn 28) and g2 (replaced at turn 36).

## Rule

- Compaction k happens after turn 2k. An atom is live at k when its turn is at most 2k and its superseding turn, if any, is above 2k.
- At each k, score every live atom with G3: `score(atom.text, prepare(summary_k))`, where `summary_k` is the text of the summary record that follows the k-th compact boundary in the session file. Kept means the label `kept`. Not kept is anything else.
- A session **loses** if some live atom is not kept at two consecutive compactions, both inside k = 10 to 20.
- Claude Code **loses** if at least 2 sessions lose. Sessions run one at a time: if sessions 1 and 2 agree, session 3 is not run, because the answer is settled.
- Also reported, never part of the rule: G3's `reworded` and `gone` labels per atom; **stale carried**, meaning r2 kept at k of 14 or more while w1 is not kept, or g2 kept at k of 18 or more while g3 is not kept.
