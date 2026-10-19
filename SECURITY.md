# Security

Report a security problem through GitHub's private vulnerability reporting on this repository: open **Security**, then **Report a vulnerability**. Keep session files and message text out of public issues. Use an invented example to show the problem.

goldfished reads local agent session files to measure compaction. Card commands and hooks read the project's card, its instruction files and goldfished's local state. The software has zero runtime dependencies, no install scripts and no network code. The gate checks network imports, and the test suite blocks network modules.

goldfished itself sends nothing. The card is handed to your agent, which sends it to its model like any other prompt.

`retro` writes nothing unless you pass `--save`, which saves counts only. Default output contains no message text, paths below a root or project names. `--json` always contains counts only. `--show` and `--audit` deliberately display text: treat their output as private.

goldfished writes only:

- The card and its siblings in the project's `.goldfished/` folder.
- The pointer blocks and owned files shown by `init`, including later updates from the card.
- Lines in the local Git exclude list.
- Its local home, `~/.goldfished/`: `trust.json`, `state.json`, `history.jsonl` and `errors.log`. The error log is capped at 64 KB and never holds message text. `GOLDFISHED_HOME` moves this home. On POSIX the home has mode 0700 and its files mode 0600.

Real session files must never enter this repository, a test, a fixture or an issue template. The tests use invented sessions.
