import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export async function writeGenerated(dir) {
  const name = 'sessions/2026/01/06/rollout-large-compacted.jsonl';
  const path = join(dir, name);
  await mkdir(dirname(path), { recursive: true });
  const timestamp = '2026-01-06T12:00:00Z';
  const kept = 'Keep the copper kettle beside the pantry.';
  const records = [
    { _synthetic: true, note: 'A compacted line exceeds 64 MiB. Readable replacement_history keeps the first message; the second is wholly absent. payload.message is empty.' },
    { timestamp, type: 'session_meta', payload: {
      id: 'large-kettle', cwd: '/srv/work/large-kettle', cli_version: '0.1.0',
      originator: 'codex_cli_rs', source: 'cli',
    } },
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: kept } },
    { timestamp, type: 'event_msg', payload: {
      type: 'user_message', message: 'Paint the garden gate a bright violet.',
    } },
    { timestamp, type: 'compacted', payload: { message: '', replacement_history: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: kept }] },
      { type: 'message', role: 'assistant', content: [
        { type: 'output_text', text: 'Z'.repeat(64 * 1024 * 1024) },
      ] },
    ] } },
  ];
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return { [name]: path };
}
