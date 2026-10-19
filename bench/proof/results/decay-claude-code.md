# Context decay on Claude Code: the gate

Date: 2026-10-19. Claude Code 2.1.292. Model ids seen in the session files: claude-sonnet-5-5 (gate-allow). Atoms and rule frozen in commit 0e8100ccb1e553813a164598e3e273236090f85e, before any model call. The rule is in `bench/gate/RULE.md`, the atoms in `bench/gate/atoms.json`.

Caveats: forced `/compact` every two turns, tools off, one invented story, one model (gate-allow: Sonnet), and not kept means not kept word for word, never "forgotten".

## Verdict

**Claude Code does not lose.** Sessions 1 and 2 both held, so session 3 was not run, because the answer was settled. No live atom was ever missing: every live atom was kept at every compaction, k = 1 to 25, in both sessions, with the longest-run score at 1.0 each time. Stale carried: 0 compactions in session 1, 0 in session 2 (whenever r2 or g2 still appeared in a summary after its replacement, the withdrawal or the new goal was kept beside it).

On this story, with a forced compaction every two turns, Claude Code's own summary keeps the user's goal, rules and ruled-out options word for word through 25 compactions. This is a null for the card proof on Claude Code under forced compaction. It does not say what a real, size-triggered compaction on a long working session does.

## Session 1

Verdict: holds. Atoms that decided it: none. Compactions scored: 25. Stale carried at: none.

K kept, R reworded, G gone, blank not live.

| k | g1a | g1b | r1 | x1 | x2 | r2 | r3 | g2 | w1 | g3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | K | K | K |  |  |  |  |  |  |  |
| 2 | K | K | K | K | K |  |  |  |  |  |
| 3 | K | K | K | K | K | K | K |  |  |  |
| 4 | K | K | K | K | K | K | K |  |  |  |
| 5 | K | K | K | K | K | K | K |  |  |  |
| 6 | K | K | K | K | K | K | K |  |  |  |
| 7 | K | K | K | K | K | K | K |  |  |  |
| 8 | K | K | K | K | K | K | K |  |  |  |
| 9 | K | K | K | K | K | K | K |  |  |  |
| 10 | K | K | K | K | K | K | K |  |  |  |
| 11 | K | K | K | K | K | K | K |  |  |  |
| 12 | K | K | K | K | K | K | K | K |  |  |
| 13 | K | K | K | K | K | K | K | K |  |  |
| 14 | K | K | K | K | K |  | K | K | K |  |
| 15 | K | K | K | K | K |  | K | K | K |  |
| 16 | K | K | K | K | K |  | K | K | K |  |
| 17 | K | K | K | K | K |  | K | K | K |  |
| 18 | K | K | K | K | K |  | K |  | K | K |
| 19 | K | K | K | K | K |  | K |  | K | K |
| 20 | K | K | K | K | K |  | K |  | K | K |
| 21 | K | K | K | K | K |  | K |  | K | K |
| 22 | K | K | K | K | K |  | K |  | K | K |
| 23 | K | K | K | K | K |  | K |  | K | K |
| 24 | K | K | K | K | K |  | K |  | K | K |
| 25 | K | K | K | K | K |  | K |  | K | K |

## Session 2

Verdict: holds. Atoms that decided it: none. Compactions scored: 25. Stale carried at: none.

K kept, R reworded, G gone, blank not live.

| k | g1a | g1b | r1 | x1 | x2 | r2 | r3 | g2 | w1 | g3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | K | K | K |  |  |  |  |  |  |  |
| 2 | K | K | K | K | K |  |  |  |  |  |
| 3 | K | K | K | K | K | K | K |  |  |  |
| 4 | K | K | K | K | K | K | K |  |  |  |
| 5 | K | K | K | K | K | K | K |  |  |  |
| 6 | K | K | K | K | K | K | K |  |  |  |
| 7 | K | K | K | K | K | K | K |  |  |  |
| 8 | K | K | K | K | K | K | K |  |  |  |
| 9 | K | K | K | K | K | K | K |  |  |  |
| 10 | K | K | K | K | K | K | K |  |  |  |
| 11 | K | K | K | K | K | K | K |  |  |  |
| 12 | K | K | K | K | K | K | K | K |  |  |
| 13 | K | K | K | K | K | K | K | K |  |  |
| 14 | K | K | K | K | K |  | K | K | K |  |
| 15 | K | K | K | K | K |  | K | K | K |  |
| 16 | K | K | K | K | K |  | K | K | K |  |
| 17 | K | K | K | K | K |  | K | K | K |  |
| 18 | K | K | K | K | K |  | K |  | K | K |
| 19 | K | K | K | K | K |  | K |  | K | K |
| 20 | K | K | K | K | K |  | K |  | K | K |
| 21 | K | K | K | K | K |  | K |  | K | K |
| 22 | K | K | K | K | K |  | K |  | K | K |
| 23 | K | K | K | K | K |  | K |  | K | K |
| 24 | K | K | K | K | K |  | K |  | K | K |
| 25 | K | K | K | K | K |  | K |  | K | K |

