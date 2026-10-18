# Reading the labels

Read the message and the visible summary together. Judge only what a reader
can recover from that text. Do not guess what the agent remembers, consult
the project, or give credit for work the summary says was completed.

**kept** means the whole message is visible essentially in its own words.
Case, punctuation, quote marks and backticks may change. A small amount,
up to about one word in ten, may be missing at the very start or end. That
allowance is for trimming an edge, not for removing words inside a message.

**reworded** means the point survives but the words do not, or only part of
the message is quoted. Preserving one useful instruction from a longer
message is enough for reworded, but not for kept.

**gone** means the instruction cannot be recovered from the visible text.
A topic name, a claim that a task was done, or similar vocabulary alone does
not recover the request. An unrelated sentence can share words with it.

A meaning word such as "unless", "only if", "never", "not" or "except"
dropped from the middle is never kept. If the surrounding instruction still
survives, use reworded even when the missing word reverses a restriction.
If no instruction survives, use gone. A contradiction alone does not preserve
the original instruction; a surviving independent part can earn reworded.

## Worked examples

Message: `Please keep the clay preview panel open during repaint.`
Summary: `Current request: please keep the clay preview panel open during repaint.`
Label: **kept**. The words are there; case and punctuation do not matter.

Message: `Well, preserve the copper swatch selection between tab changes please.`
Summary: `Preserve the copper swatch selection between tab changes please.`
Label: **kept**. Only the first word of eleven has been trimmed.

Message: `Build the tide chart, but never fetch readings during a redraw.`
Summary: `Build the tide chart, but fetch readings during a redraw.`
Label: **reworded**. The chart request survives. The missing middle word
changes the restriction, so the near quotation cannot be kept.

Message: `Sort the crate names and show their weights beside them.`
Summary: `User asked to "sort the crate names". Weight display was omitted.`
Label: **reworded**. A quoted fragment preserves only part of the request.

Message: `Make the seed picker usable with arrow keys.`
Summary: `Keyboard navigation is required for choosing seeds.`
Label: **reworded**. The point is present in different words.

Message: `Close the amber tooltip when Escape is pressed.`
Summary: `The amber tooltip appears in the screenshot. Next task is font sizing.`
Label: **gone**. Mentioning the same object does not retain the instruction.

## Writing and checking the set

Every pair is invented and marked `_synthetic: true`. Summaries represent
visible compaction notes, not verified facts about a real project. Labels
apply to the entire message, including pasted text and secondary requests.
Choose the best label even when a boundary needs judgement.

Bands use the message's character length: short is 20 to 60, mid is 61 to
300, and long is 301 to 1,500. Characters mean Unicode code points. For the
shared-run check, lowercase each message, remove punctuation, split on
whitespace, and compare runs of five words across different messages.

At least 24 long messages exceed 700 characters and at least 12 exceed
1,100. Summaries have a median length of at least 1,200 characters, with
at least 40 exceeding 2,000 and none exceeding 4,000. Their surrounding
account describes other session work rather than repeating the message.

Strata describe the example's main challenge: condition is a dropped
condition word in a long message; fragment keeps only a quotation fragment;
exact contains the whole quotation; paraphrase keeps the meaning in other
words; paste contains a long pasted brief or data; near_miss shares an
opening or four-word run without keeping the message; other covers the rest.
Strata do not decide labels. The checker validates structure and quotas;
reading the rubric decides meaning.
