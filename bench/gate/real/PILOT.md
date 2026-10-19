# Pilot for the real-compaction run

What this is: the first 12 turns of the heavy invented story (saga-02) sent to Claude Code as one working session, to find a compaction setting and to measure what a full run costs before it is run. Tools on (read, write, edit, glob, grep), edits accepted without asking, no shell, no network tools, an invented scratch repo to work in. Claude Code compacted on its own. Nothing was compacted by hand.

## The setting, frozen from this pilot

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW=60000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=100`.
- Claude Code's debug log reports an effective window of 80,000 tokens for that pair. Compaction fired at 78,882, 72,535 and 78,478 tokens of context.
- The one setting tried was the first one tried. It gave 3 automatic compactions in 12 turns (after turns 3, 9 and 12), which is 15 over 60 turns at the same pace. The story's text is spread evenly (each 12 turns holds about 290,000 characters, 19.6 to 20.2 per cent of the total), so the pace should hold. The target was 12 to 18.
- At the first request after a compaction the context was 13,800 to 14,700 tokens, of which 5,215 is the fixed system prompt; the summary itself was 4,600 to 5,900. That leaves about 65,000 tokens of room per compaction. The summary grows over a run, so later compactions will come a little sooner.

## What was measured (12 turns, 3 compactions, 1 anchor question)

Tokens as the JSON reports them, per kind. A call here is one request to the model; the 12 turns made 23 of them, because the agent read and edited files inside a turn.

| | requests | input | cache written | cache read | output |
|---|---|---|---|---|---|
| 12 turns | 23 | 46 | 226,273 | 477,814 | 25,389 |
| 1 anchor (forked recall question) | 1 | 2 | 1,093 | 14,009 | about 550 |
| 3 compactions (not in the JSON; inferred from the reported cost) | 3 | 0 | 0 | about 75,000 each | about 5,000 to 7,000 each |

Cache written is new text sent to the model for the first time. Cache read is text it already holds, re-read at a lower price. The compaction row is inferred: the cost the CLI reported for the three compaction turns is about 0.10 to 0.13 USD higher than their visible tokens explain, which fits reading the whole context once and writing a summary.

- Per request in a turn: 2 input, 308 to 35,576 cache written and 3,589 to 54,132 cache read, depending on whether a paste had just arrived and how full the context was.
- Requests per compaction: about 8 in the turns around it (23 over 3), plus the compaction's own.
- Turns per compaction: 4 (12 over 3).
- Time: 6.75 minutes for the 12 turns, 14 seconds for the anchor. A plain turn took about 22 seconds. A turn that compacted took 54 to 87 seconds, about 47 seconds over a plain one. That is 2.3 minutes per compaction counting everything.
- Tools: 31 uses in 12 turns, none in the anchor. The agent read files in turn 1 and wrote or edited them in turns 2 to 5, 9 and 12; turns 6, 7, 8, 10 and 11 used no tool.
- The anchor was a fork of the session (`--resume <id> --fork-session`). The original session file holds 0 copies of the question and the fork holds 2, so the original never saw it. The fork answered from its context in one request and quoted the goals, rules and ruled-out options.
- Reported cost: 1.66 USD API-equivalent for the whole pilot (the field is a running total across resumes, so the per-turn figure is its difference). Those figures fit the token counts, unlike B19's. This is the price list's number, not plan use.

## Extrapolation to the real run (two full sessions, 5 anchors each)

Per session: the 12-turn figures times 5, plus 15 compactions and 5 anchors. Two sessions are double that. Session 3 runs only if the first two disagree and would add half as much again.

| | per session | two sessions |
|---|---|---|
| requests to the model | about 135 | about 270 |
| `claude` runs (60 turns plus 5 anchors) | 65 | 130 |
| input tokens | about 250 | about 500 |
| cache written | about 1.14 million | about 2.3 million |
| cache read | about 3.6 million | about 7.2 million |
| output | about 220,000 | about 440,000 |
| clock time | about 40 minutes | about 1.3 hours |
| API-equivalent cost | about 8.5 USD | about 17 USD |

The clock time is 45 plain turns at 22 seconds, 15 compacting turns at 69 seconds and 5 anchors at 14 seconds, about 35 minutes, plus a tenth for the summary growing. The runs go one after the other.

## Plan use

Source: the rate-limit fields Claude Code puts in its JSON stream (`rate_limit_info`). No `/usage` was run. The fields give the fraction used of two windows, to two decimal places.

- Before the pilot and after it: 5-hour window 0.06, weekly window 0.84. Neither moved by a point across a pilot that cost about 1.66 USD API-equivalent. The weekly figure carries Claude Code's own warning flag, set because it is past 0.75.
- The 5-hour window resets at 20:20 UTC on 19 October 2026. The weekly window resets at 22:00 UTC on 21 October 2026.
- The full run is about 10 times the pilot. So it should take under about 10 points of each window, probably far fewer, since the pilot moved less than one. That is an upper bound, not a measurement: one point is the smallest step the fields show. If the whole bound were used, the week would go from 84 to about 94.
- Other sessions on the same plan draw on the same windows, so the fields can move for reasons that are not this run.
- A way to measure it for real: start session 1 and read the fields after about 15 turns. The orchestrator can decide to stop on the reading.

## Open points for the orchestrator

- The anchor ran with the working session's tools on, so that its start matches the session it forks from. It used none this time. If it ever does (for example reading the rules folder), the answer is not a pure test of the context, and the run records the tool uses so that case can be seen and set aside.
- The agent builds real files in the scratch repo as it goes (a rules folder, parsing code). That is the point of the test, and the repo is reset at the start of each session.
