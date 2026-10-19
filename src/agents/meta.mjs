export const META = Object.fromEntries([
  ['claude-code', 'Claude Code', '/compact', true, false, "In our tests Claude Code's summary quoted every message you typed, through 30 compactions, and cut long pastes to a line. Those compactions were forced; a real one may differ."],
  ['codex', 'Codex', '/compact', true, false, 'Codex keeps your typed messages word for word in what it carries forward; in our runs the oldest dropped out once they passed about 256,000 characters.'],
  ['cursor', 'Cursor', null, false, true], ['cline', 'Cline', null, false, true],
  ['devin', 'Devin', null, false, true], ['continue', 'Continue', null, false, true],
  ['gemini', 'Gemini CLI', '/compress'], ['copilot', 'GitHub Copilot', '/compact'],
  ['junie', 'Junie'], ['aider', 'Aider'], ['qwen', 'Qwen Code'], ['opencode', 'OpenCode'],
].map(([id, label, compactCommand = null, hook = false, rulesFile = false, note = null]) =>
  [id, { label, budget: id === 'claude-code' ? 9500 : 6000, note, compactCommand, hook, rulesFile }]));
