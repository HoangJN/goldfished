import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const padding = 'Copper lanterns illuminated an empty courtyard. Distant thunder rolled beyond the silent hills.';

export async function render(story, fate, { agent, copy, root, resumedCopy = false, fixture = false }) {
  const [head, ...turns] = story, [pattern, ...rows] = fate;
  if (!['claude-code', 'codex'].includes(agent) || !/^f\d{2}$/.test(pattern.session) ||
      !Number.isSafeInteger(copy) || copy < 0 || !Number.isInteger(head.compactEvery) || head.compactEvery < 1) {
    throw new Error('Invalid long session options');
  }
  const identity = resumedCopy ? 0 : copy;
  const id = `${pattern.session}-${identity}`;
  const base = Date.UTC(2026, 0, Number(pattern.session.slice(1)), identity);
  const records = [{ _synthetic: true, note: 'Invented harbour work across repeated compactions.' }];
  const fates = new Map(rows.map(row => [row.turn, row]));
  const card = 'goldfished: this conversation has just been compacted.\nGOAL\n' +
    turns.filter(t => t.class === 'goal').map(t => t.text).join('\n') + '\nRULES\n' +
    turns.filter(t => t.class === 'rule').map(t => t.text).join('\n');
  const stamp = () => new Date(base + records.length * 1000).toISOString();
  const user = (text, suffix, summary = false) => ({ type: 'user', uuid: `${id}-${suffix}`,
    parentUuid: null, timestamp: stamp(), sessionId: id, cwd: head.cwd, version: '2.1.292',
    ...(summary ? { isCompactSummary: true } : { turnOrigin: 'human' }), message: { role: 'user', content: text } });
  if (agent === 'codex') records.push({ timestamp: stamp(), type: 'session_meta',
    payload: { id, cwd: head.cwd, cli_version: '0.163.0', originator: 'codex_cli_rs', source: 'cli' } });
  for (const turn of turns) {
    records.push(agent === 'claude-code' ? user(turn.text, `t${turn.turn}`) :
      { timestamp: stamp(), type: 'event_msg', payload: { type: 'user_message', message: turn.text } });
    if (turn.turn % head.compactEvery) continue;
    const epoch = turn.turn / head.compactEvery, visible = [padding];
    for (const earlier of turns) {
      if (earlier.turn > turn.turn) break;
      const length = Array.from(earlier.text).length;
      if (length < 20 || length > 1500) continue;
      const row = fates.get(earlier.turn);
      if (!row) throw new Error(`Missing fate for turn ${earlier.turn}`);
      const age = epoch - Math.floor((earlier.turn - 1) / head.compactEvery);
      const label = row.labels ? row.labels[age - 1] :
        age <= row.keptTo ? 'kept' : age <= row.rewordedTo ? 'reworded' : 'gone';
      if (label === 'kept') visible.push(earlier.text);
      else if (label === 'reworded' && !fixture) visible.push(earlier.reworded);
    }
    const text = visible.join('\n');
    if (agent === 'claude-code') {
      records.push({ type: 'system', subtype: 'compact_boundary', uuid: `${id}-c${epoch}`,
        timestamp: stamp(), sessionId: id, compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 21000 } });
      records.push(user(text, `s${epoch}`, true));
      if (pattern.cardResent) records.push({ type: 'attachment', uuid: `${id}-h${epoch}`,
        attachment: { type: 'hook_additional_context', content: [card] } });
    } else {
      records.push({ timestamp: stamp(), type: 'compacted', payload: { message: text, replacement_history: [] } });
      if (pattern.cardResent) records.push({ type: 'response_item', payload: { type: 'message', role: 'developer',
        content: [{ type: 'input_text', text: card }] } });
    }
  }
  const directory = agent === 'claude-code' ? join(root, 'skerrylog') : join(root, '2026', '01', '01');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${agent === 'codex' ? 'rollout-' : ''}${id}${resumedCopy ? '-resumed' : ''}.jsonl`);
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return file;
}
