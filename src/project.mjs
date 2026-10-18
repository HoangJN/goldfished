import { statSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function gitDir(top) {
  const marker = join(top, '.git');
  try {
    if (statSync(marker).isDirectory()) return marker;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  const match = /^gitdir:\s*(.+?)\s*$/i.exec(read(marker));
  return match ? resolve(top, match[1]) : null;
}

export function topLevel(cwd) {
  let current = resolve(cwd);
  for (;;) {
    if (gitDir(current)) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

export function commonDir(top) {
  const dir = gitDir(top) ?? join(top, '.git');
  const common = read(join(dir, 'commondir'));
  return common === null ? dir : resolve(dir, common.trim());
}

export function mainCheckout(top) {
  return dirname(commonDir(top));
}

export function exclude(top, line) {
  const info = join(commonDir(top), 'info');
  const file = join(info, 'exclude');
  const text = read(file) ?? '';
  if (text.split(/\r?\n/).includes(line)) return { added: false };
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  mkdirSync(info, { recursive: true });
  appendFileSync(file, (text && !text.endsWith('\n') ? newline : '') + line + newline);
  return { added: true };
}
