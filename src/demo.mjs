const noon = day => Date.UTC(2026, 8, day, 12);
const curve = (messages, kept, reworded, sessions) => messages.map((n, i) => ({ age: i + 1, messages: n, sessions: sessions[i], kept: kept[i], reworded: reworded[i], gone: n - kept[i] - reworded[i] }));
export const DEMO = {
  toolVersion: '1.0.0', window: { days: 30, fromMs: noon(1), toMs: noon(30) },
  files: 427, bytes: 734500000, secs: 8, notGraded: { auto: 17, sub: 29 },
  roots: [], cardTrusted: false, save: false, probes: [], headlineAgent: 'claude-code',
  agents: [
    { id: 'claude-code', label: 'Claude Code', status: 'ok', sessions: 287, compacted: 64, messages: 2837,
      firstMs: noon(3), lastMs: noon(28), curve: curve([1360, 720, 480, 300], [1292, 302, 115, 54], [34, 108, 72, 48], [64, 32, 21, 13]),
      composition: curve([300, 300, 300], [279, 150, 96], [12, 60, 66], [13, 13, 13]),
      span: 1, censored: false, headlineAge: 4,
      headline: { age: 4, keptPer100: 18, ci95: [11, 27], messages: 300, sessions: 13 },
      verdict: { id: 'short', line: 'Short memory. More than half your words are gone by the second compaction.' },
      note: "Why so high after one: in our tests Claude Code's first summary quoted your messages. The next compaction summarises that summary.",
      card: { sessions: 4, age: 4, keptPer100: null }, drift: null, notCounted: { short: 345, pasted: 73 } },
    { id: 'codex', label: 'Codex', status: 'ok', sessions: 76, compacted: 23, messages: 945,
      firstMs: noon(4), lastMs: noon(29), curve: curve([650, 410, 280, 170], [598, 295, 165, 95], [26, 49, 42, 34], [23, 19, 15, 11]),
      composition: null, span: 4, censored: true, headlineAge: 4,
      headline: { age: 4, keptPer100: 56, ci95: [44, 68], messages: 170, sessions: 11 },
      verdict: { id: 'at_least', line: 'At least 4 compactions so far.' },
      note: 'Codex keeps your newest messages word for word by design, up to about 20,000 tokens.',
      card: null, drift: null, notCounted: { short: 127, pasted: 39 } },
  ], show: null, audit: null, history: null,
};
