# Context decay on Claude Code: the heavy story, saga-02

Date: 2026-10-19. Claude Code 2.1.292. Model ids seen in the session files: claude-sonnet-5-5 (gate-allow). Rule frozen in commit 4a7b6755a98feab122b17dd2601e11a9e52e4c5a, before any model call. The rule is in `bench/gate/saga-02/RULE.md`, the atoms are the `atom` fields of `test/long/saga-02.story.jsonl`.

Caveats: forced `/compact` every two turns, tools off, one invented story, one model (gate-allow: Sonnet), and not kept means not kept word for word, never "forgotten". The rule's window is k = 10 to 30, a widening of B19's 10 to 20 that was fixed with the rule; the k = 10 to 20 verdict is given beside it. The pasted material is not tested: every atom is in typed text.

## Verdict

**Claude Code does not lose on saga-02.** Sessions 1 and 2 both held, so session 3 was not run, because the answer was settled. No atom decided it, because none was ever missing: across the two sessions 558 live atom readings were scored, 279 each, and all 558 were kept, with a score of 1.0 each time. Reworded: 0. Gone: 0. On the comparison window k = 10 to 20 the verdict is the same in both sessions: holds.

Stale carried: 0 compactions in session 1, 0 in session 2. Whenever a superseded atom still appeared in a summary, its replacement was kept beside it.

Why it held. The summary Claude Code writes has a section that lists every typed user message, in order, in quotes. The pasted logs, tables, listings and diffs are the heavy part of this story, and the summary does not copy them (read in session 1's summaries; session 2's are the same size): each paste becomes a short description beside the message that carried it ("pasted CSV sample", "long log"). So the 10,000 to 15,000 tokens of new material per compaction did not crowd out the decisions. The summary grew from about 6.8 KB at k = 1 to about 29 to 31 KB at k = 30, about 800 characters per compaction, and stayed whole. The list can only run out of room if the typed messages themselves are heavy; here they are short.

This is a second null for the card proof on Claude Code under forced compaction, now on a heavy story. It does not say what a real, size-triggered compaction does, nor what happens when the user's own messages are long.

## Session 1

Verdict: holds. Atoms that decided it: none. Compactions scored: 30. Stale carried at: none.

K kept, R reworded, G gone, blank not live. Size is the summary's length in characters.

| k | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 6758 |
| 2 | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 9022 |
| 3 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11248 |
| 4 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 12511 |
| 5 | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 13970 |
| 6 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 16542 |
| 7 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 15775 |
| 8 |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 14864 |
| 9 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 16747 |
| 10 |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  | 15667 |
| 11 |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  | 18506 |
| 12 |  | K | K |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  | 18234 |
| 13 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 16154 |
| 14 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 17508 |
| 15 |  | K | K |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  | 20577 |
| 16 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 21710 |
| 17 |  | K | K |  | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  | 21809 |
| 18 |  | K | K |  | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  | 20780 |
| 19 |  | K |  |  | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  | 22710 |
| 20 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 24522 |
| 21 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 24855 |
| 22 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  | 24481 |
| 23 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 26063 |
| 24 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 26459 |
| 25 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  | 28279 |
| 26 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 30786 |
| 27 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 30675 |
| 28 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 33607 |
| 29 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 33726 |
| 30 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 31038 |

## Session 2

Verdict: holds. Atoms that decided it: none. Compactions scored: 30. Stale carried at: none.

| k | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 6743 |
| 2 | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 8075 |
| 3 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 10272 |
| 4 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11262 |
| 5 | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 13444 |
| 6 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 15053 |
| 7 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 16360 |
| 8 |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 17778 |
| 9 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 19387 |
| 10 |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  | 19203 |
| 11 |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  | 19754 |
| 12 |  | K | K |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  | 21147 |
| 13 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 18888 |
| 14 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 19204 |
| 15 |  | K | K |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  | 20922 |
| 16 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 22194 |
| 17 |  | K | K |  | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  | 19345 |
| 18 |  | K | K |  | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  | 19691 |
| 19 |  | K |  |  | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  | 21266 |
| 20 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 21330 |
| 21 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 21917 |
| 22 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  | 23965 |
| 23 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 25583 |
| 24 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 25626 |
| 25 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  | 27776 |
| 26 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 28723 |
| 27 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 30593 |
| 28 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 32600 |
| 29 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 28243 |
| 30 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 29000 |

## By age

An atom's age at k is k minus the first compaction it is live at, plus one. Each live atom at each k is one reading. Both sessions together.

| age | readings | kept | reworded | gone |
| --- | --- | --- | --- | --- |
| 1 | 40 | 40 | 0 | 0 |
| 2 | 40 | 40 | 0 | 0 |
| 3 | 40 | 40 | 0 | 0 |
| 4 | 38 | 38 | 0 | 0 |
| 5 | 38 | 38 | 0 | 0 |
| 6 | 34 | 34 | 0 | 0 |
| 7 | 32 | 32 | 0 | 0 |
| 8 | 30 | 30 | 0 | 0 |
| 9 | 28 | 28 | 0 | 0 |
| 10 | 26 | 26 | 0 | 0 |
| 11 | 26 | 26 | 0 | 0 |
| 12 | 24 | 24 | 0 | 0 |
| 13 | 22 | 22 | 0 | 0 |
| 14 | 20 | 20 | 0 | 0 |
| 15 | 18 | 18 | 0 | 0 |
| 16 | 16 | 16 | 0 | 0 |
| 17 | 12 | 12 | 0 | 0 |
| 18 | 12 | 12 | 0 | 0 |
| 19 | 12 | 12 | 0 | 0 |
| 20 | 10 | 10 | 0 | 0 |
| 21 | 10 | 10 | 0 | 0 |
| 22 | 8 | 8 | 0 | 0 |
| 23 | 6 | 6 | 0 | 0 |
| 24 | 4 | 4 | 0 | 0 |
| 25 | 4 | 4 | 0 | 0 |
| 26 | 2 | 2 | 0 | 0 |
| 27 | 2 | 2 | 0 | 0 |
| 28 | 2 | 2 | 0 | 0 |
| 29 | 2 | 2 | 0 | 0 |

Every age, from 1 (the compaction right after the atom was typed) to 29 (r1, typed at turn 4, read at k = 30), is kept in every reading. There is no decay curve to read: the line is flat at 100 per cent.

## Summary size

Characters at each k.

| k | session 1 | session 2 |
| --- | --- | --- |
| 1 | 6758 | 6743 |
| 2 | 9022 | 8075 |
| 3 | 11248 | 10272 |
| 4 | 12511 | 11262 |
| 5 | 13970 | 13444 |
| 6 | 16542 | 15053 |
| 7 | 15775 | 16360 |
| 8 | 14864 | 17778 |
| 9 | 16747 | 19387 |
| 10 | 15667 | 19203 |
| 11 | 18506 | 19754 |
| 12 | 18234 | 21147 |
| 13 | 16154 | 18888 |
| 14 | 17508 | 19204 |
| 15 | 20577 | 20922 |
| 16 | 21710 | 22194 |
| 17 | 21809 | 19345 |
| 18 | 20780 | 19691 |
| 19 | 22710 | 21266 |
| 20 | 24522 | 21330 |
| 21 | 24855 | 21917 |
| 22 | 24481 | 23965 |
| 23 | 26063 | 25583 |
| 24 | 26459 | 25626 |
| 25 | 28279 | 27776 |
| 26 | 30786 | 28723 |
| 27 | 30675 | 30593 |
| 28 | 33607 | 32600 |
| 29 | 33726 | 28243 |
| 30 | 31038 | 29000 |

## Usage

Both sessions, 90 calls each (60 turns and 30 compactions), from the tool's JSON output.

| | input | output | cache written | cache read |
| --- | --- | --- | --- | --- |
| session 1 | 120 | 55,292 | 1,115,938 | 781,332 |
| session 2 | 120 | 57,185 | 1,114,543 | 783,505 |

Each session took about 45 minutes. No plan-limit stop.
