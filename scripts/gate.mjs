#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldNames } from '../src/agents/claude-code.dialect.mjs';

export const MARKER = 'gate-allow';
const DASHES = new RegExp('[' + String.fromCharCode(0x2014, 0x2015) + ']');
const BOM = new RegExp('^' + String.fromCharCode(0xfeff));

function scanLines(text, perLine) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(MARKER)) return;
    for (const reason of perLine(line)) out.push({ line: i + 1, reason });
  });
  return out;
}

export function checkEmDash(text) {
  return scanLines(text, (line) => (DASHES.test(line) ? ['em-dash'] : []));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseDenylist(content) {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((raw) => {
      const short = raw.length <= 5 && raw === raw.toUpperCase() && /[A-Z]/.test(raw);
      const body = escapeRe(raw);
      return { raw, re: new RegExp(short ? `\\b${body}\\b` : body, 'i') };
    });
}

export function checkDenylist(text, patterns) {
  return scanLines(text, (line) =>
    patterns.filter((p) => p.re.test(line)).map((p) => `denylist pattern "${p.raw}"`),
  );
}

const SECRET_SHAPES = [
  ['sk-ant- prefix', /sk-ant-/], // gate-allow
  ['sk- key', /\bsk-\w{20,}/], // gate-allow
  ['ghp_ token', /ghp_/], // gate-allow
  ['github_pat_ token', /github_pat_/], // gate-allow
  ['AWS access key id', /AKIA[0-9A-Z]{16}/], // gate-allow
  ['Slack token', /xox[abp]-/], // gate-allow
  ['private key block', /-----BEGIN/], // gate-allow
];

export function checkSecrets(text) {
  return scanLines(text, (line) => {
    const hits = SECRET_SHAPES.filter(([, re]) => re.test(line)).map(([name]) => `secret shape: ${name}`);
    for (const run of line.match(/[A-Za-z0-9]{32,}/g) ?? []) {
      if (/[A-Za-z]/.test(run) && /\d/.test(run)) hits.push('secret shape: long mixed letters and digits');
    }
    return hits;
  });
}

const IMPORT_OF = (names) =>
  new RegExp(`(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(['"])(?:node:)?(?:${names})(?:\\/[^'"]*)?\\1`);
const NET_IMPORT = IMPORT_OF('http|https|http2|net|dns|tls|dgram|worker_threads');
const PROCESS_IMPORT = IMPORT_OF('child_process');
const FETCH_CALL = /\bfetch\s*\(/; // gate-allow
const WEBSOCKET = /\bWebSocket\b/; // gate-allow
export const NETWORK_DIRS = ['src/', 'bin/', 'hooks/'];
export const PROCESS_FILE = 'src/git.mjs';

// The one check a marker cannot switch off. A tool that promises it never phones home keeps the promise on every line.
export function checkNetwork(text, file = 'src/') {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const hit = (reason) => out.push({ line: i + 1, reason });
    if (NET_IMPORT.test(line)) hit('network module in shipped code');
    if (PROCESS_IMPORT.test(line) && file !== PROCESS_FILE) hit(`child_process outside ${PROCESS_FILE}`);
    if (FETCH_CALL.test(line)) hit('fetch call in shipped code');
    if (WEBSOCKET.test(line)) hit('WebSocket in shipped code');
  });
  return out;
}

const WIN_USER_PATH = /[A-Za-z]:[\\/]Users[\\/]/i; // gate-allow
const UNIX_USER_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/; // gate-allow

export function checkPaths(text) {
  return scanLines(text, (line) =>
    WIN_USER_PATH.test(line) || UNIX_USER_PATH.test(line) ? ['absolute user path'] : [],
  );
}

const INVISIBLE = new RegExp(
  '[' +
    String.fromCharCode(0x00ad, 0xfeff) +
    String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) +
    String.fromCharCode(0x2060) + '-' + String.fromCharCode(0x2064) +
    String.fromCharCode(0xe000) + '-' + String.fromCharCode(0xf8ff) +
    ']',
  'g',
);

export function checkInvisible(text) {
  const out = [];
  text.replace(BOM, '').split(/\r?\n/).forEach((line, i) => {
    const seen = new Set(line.match(INVISIBLE) ?? []);
    for (const ch of seen) {
      const code = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      out.push({ line: i + 1, reason: `invisible character U+${code}` });
    }
  });
  return out;
}

// A binary has no lines. One pass over the whole thing, reported at line 0.
export function checkBinaryMarkers(buf, denylist) {
  const text = buf.toString('latin1');
  return denylist.filter((p) => p.re.test(text)).map((p) => ({ line: 0, reason: `denylist pattern "${p.raw}"` }));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Whatever is not on this list can carry a note from whoever made the file. It stays out.
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'sBIT', 'bKGD']);
const BLOCKED_IMAGE_EXT = new Set([
  'gif', 'webp', 'svg', 'svgz', 'ico', 'cur', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'apng', 'jxl', 'jp2',
]);

function pngProblems(buf) {
  const out = [];
  let p = PNG_SIGNATURE.length;
  let ended = false;
  while (p < buf.length) {
    if (p + 12 > buf.length) {
      out.push({ line: 0, reason: 'image malformed: truncated PNG' });
      return out;
    }
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8).replace(/[^A-Za-z]/g, '?');
    if (p + 12 + len > buf.length) {
      out.push({ line: 0, reason: 'image malformed: truncated PNG' });
      return out;
    }
    if (!PNG_CHUNKS.has(type)) out.push({ line: 0, reason: `image metadata chunk ${type}` });
    p += 12 + len;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (ended && p < buf.length) out.push({ line: 0, reason: 'image has trailing data after IEND' });
  if (!ended) out.push({ line: 0, reason: 'image malformed: no IEND' });
  return out;
}

const JFIF = Buffer.from('JFIF\0', 'latin1');
const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
const isRestart = (m) => m >= 0xd0 && m <= 0xd7;
// SOF0 to SOF15 are 0xC0 to 0xCF, minus DHT (C4), JPG (C8) and DAC (CC).
const isFrame = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpegProblems(buf) {
  const out = [];
  const bad = (reason) => out.push({ line: 0, reason });
  let p = 2;
  let ended = false;
  while (p < buf.length) {
    if (buf[p] !== 0xff) return [...out, { line: 0, reason: 'image malformed: stray bytes between segments' }];
    while (buf[p + 1] === 0xff) p++;
    const m = buf[p + 1];
    if (m === undefined) break;
    p += 2;
    if (m === 0xd9) {
      ended = true;
      if (p < buf.length) bad('image has trailing data after EOI');
      break;
    }
    if (m === 0x01 || isRestart(m)) continue;
    if (p + 2 > buf.length) break;
    const len = buf.readUInt16BE(p);
    if (len < 2 || p + len > buf.length) return [...out, { line: 0, reason: 'image malformed: truncated JPEG' }];
    if (m === 0xe0) {
      if (!buf.subarray(p + 2, p + 2 + JFIF.length).equals(JFIF)) bad('image metadata segment APP0');
    } else if (m > 0xe0 && m <= 0xef) {
      bad(`image metadata segment APP${m - 0xe0}`);
    } else if (m === 0xfe) {
      bad('image metadata segment COM');
    } else if (!(m === 0xdb || m === 0xc4 || m === 0xdd || m === 0xda || isFrame(m))) {
      bad(`image metadata segment ${hex(m)}`);
    }
    p += len;
    if (m === 0xda) {
      // Scan data. A stuffed FF00 or a restart is still pixels. Any other marker is a segment again.
      while (p < buf.length) {
        if (buf[p] !== 0xff) p++;
        else if (buf[p + 1] === 0 || isRestart(buf[p + 1])) p += 2;
        else if (buf[p + 1] === 0xff) p++;
        else break;
      }
    }
  }
  if (!ended && out.length === 0) bad('image malformed: no EOI');
  return out;
}

export function checkImageMetadata(file, buf) {
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toLowerCase() : '';
  if (BLOCKED_IMAGE_EXT.has(ext)) return [{ line: 0, reason: 'image format not allowed, use PNG or JPEG' }];
  const isPng = buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const isJpeg = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === 'png' && !isPng) return [{ line: 0, reason: 'image malformed: not a PNG' }];
  if ((ext === 'jpg' || ext === 'jpeg') && !isJpeg) return [{ line: 0, reason: 'image malformed: not a JPEG' }];
  if (isPng) return pngProblems(buf);
  if (isJpeg) return jpegProblems(buf);
  return [];
}

export const firstLine =(text) => text.replace(BOM, '').split(/\r?\n/, 1)[0];
export const isCanary = (text) => /"_canary"\s*:\s*true/.test(firstLine(text));
export const isSynthetic = (text) => /"_synthetic"\s*:\s*true/.test(firstLine(text));

export function checkFields(file, text) {
  if (!file.startsWith('src/') || file.endsWith('.dialect.mjs') || file.endsWith('.hookio.mjs')) return [];
  const out = [];
  for (const field of fieldNames) {
    const name = escapeRe(field);
    const pattern = new RegExp('([\'"`])' + name + '\\1|\\.\\s*' + name + '(?![\\w$])', 'gu');
    for (const match of text.matchAll(pattern)) {
      out.push({ line: text.slice(0, match.index).split(/\r?\n/u).length, reason: `session field ${field} outside a dialect` });
    }
  }
  return out;
}

export function checkFile({ file, text, denylist = [] }) {
  const found = [];
  const add = (check, list) => list.forEach((f) => found.push({ check, file, ...f }));
  const fixture = file.startsWith('test/fixtures/');
  add('dialect-fields', checkFields(file, text));

  add('em-dash', checkEmDash(text));
  add('denylist', checkDenylist(text, denylist));
  if (!fixture) add('invisible', checkInvisible(text));
  if (!(fixture && isCanary(text))) add('secrets', checkSecrets(text));
  add('provenance', checkPaths(text));
  if (NETWORK_DIRS.some((d) => file.startsWith(d))) add('no-network', checkNetwork(text, file));
  if (fixture && file.endsWith('.jsonl') && !isSynthetic(text)) {
    found.push({ check: 'provenance', file, line: 1, reason: 'fixture first line lacks "_synthetic": true' });
  }
  return found;
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

const nul = (out) => out.split('\0').filter(Boolean);

// Every commit reachable from HEAD, judged against the repo's own identity. Notes are history too.
export function checkHistory(root, denylist = []) {
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  // CI has no identity of its own. The workflow pins the one that counts.
  const pinned = /^(.+) <(.+)>$/.exec(process.env.GOLDFISHED_IDENTITY ?? '');
  const name = pinned ? pinned[1] : run(['config', 'user.name']).stdout.trim();
  const email = pinned ? pinned[2] : run(['config', 'user.email']).stdout.trim();
  if (!name || !email) return ['config git user.name or user.email is not set'];

  const out = [];
  if (run(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0) {
    const log = run(['log', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e']);
    if (log.status !== 0) throw new Error(`git log failed: ${log.stderr.trim()}`);
    for (const record of log.stdout.split('\x1e')) {
      const [sha, an, ae, cn, ce, ...rest] = record.replace(/^\n/, '').split('\0');
      if (!sha) continue;
      const short = sha.slice(0, 7);
      const message = rest.join('\0');
      const flag = (why) => out.push(`${short} ${why}`);
      if (an !== name || ae !== email) flag(`author ${an} <${ae}> is not the repo identity`);
      if (cn !== name || ce !== email) flag(`committer ${cn} <${ce}> is not the repo identity`);
      if (/^\s*co-authored-by:/im.test(message)) flag('message carries a co-author trailer'); // gate-allow
      if (/generated with/i.test(message)) flag('message carries a generated-by footer'); // gate-allow
      for (const p of denylist) if (p.re.test(message)) flag(`message matches denylist pattern "${p.raw}"`);
    }
  }
  const tags = run(['for-each-ref', 'refs/tags', '--format=%(refname:short)%00%(taggername)%00%(taggeremail)%00%(contents)%1e']);
  for (const record of tags.stdout.split('\x1e')) {
    const [tag, tn, te, ...rest] = record.replace(/^\n/, '').split('\0');
    if (!tag) continue;
    const message = rest.join('\0');
    const flag = (why) => out.push(`tag ${tag} ${why}`);
    if (tn && (tn !== name || te !== `<${email}>`)) flag(`tagger ${tn} ${te} is not the repo identity`);
    if (/^\s*co-authored-by:/im.test(message)) flag('message carries a co-author trailer'); // gate-allow
    if (/generated with/i.test(message)) flag('message carries a generated-by footer'); // gate-allow
    for (const p of denylist) if (p.re.test(message)) flag(`message matches denylist pattern "${p.raw}"`);
  }
  if (run(['for-each-ref', 'refs/notes']).stdout.trim()) out.push('notes: git notes are present');
  return out;
}

export function checkLabels(root) {
  const tag = git(['tag', '--list', 'labels-v*', '--sort=-version:refname'], root).trim().split(/\r?\n/)[0];
  if (!tag) return [];
  const r = spawnSync('git', ['diff', '--exit-code', tag, '--', 'test/labels'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(`label diff failed: ${r.stderr}`);
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', 'test/labels'], root).trim();
  return r.status === 0 && !dirty ? [] : [`test/labels differs from ${tag}`];
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = git(['rev-parse', '--show-toplevel'], here).trim();
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root).trim();
  const denylistPath = join(dirname(common), '.claude', 'denylist.txt');

  const tracked = nul(git(['ls-files', '-z'], root));
  const others = nul(git(['ls-files', '-z', '--others', '--exclude-standard'], root));
  const files = [...new Set([...tracked, ...others])].filter((f) => existsSync(join(root, f)) || isLink(root, f));
  const failures = [];
  const fail = (check, file, line, reason) => failures.push({ check, file, line, reason });

  let denylist = [];
  if (existsSync(denylistPath)) {
    denylist = parseDenylist(readFileSync(denylistPath, 'utf8'));
  } else {
    console.log(`WARN denylist: ${denylistPath} is missing, denylist scan skipped`);
  }

  const testFiles = files.filter((f) => f.startsWith('test/') && /\.(?:m?js|cjs)$/.test(f));
  if (testFiles.length === 0) {
    console.log('NOTE tests: no test files under test/, skipped');
  } else {
    const r = spawnSync(process.execPath, ['--import', './test/no-network.mjs', '--test'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) {
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      fail('tests', 'test/', 0, `node --test exited ${r.status}`);
    }
  }

  const modes = nul(git(['ls-files', '-s', '-z'], root)).map((e) => [e.split('\t')[0].split(' ')[0], e.split('\t')[1]]);
  for (const [mode, file] of modes) {
    if (mode === '120000') fail('provenance', file, 0, 'tracked symlink');
  }

  let scanned = 0;
  for (const file of files) {
    const full = join(root, file);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      if (!modes.some(([, f]) => f === file)) fail('provenance', file, 0, 'symlink');
      continue;
    }
    if (!st.isFile()) continue;
    const buf = readFileSync(full);
    scanned++;
    for (const f of checkImageMetadata(file, buf)) fail('image', file, f.line, f.reason);
    if (buf.includes(0)) {
      for (const f of checkBinaryMarkers(buf, denylist)) fail('binary', file, f.line, f.reason);
      continue;
    }
    for (const f of checkFile({ file, text: buf.toString('utf8'), denylist })) {
      fail(f.check, f.file, f.line, f.reason);
    }
  }

  for (const reason of checkHistory(root, denylist)) fail('history', '', 0, reason);
  for (const reason of checkLabels(root)) fail('labels', 'test/labels', 0, reason);

  for (const f of failures) {
    console.log(f.check === 'history' ? `FAIL history: ${f.reason}` : `FAIL ${f.check}: ${f.file}:${f.line} ${f.reason}`);
  }
  console.log(
    failures.length === 0
      ? `gate: ok, ${scanned} files scanned`
      : `gate: ${failures.length} failure${failures.length === 1 ? '' : 's'}, ${scanned} files scanned`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

function isLink(root, f) {
  try {
    return lstatSync(join(root, f)).isSymbolicLink();
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
