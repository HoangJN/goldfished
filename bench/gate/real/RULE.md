# The real-compaction rule, saga-02 as a working session

Frozen before any model call of the real runs. It is not changed afterwards.

The question is the one in `bench/gate/saga-02/RULE.md`, asked of a different kind of session. There, a compaction was forced every second turn with tools off. Here the agent has tools and works in a small invented repo, nobody compacts by hand, and Claude Code compacts when the conversation gets big.

## Session

- The 60 turns of `test/long/saga-02.story.jsonl`, rendered by `renderStory`, each sent as written, one after another in one resumed session. Atoms and replacements are the `atom` and `supersededAt` fields of that file: the twenty of `bench/gate/saga-02/RULE.md`.
- Tools: read, write, edit, glob, grep. Edits accepted without asking. No shell, no network tools. Only project settings loaded. The working folder is an invented repo, rebuilt from `skeleton.json` at the start of each session.
- Compaction is automatic only. The size setting is the pilot's, frozen here: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=60000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=100`. The pilot gave 3 compactions in 12 turns.
- Compaction k is the k-th compact boundary in the session file. Its turn, t_k, is the turn whose call was running when it happened.

## Live atoms

An atom is live at compaction k when its turn is below t_k and its `supersededAt` is null or above t_k. An atom typed in the turn that compacted, or replaced in that turn, is not scored at that k: whether the summary had it yet depends on where in the turn the compaction fell.

## Scored points

- Floor at k: G3 of each live atom, `score(atom.text, prepare(summary_k))`, where `summary_k` is the text of the summary record after the k-th boundary. Kept means the label `kept`.
- Anchor: after the turn in which the compaction count reaches a multiple of 3, a forked copy of the session (`--resume <id> --fork-session`; the original never sees it) is asked, word for word: "List every goal, rule and ruled-out option the user has given you, in the user's own words." G3 of each live atom against the final reply text. The anchor's k is the compaction count at that point.
- Scored value at k: the anchor where one was taken at k, the floor elsewhere. The floor at an anchor k is also recorded.

## Rule

- The window is k = 10 to the last compaction of the session.
- A session **loses** if some atom is live and not kept, by its scored value, at two consecutive k that are both in the window.
- A session that ends before turn 60 is partial. It can lose on what it has, and cannot hold.
- Claude Code **loses** if at least 2 sessions lose. Sessions run one at a time. Session 3 runs only if sessions 1 and 2 disagree.
- Stop rule: the weekly plan reading in the tool's own JSON is checked after every turn. Above 0.90 the session stops cleanly and is scored as partial.

## Also reported, never part of the rule

- The floor-only verdict, and the verdict on anchors alone (an atom not kept at two consecutive anchors in the window).
- Stale carried: a superseded atom kept while the atom that replaced it is not, at a k after the replacing turn. Pairs: g1 by c1, r2 by w1, x1 by w2, r4 by w3.
- Labels by age: an atom's age at k is k minus the first k it is live at, plus one.
- Summary size in characters, each turn's compaction count, token use, and any tool use in an anchor.
