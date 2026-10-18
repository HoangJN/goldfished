#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const NET_IMPORT = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(?:node:)?(?:http|https|net|dns|tls|child_process)(?:\/[^'"]*)?\1/; // gate-allow
const FETCH_CALL = /\bfetch\s*\(/; // gate-allow

export function checkNetwork(text) {
  return scanLines(text, (line) => {
    const hits = [];
    if (NET_IMPORT.test(line)) hits.push('network or process module in src/');
    if (FETCH_CALL.test(line)) hits.push('fetch call in src/');
    return hits;
  });
}

const WIN_USER_PATH = /[A-Za-z]:[\\/]Users[\\/]/i; // gate-allow
const UNIX_USER_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/; // gate-allow

export function checkPaths(text) {
  return scanLines(text, (line) =>
    WIN_USER_PATH.test(line) || UNIX_USER_PATH.test(line) ? ['absolute user path'] : [],
  );
}

export const firstLine = (text) => text.replace(BOM, '').split(/\r?\n/, 1)[0];
export const isCanary = (text) => /"_canary"\s*:\s*true/.test(firstLine(text));
export const isSynthetic = (text) => /"_synthetic"\s*:\s*true/.test(firstLine(text));

export function checkFile({ file, text, denylist = [] }) {
  const found = [];
  const add = (check, list) => list.forEach((f) => found.push({ check, file, ...f }));
  const fixture = file.startsWith('test/fixtures/');

  add('em-dash', checkEmDash(text));
  add('denylist', checkDenylist(text, denylist));
  if (!(fixture && isCanary(text))) add('secrets', checkSecrets(text));
  add('provenance', checkPaths(text));
  if (file.startsWith('src/')) add('no-network', checkNetwork(text));
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
    const r = spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
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
    if (buf.includes(0)) continue;
    scanned++;
    for (const f of checkFile({ file, text: buf.toString('utf8'), denylist })) {
      fail(f.check, f.file, f.line, f.reason);
    }
  }

  for (const f of failures) console.log(`FAIL ${f.check}: ${f.file}:${f.line} ${f.reason}`);
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
