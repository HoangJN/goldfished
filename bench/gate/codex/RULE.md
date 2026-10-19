# The Codex decay rule

Frozen before any real run. It is not changed afterwards.

The question: with 10,000 to 15,000 tokens of new material per compaction, which of the user's 20 decisions does Codex, with no help from goldfished, still hold word for word, and how does that depend on how long ago each was made?

## Story and atoms

`test/long/saga-02.story.jsonl`, 60 turns, rendered by `renderStory` so each paste is folded into its turn. The 20 atoms are the story's own `atom` fields: id, kind, text, and `supersededAt`, the turn that replaces it (g1 by c1 at 12, r2 by w1 at 23, x1 by w2 at 37, r4 by w3 at 52, the rest by nothing).

## Set-up

- Codex runs in a scratch home, one `codex exec` call per turn and `codex exec resume` for the rest of the session, from a scratch working folder, read-only sandbox, no hooks, no instructions file. The model is passed by environment variable.
- Codex compacts itself when a request leaves the context at or above the compaction limit. **The limit is 140000 tokens.**
- How it was chosen, on throwaway sessions of the first 8 to 36 turns, none of them scored: at 90,000 Codex compacted on nearly every turn once the user messages it keeps had filled their share; at 148,000 about every third turn from turn 16; at 140,000 about every second turn (14 compactions by turn 34, the first at turn 8). What Codex keeps was learned there too: each compacted record holds every user message word for word, oldest dropped once they pass about 256,000 characters, assistant replies not kept, plus one encrypted summary item that cannot be read.

## Counting

- Compaction k is the k-th `compacted` record in the session file. It belongs to turn T_k, the turn whose call produced it. One call can produce more than one.
- An atom is **live at k** when its turn is below T_k and its `supersededAt` is null or at least T_k. That is B19's rule, with "sent before compaction k" read as "a turn below T_k": the turn that triggers a compaction is kept word for word beside the compaction, so it only counts from the next one.

## Two measures, both G3

G3 is `score` in `src/grade.mjs`. Kept means the label `kept`; anything else is not kept.

- **Floor.** G3 of each atom sent before k against the readable text of that record's `replacement_history`: the user and assistant text items, joined. It keeps raw user messages, so it over-counts kept for anything recent. It cannot see the encrypted summary, so a floor not-kept is not proof that Codex lost the atom.
- **Anchor.** At k = 10, 15 and 20 only: when the call that takes the count of compacted records to the target has finished, the session is forked in memory (the compaction limit raised so the fork does not compact), and the fork is asked once: "List every goal, rule and ruled-out option the user has given you, in the user's own words." G3 of each atom sent before k against the answer. The original session never sees the question. If one call jumps past a target, the anchor is taken at the count reached and that k is recorded.

The rule uses the anchor label where one exists and the floor label otherwise. The write-up says which.

## Rule

- A session **loses** if some live atom is not kept at two consecutive compactions, both inside k = 10 to 20.
- Codex **loses** if at least 2 sessions lose. Sessions run one at a time. Session 3 is run only if sessions 1 and 2 disagree.
- A session that stops before reaching k = 20 is incomplete and settles nothing.

## Also reported, never part of the rule

- Kept, reworded and gone **by age**: an atom's age at k is k minus the first compaction at which it is live, plus one. Three tables: the rule's labels, floor only, anchor only.
- **Stale carried.** A superseded atom counts as carried at compaction k when T_k is above its `supersededAt`, the atom is kept, and the atom of the turn that replaced it is not kept. Pairs: g1 with c1, r2 with w1, x1 with w2, r4 with w3. Labels as the rule uses them.
- The verdict on floor labels alone, and on anchor labels alone.
- Floor beside anchor at the three anchor points.
- The usage Codex reports per session, and the compactions per call.
