# Contributing

goldfished is tested on Claude Code and Codex, and on nothing else. If you use another agent, you are the person who can find out what is true for it. Reports and code from you are what make this project work for more than two tools.

Everything here runs on your machine. goldfished never uses the network, and nothing in this guide asks you to send it a session.

## Report a bug

Run this in the project where it went wrong:

```sh
npx goldfished bug
```

It prints a short report of counts and fixed words: the goldfished version, your Node major version, your platform, how many session files it read for each agent, whether it understood them, and whether your card is trusted. It never prints session text, a path, a project name or a date. Paste the output into a bug issue.

Never paste session text, a path or a project name into an issue yourself. If you need to show a message to explain a problem, invent one that behaves the same way.

If one agent is the problem, `npx goldfished bug --agent <id>` limits the report to it.

## A format change

When `retro` prints `format drift` for an agent, the agent's session files have changed shape since goldfished last saw them (a new version of the agent, usually). Run:

```sh
goldfished shapes --agent <agent>
```

and paste the output into a format change issue. It holds counts only: the kinds of record, how often they appear and how many were not understood.

## Does your agent keep the card

The card is your goal, rules and ruled-out options, kept in front of the agent after it compacts (replaces your conversation with a summary it writes itself). To find out whether your agent keeps it:

```sh
goldfished probe <agent>
```

Follow the three steps it prints, then record what you saw with `goldfished probe <agent> --saw yes` or `--saw no`. Report the result in an agent issue, with the agent's version and whether goldfished finds its sessions.

A probe result is your observation on your machine. It is not a claim in TESTED.md. That file only holds what the project's own live runs showed.

## Add an agent

An agent needs six things. Read the two that exist, `claude-code` and `codex`, and copy their shape.

1. **An adapter**, `src/agents/<id>.mjs` (see `claude-code.mjs` and `codex.mjs`). An adapter is the code that reads one agent's session files. Its default export has an `id`, `roots(env, homedir)` (the folders to look in), `listFiles(root, options)`, `sessions(files, tally)` (an async generator that yields one session at a time and counts what it sees in `tally`), `findTyped(cwd, roots, options)` and `driftCheck(tally)`.
2. **A dialect**, `src/agents/<id>.dialect.mjs` (see `claude-code.dialect.mjs` and `codex.dialect.mjs`). The dialect is the only file that knows the agent's own field names, and it turns one line of a session file into the plain record the adapter uses. The gate fails any session field name that shows up outside a dialect file.
3. **Hook input and output**, only if the agent has hooks (small programs the agent runs at set moments): `src/agents/<id>.hookio.mjs` (see `claude-code.hookio.mjs` and `codex.hookio.mjs`). It names the keys the agent's hook receives, the shape of the reply that adds context, shows a line or blocks a prompt, and the size cap on added context. Its `proved` table says which live checks passed, and a check may be `true` only if TESTED.md has the passing row. Then wire the agent into `src/hook.mjs`, which today lists the two agents it knows, and keep `hooks/run.mjs` as the launcher. The hook code must not import any adapter or dialect; the gate checks that.
4. **The index entry**, `src/agents/index.mjs`. Add the adapter to the `adapters` array.
5. **The meta and pointer entries**: a row in `src/agents/meta.mjs` (label, compact command, whether it has a hook, whether it reads a rules file) and, if it reads project instructions from a file, a row in `src/agents/pointers.mjs` (the file `init` writes the pointer into, and the folders that show the agent is in use).
6. **A fixture folder**, `test/fixtures/<id>/`, holding invented session files and an `expected.json` that says what the adapter should find in each (see `test/fixtures/codex/` and `test/fixtures/claude-code/`). `expected.json` carries `"_synthetic": true`, and so does the first line of every session file. Never copy a real session, even trimmed.

Then add tests: `test/<id>.test.mjs` for the adapter, `test/fixtures-<id>.test.mjs` for the fixtures against `expected.json`, a drift test like `test/claude-code-drift.test.mjs`, and `test/<id>-hookio.test.mjs` if you wrote a hook file.

Finally, add one row to `TESTED.md` from a live run on your machine. The row names the agent, its version and the date, says what you ran, and says what came back. If a check fails, say so in the row and leave that feature off the agent's entry. A fixture proves how goldfished handles an invented file; only a live run proves what the agent does.

## Help wanted

Nobody here has tested these. Each route below is a guess from reading about the agent, and each must be checked against that agent's current documentation and proved on a live run before it goes in.

- **Gemini CLI hooks.** Likely route: a PreCompress hook sets a flag, and the next BeforeAgent hook adds the card once.
- **GitHub Copilot hooks.** Likely route: a preCompact hook sets a flag, and the next postToolUse hook adds the card once.
- **A Qwen Code adapter.** It needs a way to read Qwen Code's session files, so it starts with the adapter and dialect above.

A route for Gemini, Copilot or Qwen is merged only with all four of these:

- A fail-open test: bad or unexpected input makes the hook exit 0 and print nothing.
- The no-network check passing.
- A fixture marked `"_synthetic": true`.
- A TESTED.md row from a live run by someone who has that agent, naming its version and the date.

## Before a pull request

Run `npm test` and `npm run gate`. Both must be green. The gate checks these things, and fails the run if one is wrong:

- No em-dash character (U+2014) in any file.
- No network imports, `fetch` calls or WebSocket use in `src`, `bin` or `hooks`.
- Every session fixture file carries `"_synthetic": true` on its first line.
- No key-shaped strings or personal paths in any file, and no invisible characters outside fixtures.
- Commit and tag messages carry no tool co-author trailer and no generated-by footer, from anyone. A commit or tag from an AI company address or a bot name fails too, and so does a commit under the project's own email with a different name.

The gate does not check the next four. The maintainer checks them by eye, and a pull request that breaks one will be sent back:

- British English in prose.
- No dependencies.
- No install scripts.
- Fixtures are invented, never a real session, even trimmed. The marker says a fixture is synthetic; only you can say it is true.

The maintainer squash-merges pull requests (joins all their commits into one). If your tool added a co-author or generated-by line to a commit message, remove it, or turn that tool's co-author setting off.

Keep comments few. A comment says why, never what.

## Licence and security

Contributions are under the MIT licence, the same as the rest of the project (see `LICENSE`).

Security problems go through [SECURITY.md](SECURITY.md), never an issue.
