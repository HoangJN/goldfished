import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readLines } from '../lines.mjs';
import { decode, mayNeed } from './claude-code.dialect.mjs';

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const emptyTally = () => ({ files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] });
const normalise = path => path.replace(/\\/gu, '/').replace(/\/$/u, '');
const normalText = text => text.trim().replace(/\s+/gu, ' ').toLowerCase();
const drift = new WeakMap();
function driftCounts(tally) {
  if (!drift.has(tally)) drift.set(tally, { compactions: 0, unmatched: 0, conversation: 0, known: 0, unfamiliar: 0 });
  return drift.get(tally);
}

async function listFiles(root, { sinceMs = 0 } = {}) {
  const files = [];
  async function walk(dir, group) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, group ?? (entry.name === 'subagents' ? root : file));
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const { size, mtimeMs } = await stat(file);
        if (mtimeMs >= sinceMs) files.push({ file, size, mtimeMs, group: group ?? root });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function readSession({ file, group }, tally, seen = new Set()) {
  const session = { key: file, group, project: '', auto: false, sub: normalise(file).split('/').includes('subagents'),
    firstMs: null, lastMs: null, versions: [], typed: [], compactions: [], cardResent: false };
  let directory, pending, tail = new Map();
  const identities = new Map(), texts = new Map(), checks = driftCounts(tally);
  tally.files++;
  const reader = readLines(file, { mayNeed });
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
      if (record.malformed) { tally.malformed++; continue; }
      session.cardResent ||= record.cardResent;
      session.auto ||= record.automated;
      if (directory === undefined && record.directory !== undefined) {
        directory = record.directory; session.project = normalise(directory).split('/').at(-1);
      }
      if (record.release && !session.versions.includes(record.release)) session.versions.push(record.release);
      if (Number.isFinite(record.ms)) {
        session.firstMs = session.firstMs === null ? record.ms : Math.min(session.firstMs, record.ms);
        session.lastMs = session.lastMs === null ? record.ms : Math.max(session.lastMs, record.ms);
      }
      const epoch = session.compactions.length;
      const fingerprint = !record.reason ? normalText(record.body) : null;
      const kept = !record.reason && epoch > 0 &&
        ((identities.has(record.dedupeKey) && identities.get(record.dedupeKey) < epoch) ||
          (texts.has(fingerprint) && texts.get(fingerprint) < epoch));
      if (kept && !tail.has(record.dedupeKey)) {
        tail.set(record.dedupeKey, record.body);
        const current = session.compactions.at(-1);
        if (!pending && current.visible !== null) current.visible += '\n' + record.body;
      }
      if (!record.reason) {
        if (!identities.has(record.dedupeKey)) identities.set(record.dedupeKey, epoch);
        if (!texts.has(fingerprint)) texts.set(fingerprint, epoch);
      }
      if (seen.has(record.dedupeKey)) continue;
      seen.add(record.dedupeKey);
      count(tally.types, record.kind);
      if (record.reason) count(tally.rejects, record.reason);
      if (record.compactLike) tally.compactLike++;
      if (record.understood) tally.understood++;
      if (record.invalid) tally.malformed++;
      if (record.conversation) { checks.conversation++; if (record.known) checks.known++; }
      if (record.unfamiliar) checks.unfamiliar++;
      if (record.boundary) {
        if (pending) checks.unmatched++;
        checks.compactions++;
        tail = new Map();
        pending = { epoch: session.compactions.length + 1, visible: null, ...record.sizes };
        session.compactions.push(pending);
      }
      if (record.summary) {
        if (!pending) {
          checks.unmatched++; checks.compactions++; tail = new Map();
          pending = { epoch: session.compactions.length + 1, visible: null }; session.compactions.push(pending);
        }
        pending.visible = [record.body, ...tail.values()].join('\n'); pending = undefined;
      }
      if (!record.reason && !kept) {
        session.typed.push({ id: record.identity, epoch: session.compactions.length, text: record.body });
      }
    }
  } finally { await reader.return(); }
  if (pending) checks.unmatched++;
  return { session, directory };
}

export default {
  id: 'claude-code',
  roots: (env, homedir) => [join(env.CLAUDE_CONFIG_DIR || join(homedir, '.claude'), 'projects')],
  listFiles,
  async *sessions(files, tally) {
    const groups = new Map();
    for (const file of files) {
      if (!groups.has(file.group)) groups.set(file.group, new Set());
      yield (await readSession(file, tally, groups.get(file.group))).session;
    }
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
    if (checks.unmatched > checks.compactions * 0.2) reasons.push('I1');
    if (checks.unfamiliar) reasons.push('I2');
    if (checks.known < checks.conversation * 0.9 || tally.malformed > tally.lines * 0.05) reasons.push('I4');
    return { ok: reasons.length === 0, reasons, unread: tally.compactLike - tally.understood };
  },
};
