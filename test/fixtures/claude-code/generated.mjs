import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeGenerated(dir) {
  await mkdir(dir, { recursive: true });
  const paths = {
    'large-line.jsonl': join(dir, 'large-line.jsonl'),
    'modified-time.jsonl': join(dir, 'modified-time.jsonl'),
  };
  const record = (uuid, content) => ({
    type: 'user', uuid, parentUuid: null,
    timestamp: '2000-01-01T12:00:00Z', sessionId: 'kettle',
    cwd: '/srv/work/kettle.app', version: '2.1.7',
    message: { role: 'user', content },
  });
  const header = note => JSON.stringify({ _synthetic: true, note }) + '\n';
  await writeFile(paths['large-line.jsonl'],
    header('A typed message line exceeds 64 MiB and must be read.') +
    JSON.stringify(record('long-a', 'L'.repeat(64 * 1024 * 1024))) + '\n');
  await writeFile(paths['modified-time.jsonl'],
    header('Modified time is outside a recent days window.') +
    JSON.stringify(record('old-a', 'Keep the copper kettle beside the pantry.')) + '\n');
  const old = new Date('2000-01-01T12:00:00Z');
  await utimes(paths['modified-time.jsonl'], old, old);
  return paths;
}
