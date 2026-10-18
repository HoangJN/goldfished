export const POINTERS = [
  { agent: 'all', markers: [], target: 'AGENTS.md', kind: 'block', header: '' },
  { agent: 'claude-code', markers: ['CLAUDE.md', '.claude/'], target: 'CLAUDE.md', kind: 'block', header: '' },
  { agent: 'gemini', markers: ['GEMINI.md', '.gemini/'], target: 'GEMINI.md', kind: 'block', header: '' },
  { agent: 'copilot', markers: ['.github/'], target: '.github/copilot-instructions.md', kind: 'block', header: '' },
  { agent: 'junie', markers: ['.junie/'], target: '.junie/AGENTS.md', kind: 'block', header: '' },
  { agent: 'aider', markers: ['CONVENTIONS.md', '.aider.conf.yml'], target: 'CONVENTIONS.md', kind: 'block', header: '' },
  { agent: 'cursor', markers: ['.cursor/'], target: '.cursor/rules/goldfished.mdc', kind: 'owned', header: "---\ndescription: The user's card\nalwaysApply: true\n---\n" },
  { agent: 'continue', markers: ['.continue/'], target: '.continue/rules/goldfished.md', kind: 'owned', header: "---\nname: The user's card\nalwaysApply: true\n---\n" },
  { agent: 'devin', markers: ['.devin/', '.windsurf/'], target: '.devin/rules/goldfished.md', kind: 'owned', header: '---\ntrigger: always_on\n---\n' },
  { agent: 'cline', markers: ['.clinerules/'], target: '.clinerules/goldfished.md', kind: 'owned', header: '' },
];

export function detect(exists) {
  return POINTERS.filter(({ agent, markers }) => agent === 'all' || markers.some(marker =>
    marker.endsWith('/') ? exists(marker.slice(0, -1)) === 'dir' : exists(marker) != null
  ) || (agent === 'cline' && exists('.clinerules') === 'file')).map(({ agent }) => agent);
}
