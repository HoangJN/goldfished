import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function home(env) {
  const dir = env.GOLDFISHED_HOME || join(homedir(), '.goldfished');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  return dir;
}

function readObject(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function privateFile(file) {
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}

function writeObject(dir, name, value) {
  const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600 });
    renameSync(temp, join(dir, name));
  } finally {
    rmSync(temp, { force: true });
  }
}

function cardKey(cardPath) {
  const path = realpathSync(cardPath);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function untrustReason(cardPath, hash) {
  const dir = home(process.env);
  const records = readObject(join(dir, 'trust.json'));
  const key = cardKey(cardPath);
  const record = Object.hasOwn(records, key) ? records[key] : null;
  if (!record || typeof record.hash !== 'string' || typeof record.date !== 'string') {
    return 'never saved through goldfished on this machine';
  }
  return record.hash === hash ? null : `changed by hand since ${record.date.slice(0, 10)}`;
}

export function trusted(cardPath, hash) {
  return untrustReason(cardPath, hash) === null;
}

export function trust(cardPath, hash) {
  const dir = home(process.env);
  const records = readObject(join(dir, 'trust.json'));
  records[cardKey(cardPath)] = { hash, date: new Date().toISOString() };
  writeObject(dir, 'trust.json', records);
}

export function state() {
  return readObject(join(home(process.env), 'state.json'));
}

export function setState(patch) {
  const dir = home(process.env);
  writeObject(dir, 'state.json', { ...readObject(join(dir, 'state.json')), ...patch });
}

export function appendHistory(obj) {
  const file = join(home(process.env), 'history.jsonl');
  appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
  privateFile(file);
}

export function lastHistory(id, beforeMs) {
  const file = join(home(process.env), 'history.jsonl');
  if (!existsSync(file)) return null;
  let newest = null;
  let newestMs = -Infinity;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    const ms = Date.parse(obj.date);
    if (obj.id === id && ms <= beforeMs && ms >= newestMs) {
      newest = obj;
      newestMs = ms;
    }
  }
  return newest;
}

export function logError(err) {
  const file = join(home(process.env), 'errors.log');
  const { message = '', stack = '' } = err ?? {};
  if (typeof message !== 'string' || typeof stack !== 'string') return;
  appendFileSync(file, JSON.stringify({ date: new Date().toISOString(), message, stack }) + '\n', { mode: 0o600 });
  privateFile(file);
  const bytes = readFileSync(file);
  const limit = 64 * 1024;
  if (bytes.length > limit) {
    const end = bytes.indexOf(10, bytes.length - limit - 1);
    writeFileSync(file, end < 0 ? Buffer.alloc(0) : bytes.subarray(end + 1));
  }
}
