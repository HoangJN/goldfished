# Context decay on Claude Code: a real working session, size-triggered compaction

Date: 2026-10-19. Claude Code 2.1.292. Model ids seen in the session files: claude-sonnet-5-5 (gate-allow). Rule frozen in its own commit, `bench/gate/real/RULE.md`, before any model call of these runs. The atoms are the `atom` fields of `test/long/saga-02.story.jsonl`. The pilot that set the size of the window is `bench/gate/real/PILOT.md`.

Caveats: one invented story, one model (gate-allow: Sonnet), a lowered compaction window (60,000 tokens, so compaction comes at about 75,000 to 80,000 tokens of context instead of near the model's full window), an invented repo for the agent to work in, and "kept" means kept word for word, never "forgotten". Claude Code's automatic memory was on and the agent used it; see "What else was holding the decisions". The pasted material is not tested: every atom is in typed text.

## What was different from B19 and B19b

Those forced a compaction every second turn with tools off. Here the agent had tools (read, write, edit, glob, grep) and worked in a small invented repo, and nobody compacted by hand: Claude Code compacted when the conversation got big. Each of the story's 60 turns was sent as written, in one resumed session. That gave 20 compactions in session 1 and 17 in session 2, one per three turns or so. The pilot had predicted about 15, and the target was 12 to 18, so session 1 ran a little over.

Two measures at each compaction k. The floor is G3 of each live atom against the summary Claude Code wrote. The anchor is taken after every third compaction: a forked copy of the session (the original never sees it) is asked "List every goal, rule and ruled-out option the user has given you, in the user's own words.", and G3 scores each live atom against the answer. An atom is live at k when it was typed in an earlier turn than the one the compaction happened in, and not yet replaced. The rule scores the anchor where one was taken and the floor elsewhere, over k = 10 to the last compaction.

## Verdict

**Claude Code does not lose on saga-02 as a working session.** Session 1 (20 compactions) holds and session 2 (17 compactions) holds, so session 3 was not run. No atom decided either: across the two sessions 360 floor readings and 107 anchor readings were scored, and all 467 were kept, with no reworded and none gone. The verdict on the floor alone and on the anchors alone is the same as the rule's: holds, in both sessions. Stale carried: none at any compaction, in either session.

Why it held. The summary Claude Code wrote in these working sessions has the same section as in B19b, "All user messages (user-role turns, in order)", which lists every typed message in quotes. The summary is smaller than in B19b (about 10 to 11 KB at k = 1 and 18 to 21 KB at the end, against 29 to 31 KB), because there are fewer compactions, but it still lists the decisions whole. Tool use did not change that. The anchor answers also quote the user's words, with notes on what was later changed or dropped, and no anchor used a tool.

This is a third null for Claude Code, and the first on a size-triggered compaction in a working session. It still does not say what happens when the user's own messages are long, or when the story runs past 60 turns.

## What else was holding the decisions

Claude Code's automatic memory was switched on, as it is by default. The agent used it: it saved 14 short notes about the user's decisions, and an index of them, into the project's memory folder (56 tool uses touching it in session 1, 40 in session 2), Claude Code puts that index back into the context after a compaction. It did so after every compaction from the third on in session 1, and from the first in session 2. Two consequences:

- The floor is the text of the summary alone, so it does not depend on the memory. The anchor could have: the index restates the decisions, often in the agent's words rather than the user's, and the anchor answers were word for word, which the summary list can supply, but the memory was in the context too. Treat the anchor as a second reading of the same context, not an independent one.
- Session 2 was not independent of session 1. Both sessions used the same working folder, and the memory folder was not emptied between them, so session 2 opened with session 1's index already in its context (its first request was 738 tokens larger than session 1's). The memory is not the summary, so the floor verdict stands for session 2. A run with the memory switched off would answer a cleaner question, and was not run, because the rule fixed two sessions and a third only on disagreement.

## Usage and plan reading

From the tool's JSON output. The compaction's own request is not in these counts.

| | claude runs | requests | input | cache written | cache read | output | minutes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| session 1 | 66 | 129 | 258 | 1,186,190 | 4,649,398 | 116,921 | 44.2 |
| session 2 | 65 | 123 | 246 | 1,115,920 | 3,832,221 | 88,542 | 36.3 |

Tool use in the working turns: 177 uses in session 1, 120 in session 2. The weekly plan reading, from the rate-limit fields in the JSON, went from 0 to 0.01 over session 1 and from 0.01 to 0.02 over session 2, and the 5-hour reading from 0.01 to 0.01 and from 0.01 to 0.03. The weekly stop rule (stop above 0.90) was checked after every turn and never came near.

## Session 1

Floor, by the summary after each compaction.

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 10934 |
| 2 | 8 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11458 |
| 3 | 11 | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11017 |
| 4 | 14 |  | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11517 |
| 5 | 18 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 12697 |
| 6 | 20 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 13278 |
| 7 | 24 |  | K | K |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  | 14759 |
| 8 | 27 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 14267 |
| 9 | 30 |  | K | K |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  | 16091 |
| 10 | 33 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 13295 |
| 11 | 36 |  | K | K |  | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  | 14389 |
| 12 | 39 |  | K |  |  | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  | 15645 |
| 13 | 42 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 15991 |
| 14 | 45 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  | 16259 |
| 15 | 47 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 18156 |
| 16 | 50 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  | 18345 |
| 17 | 52 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K |  |  | 18939 |
| 18 | 55 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 21376 |
| 19 | 58 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 20251 |
| 20 | 60 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 19003 |

Anchor, by the forked answer.

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 11 | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 11017 |
| 6 | 20 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 13278 |
| 9 | 30 |  | K | K |  | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  | 16091 |
| 12 | 39 |  | K |  |  | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  | 15645 |
| 15 | 47 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 18156 |
| 18 | 55 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 21376 |

## Session 2

Floor, by the summary after each compaction.

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 9990 |
| 2 | 9 | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 12457 |
| 3 | 12 |  | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 15182 |
| 4 | 17 |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 13221 |
| 5 | 20 |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  | 13412 |
| 6 | 24 |  | K | K |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  | 16691 |
| 7 | 29 |  | K | K |  | K | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  | 18550 |
| 8 | 32 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 16452 |
| 9 | 33 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 12693 |
| 10 | 39 |  | K |  |  | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  |  | 15324 |
| 11 | 42 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  |  | 16725 |
| 12 | 45 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  | 16900 |
| 13 | 47 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  | 16366 |
| 14 | 51 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K | K | K |  |  | 16082 |
| 15 | 54 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 15329 |
| 16 | 58 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 19407 |
| 17 | 60 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K | K | 17869 |

Anchor, by the forked answer.

| k | turn | g1 | r1 | x1 | r2 | c1 | r3 | v1 | x2 | w1 | r4 | c2 | x3 | r5 | w2 | v2 | c3 | r6 | x4 | w3 | r7 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 12 |  | K | K | K |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 15182 |
| 6 | 24 |  | K | K |  | K | K | K | K | K |  |  |  |  |  |  |  |  |  |  |  | 16691 |
| 9 | 33 |  | K | K |  | K | K | K | K | K | K | K | K |  |  |  |  |  |  |  |  | 12693 |
| 12 | 45 |  | K |  |  | K | K | K | K | K | K | K | K | K | K | K | K |  |  |  |  | 16900 |
| 15 | 54 |  | K |  |  | K | K | K | K | K |  | K | K | K | K | K | K | K | K | K |  | 15329 |

## By age

| age | readings | kept | reworded | gone |
| --- | --- | --- | --- | --- |
| 1 | 40 | 40 | 0 | 0 |
| 2 | 40 | 40 | 0 | 0 |
| 3 | 37 | 37 | 0 | 0 |
| 4 | 33 | 33 | 0 | 0 |
| 5 | 31 | 31 | 0 | 0 |
| 6 | 29 | 29 | 0 | 0 |
| 7 | 27 | 27 | 0 | 0 |
| 8 | 25 | 25 | 0 | 0 |
| 9 | 20 | 20 | 0 | 0 |
| 10 | 18 | 18 | 0 | 0 |
| 11 | 14 | 14 | 0 | 0 |
| 12 | 13 | 13 | 0 | 0 |
| 13 | 10 | 10 | 0 | 0 |
| 14 | 9 | 9 | 0 | 0 |
| 15 | 5 | 5 | 0 | 0 |
| 16 | 5 | 5 | 0 | 0 |
| 17 | 2 | 2 | 0 | 0 |
| 18 | 1 | 1 | 0 | 0 |
| 19 | 1 | 1 | 0 | 0 |

Every age from 1 to 19 is kept in every floor reading, so as in B19b there is no decay curve to read.
