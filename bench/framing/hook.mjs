#!/usr/bin/env node
// Scratch SessionStart hook for the compact matcher: prints the framing file named in FRAMING_FILE as added context.
import { readFileSync } from 'node:fs';

process.stdin.resume();
process.stdin.on('end', () => {
  const additionalContext = readFileSync(process.env.FRAMING_FILE, 'utf8');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
});
