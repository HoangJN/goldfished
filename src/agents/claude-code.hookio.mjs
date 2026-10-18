// The one file that knows what Claude Code calls things in a hook. Every name and shape here was seen on a real run (TESTED.md).
export const inputKeys = {
  prompt: 'prompt',
  cwd: 'cwd',
  source: 'source',
  // The prompt hook gets the same keys for a typed prompt and for a turn the agent started itself. Nothing marks the human one.
  humanOrigin: null,
};

export const contextOutput = (text) => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });

export const screenOutput = (line) => ({ systemMessage: line });

export const blockOutput = (reply) => ({ decision: 'block', reason: reply });

// Ten thousand characters, counted in characters. Three-byte text at that length went through whole, so there is no byte cap to find.
export const contextCap = { chars: 10000, bytes: Infinity };

// true: the proof passed. false: it failed or never ran. Keys are the proof ids in TESTED.md.
export const proved = {
  ISO: true,
  P1: true,
  P3: true,
  P5: true,
  P6: true,
  'P6-auto': true,
  P8: true,
  P9: true,
  P10: true,
  'P10-residue': false,
  P11: true,
  P12: true,
};
