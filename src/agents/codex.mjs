import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readLines } from '../lines.mjs';
import { decode, mayNeed } from './codex.dialect.mjs';

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const emptyTally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
const normalise = path => path.replace(/\\/gu, '/').replace(/\/$/u, '');
const drift = new WeakMap();
function driftCounts(tally) {
  if (!drift.has(tally)) drift.set(tally, { conversation: 0, known: 0, unfamiliar: 0 });
  return drift.get(tally);
}

async function listFiles(root, { sinceMs = 0 } = {}) {
  const files = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = join(dir, entry.name);
      if (depth < 3 && entry.isDirectory() && (depth === 0 ? /^\d{4}$/u : /^\d{2}$/u).test(entry.name)) await walk(file, depth + 1);
      else if (depth === 3 && entry.isFile() && /^rollout-.*\.jsonl$/u.test(entry.name)) {
        const { size, mtimeMs } = await stat(file);
        if (mtimeMs >= sinceMs) files.push({ file, size, mtimeMs, group: root });
      }
    }
  }
  await walk(root, 0);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function readSession({ file, group }, tally, seen = new Set()) {
  const session = { key: file, group, project: '', auto: false, sub: false,
    firstMs: null, lastMs: null, versions: [], typed: [], compactions: [], cardResent: false };
  let directory;
  const checks = driftCounts(tally), reader = readLines(file, { mayNeed });
  tally.files++;
  try {
    for (;;) {
      const { value, done } = await reader.next();
      if (done) {
        for (const key of ['bytes', 'lines', 'skippedLong']) tally[key] += value[key];
        value.lineBuckets.forEach((amount, bucket) => { tally.lineBuckets[bucket] = (tally.lineBuckets[bucket] ?? 0) + amount; });
        break;
      }
      const { text: line } = value;
      if (value.partial || !line.trim()) continue;
      let record;
      try { record = decode(line, value.n); } catch { tally.malformed++; continue; }
      if (!record) continue;
      session.cardResent ||= record.cardResent;
      count(tally.types, record.kind);
      for (const unknown of record.unknown) count(tally.types, unknown);
      if (record.compactLike) tally.compactLike++;
      if (record.understood) tally.understood++;
      if (record.unfamiliar) checks.unfamiliar++;
      if (record.invalid) tally.malformed++;
      if (record.conversation) { checks.conversation++; if (record.known) checks.known++; }
      session.auto ||= record.automated;
      if (directory === undefined && record.directory !== undefined) {
        directory = record.directory; session.project = normalise(directory).split('/').at(-1);
      }
      if (record.release && !session.versions.includes(record.release)) session.versions.push(record.release);
      if (Number.isFinite(record.ms)) {
        session.firstMs = session.firstMs === null ? record.ms : Math.min(session.firstMs, record.ms);
        session.lastMs = session.lastMs === null ? record.ms : Math.max(session.lastMs, record.ms);
      }
      if (record.boundary) session.compactions.push({ epoch: session.compactions.length + 1, visible: record.visible });
      if (record.body !== undefined && !seen.has(record.dedupeKey)) {
        seen.add(record.dedupeKey);
        session.typed.push({ id: record.identity, epoch: session.compactions.length, text: record.body });
      }
    }
  } finally { await reader.return(); }
  return { session, directory };
}

export default {
  id: 'codex',
  roots: (env, homedir) => [join(env.CODEX_HOME || join(homedir, '.codex'), 'sessions')],
  listFiles,
  async *sessions(files, tally) {
    const seen = new Set();
    for (const file of files) yield (await readSession(file, tally, seen)).session;
  },
  async findTyped(cwd, roots, options = {}) {
    const files = (await Promise.all(roots.map(root => listFiles(root, options)))).flat().sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files) {
      const { session, directory } = await readSession(file, emptyTally());
      if (directory !== undefined && normalise(resolve(directory)) === normalise(resolve(cwd))) return session.typed.map(({ text }) => text);
    }
    return null;
  },
  driftCheck(tally) {
    const checks = driftCounts(tally), reasons = [];
    if (checks.unfamiliar) reasons.push('I2');
    if (checks.known < checks.conversation * 0.9 || tally.malformed > tally.lines * 0.05) reasons.push('I4');
    return { ok: reasons.length === 0, reasons, unread: tally.compactLike - tally.understood };
  },
};
