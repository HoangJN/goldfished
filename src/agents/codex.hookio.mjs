// The one file that knows what Codex calls things in a hook. Every name and shape here was seen on a real run (TESTED.md).
export const inputKeys = {
  prompt: 'prompt',
  cwd: 'cwd',
  source: 'source',
  // The prompt hook gets the same keys whoever started the turn. Nothing marks the human one.
  humanOrigin: null,
};

export const contextOutput = (text) => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });

export const screenOutput = (line) => ({ systemMessage: line });

export const blockOutput = (reply) => ({ decision: 'block', reason: reply });

// Codex counts 2,500 tokens as bytes over four, rounded up. Ten thousand bytes went through whole; one more was cut. No character cap showed.
export const contextCap = { chars: Infinity, bytes: 10000 };

// true: the proof passed. false: it failed or never ran. Keys are the proof ids in TESTED.md.
export const proved = {
  ISO: true,
  CX1: true,
  CX2: true,
  CX3: false,
};
