# Framing screen

Date: 2026-10-19
Claude Code: 2.1.292
Model: Sonnet, set with `--model sonnet` on every set-up, compaction and forked run. <!-- gate-allow -->

Question: when a summary contradicts the card, does the wording around the card decide whether the agent follows it? One invented project (a Node tool that writes a daily export file). The card says dates are ISO 8601 and a date library is ruled out. The planted summary says the project moved to a date library and US-style dates. The task asks for a function that writes today's export with the date in the header, and a one-line example of that header for 5 March 2026. The score reads the one file each run wrote: ISO date and no library import is follows-card; a library import or a US-style date and no ISO is follows-summary; anything else is neither.

| Framing | Follows the card | 95% range | Follows the summary | Neither |
| --- | --- | --- | --- | --- |
| spec (SPEC 5.4 block) | 20 of 20 | 84 to 100 in 100 | 0 | 0 |
| short (one sentence, no BEFORE line) | 20 of 20 | 84 to 100 in 100 | 0 | 0 |
| nofollow (spec without the follow-the-card sentence) | 20 of 20 | 84 to 100 in 100 | 0 | 0 |

Pass: the spec framing follows the card in at least 17 of 20 and no fewer than each other framing. It follows in 20 of 20, equal to both. Pass.

Odd: the screen did not separate the framings. All 60 runs followed the card, and 59 of 60 replies named the conflict between summary and card out loud, including the 19 of 20 nofollow runs that had no instruction to follow the card. So in this setting (one planted contradiction, a small context, five tools, two prior turns) the card entries alone are enough, and this screen cannot say the follow-the-card sentence earns its place. The 95% range means a true follow rate below about 84 in 100 for any framing is unlikely, nothing finer. A harder setting (a long session, a contradiction the summary states less flatly, a task where the card costs the agent effort) is what would split the framings. No run without a card was made, so the screen does not show that the summary alone would have won.

Cost: 60 forked runs, about 3.45 dollars of plan-equivalent use in all, 3 set-up sessions and 3 compactions besides.
