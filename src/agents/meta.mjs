export const META = Object.fromEntries([
  ['claude-code', 'Claude Code', '/compact', true, false, "Why so high after one: in our tests Claude Code's first summary quoted your messages. The next compaction summarises that summary."],
  ['codex', 'Codex', '/compact', true, false, 'Codex keeps your newest messages word for word by design, up to about 20,000 tokens.'],
  ['cursor', 'Cursor', null, false, true], ['cline', 'Cline', null, false, true],
  ['devin', 'Devin', null, false, true], ['continue', 'Continue', null, false, true],
  ['gemini', 'Gemini CLI', '/compress'], ['copilot', 'GitHub Copilot', '/compact'],
  ['junie', 'Junie'], ['aider', 'Aider'], ['qwen', 'Qwen Code'], ['opencode', 'OpenCode'],
].map(([id, label, compactCommand = null, hook = false, rulesFile = false, note = null]) =>
  [id, { label, budget: id === 'claude-code' ? 9500 : 6000, note, compactCommand, hook, rulesFile }]));
