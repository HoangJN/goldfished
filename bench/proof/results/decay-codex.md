# Context decay on Codex: saga-02

Date: 2026-10-19. codex-cli 0.163.0-alpha.10.2. Model: gpt-6-luna (gate-allow). Rule frozen in commit fc215045b5cf6426c6b6f068389bfa911a23d122, before any real run, in `bench/gate/codex/RULE.md`. Compaction limit 140000 tokens.

Caveats: one invented story, one model (gate-allow), natural compaction in a read-only sandbox, not kept means not kept word for word and never "forgotten". The floor is the text of the kept history, which holds the user messages raw and so over-counts kept, and it cannot see Codex's encrypted summary, so a floor not kept is not proof of loss. The anchor is the only look at the summary, and it is a question the user would not ask.

What Codex keeps, seen on throwaway sessions first: each compacted record holds every user message word for word, oldest dropped past about 256,000 characters, no assistant replies, and one encrypted summary that cannot be read. So the floor is a view of the raw window, and only the anchor shows whether the summary adds anything.

## Verdict

**Codex loses.** 2 complete sessions, 2 lost. The rule used the anchor label at k = 10, 15 and 20 and the floor label at every other compaction.

## Session 1

Complete: 60 turns, 31 compactions (1.9 turns each). Anchors taken at k 10, 15, 20. Usage: 60 turns, running totals at the end: input 9662795, of which cached 3052032, output 11813 tokens.

Rule verdict: **loses**, 63 atom-pairs not kept twice running, atoms r1 x1 c1 r3 v1 x2 w1 r4 c2 x3, first at r1 at k 10 and 11. Floor labels alone: loses, 63 atom-pairs not kept twice running. Anchor misses: k 10: r1 x1 c1; k 15: r1 x1 c1 r3 v1 x2 w1; k 20: r1 c1 r3 v1 x2 w1 r4 c2 x3 w2.

K kept, R reworded, G gone, blank not live, * anchor label (the rest are floor).

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 9 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | 12 | G | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | 15 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 | 17 |  | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 | 19 |  | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 | 19 |  | G | G | G | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 | 21 |  | G | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 | 21 |  | G | G | R | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 | 23 |  | G | G | R | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 | 24 |  | G* | G* |  | G* | K* | K* | K* | K* |  |  |  |  |  |  |  |  |  |  |  |
| 11 | 27 |  | G | G |  | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |
| 12 | 29 |  | G | G |  | G | G | G | K | K | K |  |  |  |  |  |  |  |  |  |  |
| 13 | 32 |  | G | G |  | G | G | G | K | K | K | K | K |  |  |  |  |  |  |  |  |
| 14 | 33 |  | G | G |  | G | G | G | G | G | K | K | K |  |  |  |  |  |  |  |  |
| 15 | 37 |  | G* | R* |  | G* | G* | G* | G* | G* | K* | K* | K* | K* |  |  |  |  |  |  |  |
| 16 | 38 |  | G |  |  | G | G | G | G | G | R | K | K | K | K |  |  |  |  |  |  |
| 17 | 40 |  | G |  |  | G | G | G | G | G | R | G | K | K | K |  |  |  |  |  |  |
| 18 | 42 |  | G |  |  | G | G | G | G | G | R | G | G | K | K | K |  |  |  |  |  |
| 19 | 43 |  | G |  |  | G | G | G | G | G | R | R | G | K | K | K |  |  |  |  |  |
| 20 | 45 |  | G* |  |  | G* | G* | G* | G* | G* | G* | G* | G* | K* | G* | K* | K* |  |  |  |  |
| 21 | 46 |  | G |  |  | G | G | G | G | G | R | R | G | G | K | K | K |  |  |  |  |
| 22 | 48 |  | R |  |  | G | G | G | G | G | G | R | G | G | G | K | K | K |  |  |  |
| 23 | 50 |  | R |  |  | G | G | G | G | G | G | R | G | G | G | K | K | K | K |  |  |
| 24 | 51 |  | R |  |  | G | G | G | G | G | G | R | G | G | G | K | K | K | K |  |  |
| 25 | 52 |  | R |  |  | G | G | G | G | G | G | G | G | G | G | G | K | K | K |  |  |
| 26 | 54 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K |  |
| 27 | 55 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K |  |
| 28 | 56 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K | K |
| 29 | 57 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K | K |
| 30 | 59 |  | G |  |  | G | G | G | G | G |  | G | G | G | G | G | G | G | K | K | K |
| 31 | 60 |  | G |  |  | G | G | G | G | G |  | G | G | G | G | G | G | G | G | K | K |

Stale carried: g1 with c1: not carried; r2 with w1: not carried; x1 with w2: not carried; r4 with w3: not carried.

Floor against anchor at the anchor points (live atoms):

| k | live | floor kept | anchor kept | floor kept, anchor not | anchor kept, floor not |
| --- | --- | --- | --- | --- | --- |
| 10 | 7 | 4 | 4 | - | - |
| 15 | 11 | 4 | 4 | - | - |
| 20 | 13 | 4 | 3 | w2 | - |

## Session 2

Complete: 60 turns, 29 compactions (2.1 turns each). Anchors taken at k 10, 15, 20. Usage: 60 turns, running totals at the end: input 9583682, of which cached 5420672, output 11977 tokens.

Rule verdict: **loses**, 72 atom-pairs not kept twice running, atoms r1 x1 c1 r3 v1 x2 w1 r4 c2 x3, first at r1 at k 10 and 11. Floor labels alone: loses, 72 atom-pairs not kept twice running. Anchor misses: k 10: r1 x1 c1 r3 v1; k 15: r1 c1 r3 v1 x2 w1 r4; k 20: r1 c1 r3 v1 x2 w1 r4 c2 x3 r5 w2.

K kept, R reworded, G gone, blank not live, * anchor label (the rest are floor).

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | 12 | G | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | 15 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 | 19 |  | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 | 20 |  | G | G | G | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 | 22 |  | G | G | R | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 | 23 |  | G | G | R | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 | 24 |  | G | G |  | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |
| 9 | 27 |  | G | G |  | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |  |
| 10 | 29 |  | G* | G* |  | G* | G* | G* | K* | K* | K* |  |  |  |  |  |  |  |  |  |  |
| 11 | 31 |  | G | G |  | G | G | G | K | K | K | K |  |  |  |  |  |  |  |  |  |
| 12 | 33 |  | G | G |  | G | G | G | G | G | K | K | K |  |  |  |  |  |  |  |  |
| 13 | 35 |  | G | G |  | G | G | G | G | G | K | K | K | K |  |  |  |  |  |  |  |
| 14 | 37 |  | G | G |  | G | G | G | G | G | K | K | K | K |  |  |  |  |  |  |  |
| 15 | 39 |  | G* |  |  | G* | G* | G* | G* | G* | G* | K* | K* | K* | K* |  |  |  |  |  |  |
| 16 | 40 |  | G |  |  | G | G | G | G | G | R | G | K | K | K |  |  |  |  |  |  |
| 17 | 42 |  | G |  |  | G | G | G | G | G | R | G | G | K | K | K |  |  |  |  |  |
| 18 | 43 |  | G |  |  | G | G | G | G | G | R | R | G | K | K | K |  |  |  |  |  |
| 19 | 45 |  | G |  |  | G | G | G | G | G | R | R | G | K | K | K | K |  |  |  |  |
| 20 | 45 |  | G* |  |  | G* | G* | G* | G* | G* | G* | G* | G* | G* | G* | K* | K* |  |  |  |  |
| 21 | 48 |  | R |  |  | G | G | G | G | G | G | R | G | G | G | K | K | K |  |  |  |
| 22 | 51 |  | R |  |  | G | G | G | G | G | G | R | G | G | G | K | K | K | K |  |  |
| 23 | 52 |  | R |  |  | G | G | G | G | G | G | G | G | G | G | G | K | K | K |  |  |
| 24 | 54 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K |  |
| 25 | 55 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K |  |
| 26 | 56 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K | K |
| 27 | 57 |  | R |  |  | G | G | G | G | G |  | G | G | G | G | G | G | K | K | K | K |
| 28 | 59 |  | G |  |  | G | G | G | G | G |  | G | G | G | G | G | G | G | K | K | K |
| 29 | 60 |  | G |  |  | G | G | G | G | G |  | G | G | G | G | G | G | G | G | K | K |

Stale carried: g1 with c1: not carried; r2 with w1: not carried; x1 with w2: not carried; r4 with w3: not carried.

Floor against anchor at the anchor points (live atoms):

| k | live | floor kept | anchor kept | floor kept, anchor not | anchor kept, floor not |
| --- | --- | --- | --- | --- | --- |
| 10 | 8 | 3 | 3 | - | - |
| 15 | 11 | 4 | 4 | - | - |
| 20 | 13 | 3 | 2 | w2 | - |

## By age, all sessions

An atom's age at k is k minus the first compaction it is live at, plus one. Counts of live atom readings.

The rule's labels:

| age | kept | reworded | gone |
| --- | --- | --- | --- |
| 1 | 40 | 0 | 0 |
| 2 | 38 | 0 | 2 |
| 3 | 38 | 0 | 0 |
| 4 | 35 | 0 | 3 |
| 5 | 26 | 0 | 10 |
| 6 | 19 | 2 | 15 |
| 7 | 10 | 4 | 20 |
| 8 | 2 | 4 | 27 |
| 9 | 0 | 4 | 27 |
| 10 | 0 | 2 | 27 |
| 11 | 0 | 4 | 24 |
| 12 | 0 | 2 | 25 |
| 13 | 0 | 0 | 26 |
| 14 | 0 | 0 | 25 |
| 15 | 0 | 1 | 22 |
| 16 | 0 | 0 | 19 |
| 17 | 0 | 0 | 18 |
| 18 | 0 | 0 | 16 |
| 19 | 0 | 0 | 15 |
| 20 | 0 | 0 | 12 |
| 21 | 0 | 1 | 11 |
| 22 | 0 | 2 | 10 |
| 23 | 0 | 2 | 8 |
| 24 | 0 | 2 | 8 |
| 25 | 0 | 2 | 7 |
| 26 | 0 | 2 | 6 |
| 27 | 0 | 2 | 4 |
| 28 | 0 | 1 | 3 |
| 29 | 0 | 1 | 2 |
| 30 | 0 | 0 | 1 |
| 31 | 0 | 0 | 1 |

Floor labels only:

| age | kept | reworded | gone |
| --- | --- | --- | --- |
| 1 | 40 | 0 | 0 |
| 2 | 38 | 0 | 2 |
| 3 | 38 | 0 | 0 |
| 4 | 35 | 0 | 3 |
| 5 | 27 | 0 | 9 |
| 6 | 20 | 2 | 14 |
| 7 | 10 | 5 | 19 |
| 8 | 2 | 5 | 26 |
| 9 | 0 | 4 | 27 |
| 10 | 0 | 4 | 25 |
| 11 | 0 | 4 | 24 |
| 12 | 0 | 3 | 24 |
| 13 | 0 | 0 | 26 |
| 14 | 0 | 0 | 25 |
| 15 | 0 | 0 | 23 |
| 16 | 0 | 0 | 19 |
| 17 | 0 | 0 | 18 |
| 18 | 0 | 0 | 16 |
| 19 | 0 | 0 | 15 |
| 20 | 0 | 0 | 12 |
| 21 | 0 | 1 | 11 |
| 22 | 0 | 2 | 10 |
| 23 | 0 | 2 | 8 |
| 24 | 0 | 2 | 8 |
| 25 | 0 | 2 | 7 |
| 26 | 0 | 2 | 6 |
| 27 | 0 | 2 | 4 |
| 28 | 0 | 1 | 3 |
| 29 | 0 | 1 | 2 |
| 30 | 0 | 0 | 1 |
| 31 | 0 | 0 | 1 |

Anchor labels only:

| age | kept | reworded | gone |
| --- | --- | --- | --- |
| 1 | 4 | 0 | 0 |
| 2 | 2 | 0 | 0 |
| 3 | 5 | 0 | 0 |
| 4 | 3 | 0 | 0 |
| 5 | 3 | 0 | 1 |
| 6 | 2 | 0 | 2 |
| 7 | 1 | 0 | 3 |
| 8 | 0 | 0 | 6 |
| 9 | 0 | 0 | 2 |
| 10 | 0 | 0 | 7 |
| 11 | 0 | 0 | 2 |
| 12 | 0 | 0 | 4 |
| 13 | 0 | 0 | 3 |
| 14 | 0 | 0 | 1 |
| 15 | 0 | 1 | 3 |
| 16 | 0 | 0 | 1 |
| 17 | 0 | 0 | 3 |
| 18 | 0 | 0 | 2 |
| 20 | 0 | 0 | 2 |
