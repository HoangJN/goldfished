import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  checkBinaryMarkers,
  checkFile,
  checkHistory,
  checkHookGraph,
  checkLabels,
  checkPackage,
  checkImageMetadata,
  checkInvisible,
  parseDenylist,
} from '../scripts/gate.mjs';
import { fieldNames } from '../src/agents/claude-code.dialect.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'goldfished-gate-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const EM = String.fromCharCode(0x2014);

test('package: adding test to the files list fails in a temporary copy', () => {
  const root = mkdtempSync(join(scratch, 'package-'));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const entry of manifest.files) {
    mkdirSync(join(root, entry), { recursive: true });
    writeFileSync(join(root, entry, 'sample.mjs'), 'export {};\n');
  }
  for (const file of ['README.md', 'LICENSE']) writeFileSync(join(root, file), 'Sample\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  assert.deepEqual(checkPackage(root), []);
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'sample.test.mjs'), 'export {};\n');
  manifest.files.push('test');
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  assert.deepEqual(checkPackage(root), ['unexpected packed file: test/sample.test.mjs']);
});

test('hook keys belong only in hookio, including optional and bracket access', () => {
  for (const key of ['hookSpecificOutput', 'hookEventName', 'additionalContext', 'systemMessage', 'hook_event_name']) {
    for (const body of [`'${key}'`, `x.${key}`, `x?.\n${key}`, `x["${key}"]`, '`' + key + '`',
      `export const o = t => ({ ${key}: t });`, `({ ${key} : t })`, `const { ${key} } = o;`, `const { ${key} = 1 } = o;`, `const { ${key}: other } = o;`, `const { x, ${key} } = o;`]) {
      for (const file of ['src/a.mjs', 'src/a.dialect.mjs']) assert.ok(run(file, body).some(f => f.check === 'hook-keys'));
      assert.equal(run('src/a.hookio.mjs', body).length, 0);
    }
    assert.equal(run('src/a.mjs', `x.${key}Suffix`).length, 0);
    for (const body of [`// ${key}\n/* { ${key}: text } */`, `"text { ${key}: text }"`, `"prefix${key}Suffix"`, `({ ${key}Suffix: 1 })`, `const { prefix${key} } = o;`]) assert.equal(run('src/a.mjs', body).length, 0);
    assert.ok(run('src/a.mjs', `'${key}'; // gate-allow`).some(f => f.check === 'hook-keys'));
  }
  for (const id of ['claude-code', 'codex']) assert.deepEqual(run(`src/agents/${id}.hookio.mjs`, readFileSync(`src/agents/${id}.hookio.mjs`, 'utf8')), []);
});

test('T11 hook imports are followed through static, dynamic and re-export edges', () => {
  const root = mkdtempSync(join(scratch, 'graph-'));
  mkdirSync(join(root, 'src/agents'), { recursive: true });
  for (const target of ['agents/index.mjs', 'agents/claude-code.mjs', 'agents/codex.mjs', 'agents/x.dialect.mjs', 'fold.mjs', 'grade.mjs', 'stats.mjs']) {
    writeFileSync(join(root, 'src/hook.mjs'), "import './middle.mjs';");
    writeFileSync(join(root, 'src/middle.mjs'), `export * from './last.mjs';`);
    for (const edge of [`import './${target}';`, `import {x} from './${target}';`, `await import('./${target}');`, 'await import(`./' + target + '`);', `export * from './${target}';`,
      `import {x}from './${target}';`, `import{x}from'./${target}';`, `export*from './${target}';`, `import*as f from'./${target}'`]) {
      writeFileSync(join(root, 'src/last.mjs'), edge);
      assert.deepEqual(checkHookGraph(root).map(f => f.file), ['src/' + target]);
    }
  }
  writeFileSync(join(root, 'src/last.mjs'), "import './hook.mjs'; import 'node:fs';");
  assert.deepEqual(checkHookGraph(root), []);
  assert.deepEqual(checkHookGraph(process.cwd()), []);
});
const ANT_KEY = ['sk', 'ant', 'x'.repeat(12)].join('-');

function run(file, body, denylist = []) {
  const path = join(scratch, `${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(path, body);
  return checkFile({ file, text: readFileSync(path, 'utf8'), denylist });
}

test('dialect fields planted in source fail in quoted strings and property accesses', () => {
  const dir = join(scratch, 'src');
  mkdirSync(dir);
  const planted = join(dir, 'planted.mjs');
  for (const field of fieldNames) {
    for (const body of [`const key = '${field}';`, `record.${field};`, `record?. ${field};`, `record.\n ${field};`,
      `record["${field}"];`, 'const key = `' + field + '`;']) {
      writeFileSync(planted, body);
      const found = checkFile({ file: 'src/agents/planted.mjs', text: readFileSync(planted, 'utf8') });
      assert.ok(found.some(f => f.check === 'dialect-fields'), body);
      assert.equal(run('src/agents/planted.dialect.mjs', body).length, 0);
      assert.equal(run('test/planted.test.mjs', body).length, 0);
    }
  }
  assert.ok(run('src/agents/planted.mjs', "record.uuid; // gate-allow").some(f => f.check === 'dialect-fields'));
  assert.equal(run('src/agents/planted.mjs', "record.uuidSuffix; const key = 'uuidSuffix';").length, 0);
  for (const field of fieldNames) {
    if (/[_A-Z]/u.test(field)) {
      for (const body of [`const key = '${field}';`, `record.${field};`, `record?. ${field};`, `record.\n ${field};`,
        `record["${field}"];`, 'const key = `' + field + '`;']) assert.ok(run('src/planted.mjs', body).some(f => f.check === 'dialect-fields'), body);
    } else assert.equal(run('src/planted.mjs', `record.${field};`).length, 0);
  }
});

test('plain-word fields are checked in adapters, not other source files', () => {
  for (const field of ['message', 'text', 'type', 'role']) {
    for (const body of [`record.${field}`, `record?.${field}`, `record['${field}']`]) {
      assert.ok(run('src/agents/x.mjs', body).some(f => f.check === 'dialect-fields'), body);
      assert.deepEqual(run('src/report.mjs', body), [], body);
    }
  }
});

test('distinctive session fields are checked outside adapters too', () => {
  for (const field of ['isCompactSummary', 'compact_metadata', 'preTokens', '_synthetic']) {
    for (const body of [`record.${field}`, `record?.\n${field}`, `record['${field}']`]) {
      for (const file of ['src/report.mjs', 'src/agents/x.mjs']) assert.ok(run(file, body).some(f => f.check === 'dialect-fields'), `${file}: ${body}`);
    }
  }
});

test('spread dots are not field accesses, including distinctive names', () => {
  for (const file of ['src/report.mjs', 'src/agents/x.mjs']) {
    for (const field of ['text', 'message', 'isCompactSummary', '_synthetic']) {
      for (const body of [`[...${field}]`, `[... ${field}]`, `({...${field}})`]) assert.deepEqual(run(file, body), [], `${file}: ${body}`);
      assert.ok(run(file, `[...record].isCompactSummary`).some(f => f.check === 'dialect-fields'));
    }
  }
});

test('a session field name is fine in a hookio file and still fails in any other source file', () => {
  const body = "const key = 'cwd';";
  assert.equal(run('src/agents/x.hookio.mjs', body).length, 0);
  assert.ok(run('src/agents/x.mjs', body).some(f => f.check === 'dialect-fields'));
});

test('the real source tree keeps dialect fields inside dialect files', () => {
  const root = new URL('../src/', import.meta.url);
  for (const relative of readdirSync(root, { recursive: true }).filter(file => file.endsWith('.mjs'))) {
    const name = relative.replaceAll('\\', '/'), file = 'src/' + name;
    const found = checkFile({ file, text: readFileSync(new URL(name, root), 'utf8') });
    assert.deepEqual(found.filter(f => f.check === 'dialect-fields'), [], file);
  }
});

test('an em-dash is caught, with its line number', () => {
  const found = run('notes.md', `fine\nbroken ${EM} here\n`);
  assert.deepEqual(found.map((f) => [f.check, f.line]), [['em-dash', 2]]);
});

test('a secret shape is caught', () => {
  const found = run('config.json', `{"key": "${ANT_KEY}"}\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].check, 'secrets');
});

test('a long mixed run is caught, a long plain word is not', () => {
  assert.equal(run('a.txt', `${'ab12'.repeat(8)}\n`).length, 1);
  assert.equal(run('a.txt', `${'abcd'.repeat(9)}\n`).length, 0);
});

test('the allow marker exempts its own line only', () => {
  const found = run('a.txt', `${ANT_KEY} gate-allow\n${ANT_KEY}\nbroken ${EM} gate-allow\n`);
  assert.deepEqual(found.map((f) => f.line), [2]);
});

test('a network import is caught in src, bin and hooks, and nowhere else', () => {
  const body = "import http from 'node:http';\nconst r = require('child_process');\nawait fetch('x');\nnew WebSocket('y');\n";
  for (const file of ['src/a.mjs', 'bin/a.mjs', 'hooks/run.mjs']) {
    assert.deepEqual(run(file, body).map((f) => f.line), [1, 2, 3, 4], file);
  }
  assert.equal(run('scripts/a.mjs', body).length, 0);
  assert.equal(run('test/a.test.mjs', body).length, 0);
});

test('every network module is caught, prefixed or not', () => {
  for (const mod of ['https', 'http2', 'net', 'dns/promises', 'tls', 'dgram', 'worker_threads', 'node:http2']) {
    assert.equal(run('src/a.mjs', `import x from '${mod}';\n`).length, 1, mod);
  }
});

test('child_process is allowed in src/git.mjs alone', () => {
  const line = "import { spawnSync } from 'node:child_process';\n";
  assert.equal(run('src/git.mjs', line).length, 0);
  assert.equal(run('src/git2.mjs', line).length, 1);
  assert.equal(run('src/git.mjs', "import http from 'node:http';\n").length, 1);
});

test('the marker does not switch off the network check', () => {
  assert.equal(run('src/a.mjs', "await fetch('x'); // gate-allow\n").length, 1);
});

test('the test preload refuses the network', () => {
  const probe = (code) =>
    spawnSync(process.execPath, ['--import', new URL('./no-network.mjs', import.meta.url).href, '--input-type=module', '-e', code], {
      encoding: 'utf8',
    });
  const cases = [
    "await fetch('http://127.0.0.1:9')",
    "(await import('node:net')).connect(9, '127.0.0.1')",
    "await (await import('node:dns')).promises.lookup('example.com')",
    "(await import('node:http')).get('http://127.0.0.1:9')",
    "new WebSocket('ws://127.0.0.1:9')",
  ];
  for (const code of cases) {
    const r = probe(code);
    assert.notEqual(r.status, 0, code);
    assert.match(r.stderr, /network is off in tests/, code);
  }
});

test('denylist matches any case, and short all-caps patterns need a word boundary', () => {
  const list = parseDenylist('# comment\nBadWord\nABC\n');
  assert.equal(run('a.md', 'a BADWORD appears\n', list).length, 1);
  assert.equal(run('a.md', 'abc stands alone\n', list).length, 1);
  assert.equal(run('a.md', 'abcdef does not\n', list).length, 0);
  assert.equal(run('a.md', 'BadWord gate-allow\n', list).length, 0);
});

test('absolute user paths are caught', () => {
  const win = ['C:', 'Users', 'someone'].join('\\');
  assert.equal(run('a.md', `see ${win}\\file\n`).length, 1);
  assert.equal(run('a.md', 'see /home/someone/file\n').length, 1); // gate-allow
  assert.equal(run('a.md', 'see ./relative/file\n').length, 0);
});

test('fixtures must say they are synthetic, canaries skip the secret scan', () => {
  const key = `{"_synthetic": true, "_canary": true, "text": "${ANT_KEY}"}\n`;
  assert.equal(run('test/fixtures/c.jsonl', key).length, 0);
  assert.deepEqual(run('src/agents/c.jsonl', key).map(f => f.check), ['dialect-fields', 'dialect-fields', 'secrets']);
  assert.equal(run('test/fixtures/d.jsonl', '{"text": "plain"}\n').length, 1);
  assert.equal(run('test/fixtures/e.jsonl', '{"_synthetic": true}\n').length, 0);
});

const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunk = (type, data = Buffer.alloc(0)) =>
  Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (...chunks) => Buffer.concat([PNG_SIG, ...chunks]);
const cleanPng = () => [
  chunk('IHDR', Buffer.alloc(13)),
  chunk('pHYs', Buffer.alloc(9)),
  chunk('IDAT', Buffer.from([1, 2, 3])),
  chunk('IEND'),
];

const seg = (marker, body = Buffer.alloc(0)) =>
  Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const jfif = () => seg(0xe0, Buffer.concat([Buffer.from('JFIF', 'latin1'), Buffer.alloc(10)]));
const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
const jpeg = (...parts) => Buffer.concat([SOI, ...parts]);
const cleanJpeg = () => [
  jfif(),
  seg(0xdb, Buffer.alloc(65)),
  seg(0xc0, Buffer.alloc(15)),
  seg(0xc4, Buffer.alloc(20)),
  seg(0xda, Buffer.alloc(10)),
  scan,
];

const reasons = (found) => found.map((f) => f.reason);

test('a PNG with only pixel and display chunks is clean', () => {
  assert.deepEqual(checkImageMetadata('a.png', png(...cleanPng())), []);
});

test('a PNG with any other chunk is named and refused', () => {
  const [ihdr, ...rest] = cleanPng();
  for (const name of ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'caBX', 'iCCP', 'tIME', 'zzZz']) {
    const found = checkImageMetadata('a.png', png(ihdr, chunk(name, Buffer.from('x')), ...rest));
    assert.deepEqual(reasons(found), [`image metadata chunk ${name}`]);
  }
});

test('a PNG with bytes after IEND, or cut short, is refused', () => {
  const tail = Buffer.concat([png(...cleanPng()), Buffer.from('tail')]);
  assert.deepEqual(reasons(checkImageMetadata('a.png', tail)), ['image has trailing data after IEND']);
  const cut = png(...cleanPng()).subarray(0, 30);
  assert.deepEqual(reasons(checkImageMetadata('a.png', cut)), ['image malformed: truncated PNG']);
});

test('a JPEG with JFIF, tables, a frame and a scan is clean, restart markers included', () => {
  assert.deepEqual(checkImageMetadata('a.jpg', jpeg(...cleanJpeg(), EOI)), []);
});

test('a JPEG carrying APPn or COM is named and refused', () => {
  const [, ...rest] = cleanJpeg();
  const cases = [
    [seg(0xe1, Buffer.from('Exif\0\0')), 'APP1'],
    [seg(0xe2, Buffer.from('ICC_PROFILE\0')), 'APP2'],
    [seg(0xeb, Buffer.from('JUMBF')), 'APP11'],
    [seg(0xed, Buffer.from('Photoshop 3.0\0')), 'APP13'],
    [seg(0xe0, Buffer.from('JFXX\0')), 'APP0'],
    [seg(0xfe, Buffer.from('a comment')), 'COM'],
  ];
  for (const [bad, name] of cases) {
    const found = checkImageMetadata('a.jpeg', jpeg(jfif(), bad, ...rest, EOI));
    assert.deepEqual(reasons(found), [`image metadata segment ${name}`]);
  }
});

test('a JPEG hiding a segment after the scan, or bytes after EOI, is refused', () => {
  const late = jpeg(...cleanJpeg(), seg(0xe1, Buffer.from('Exif\0\0')), seg(0xda, Buffer.alloc(10)), scan, EOI);
  assert.deepEqual(reasons(checkImageMetadata('a.jpg', late)), ['image metadata segment APP1']);
  const tail = Buffer.concat([jpeg(...cleanJpeg(), EOI), Buffer.from('tail')]);
  assert.deepEqual(reasons(checkImageMetadata('a.jpg', tail)), ['image has trailing data after EOI']);
});

test('only PNG and JPEG images pass, by extension and by shape', () => {
  for (const name of ['a.gif', 'a.webp', 'a.svg', 'a.ico', 'A.GIF', 'dir/b.tiff']) {
    assert.deepEqual(reasons(checkImageMetadata(name, Buffer.from('xx'))), ['image format not allowed, use PNG or JPEG']);
  }
  assert.deepEqual(reasons(checkImageMetadata('a.png', Buffer.from('plain'))), ['image malformed: not a PNG']);
  assert.deepEqual(reasons(checkImageMetadata('a.jpg', Buffer.from('plain'))), ['image malformed: not a JPEG']);
  const renamed = png(chunk('IHDR', Buffer.alloc(13)), chunk('tEXt'), chunk('IEND'));
  assert.deepEqual(reasons(checkImageMetadata('renamed.bin', renamed)), ['image metadata chunk tEXt']);
  assert.deepEqual(checkImageMetadata('notes.pdf', Buffer.from('%PDF-1.7')), []);
});

test('a denylist pattern inside a binary is caught at line 0, a clean binary is not', () => {
  const list = parseDenylist('BadWord\n');
  const dirty = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from('/Producer (badword 1.0)'), Buffer.from([0, 9])]);
  assert.deepEqual(checkBinaryMarkers(dirty, list), [{ line: 0, reason: 'denylist pattern "BadWord"' }]);
  assert.deepEqual(checkBinaryMarkers(Buffer.from([0, 1, 2, 255, 65, 66]), list), []);
});

test('invisible characters are caught, a leading BOM is not', () => {
  const zw = String.fromCharCode(0x200b);
  const bom = String.fromCharCode(0xfeff);
  assert.deepEqual(checkInvisible(`fine\nsplit${zw}word\n`), [{ line: 2, reason: 'invisible character U+200B' }]);
  assert.deepEqual(checkInvisible(`${bom}starts with a BOM\n`), []);
  assert.deepEqual(checkInvisible(`line\nmid${bom}file\n`), [{ line: 2, reason: 'invisible character U+FEFF' }]);
  for (const code of [0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x00ad, 0xe000, 0xf8ff]) {
    assert.equal(checkInvisible(`a${String.fromCharCode(code)}b`).length, 1, code.toString(16));
  }
  assert.deepEqual(checkInvisible(`caf${String.fromCharCode(0xe9)} and a plain space\n`), []);
});

test('fixtures may carry invisible characters, other files may not', () => {
  const bom = String.fromCharCode(0xfeff);
  const body = `{"_synthetic": true, "t": "a${bom}b"}\n`;
  assert.equal(checkFile({ file: 'test/fixtures/f.jsonl', text: body }).length, 0);
  const found = checkFile({ file: 'src/f.jsonl', text: body });
  assert.deepEqual(found.map((f) => f.check), ['dialect-fields', 'invisible']);
});

function git(dir, env, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function tempRepo() {
  const dir = mkdtempSync(join(scratch, 'repo-'));
  git(dir, {}, 'init', '-q');
  git(dir, {}, 'config', 'user.name', 'Test Person');
  git(dir, {}, 'config', 'user.email', 'test@example.invalid');
  git(dir, {}, 'config', 'commit.gpgsign', 'false');
  git(dir, {}, 'config', 'core.hooksPath', join(dir, 'no-hooks'));
  return dir;
}

const commit = (dir, ...more) => git(dir, {}, 'commit', '-q', '--allow-empty', ...more);

test('labels: no tag passes, a sealed change fails, the newest version becomes the baseline', () => {
  const dir = tempRepo(), folder = join(dir, 'test', 'labels');
  assert.deepEqual(checkLabels(dir), []);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'dev.jsonl');
  writeFileSync(file, '{"id":"one","label":"kept","_synthetic":true}\n');
  assert.deepEqual(checkLabels(dir), []);
  git(dir, {}, 'add', 'test/labels');
  commit(dir, '-m', 'Seal labels');
  git(dir, {}, 'tag', 'labels-v1');
  assert.deepEqual(checkLabels(dir), []);
  const added = join(folder, 'extra.jsonl');
  writeFileSync(added, '{"id":"two","label":"gone","_synthetic":true}\n');
  assert.deepEqual(checkLabels(dir), ['test/labels differs from labels-v1']);
  git(dir, {}, 'add', 'test/labels');
  assert.equal(checkLabels(dir).length, 1);
  rmSync(added);
  git(dir, {}, 'add', '--all', 'test/labels');
  assert.deepEqual(checkLabels(dir), []);
  writeFileSync(file, '{"id":"one","label":"gone","_synthetic":true}\n');
  assert.deepEqual(checkLabels(dir), ['test/labels differs from labels-v1']);
  git(dir, {}, 'add', 'test/labels');
  assert.equal(checkLabels(dir).length, 1);
  commit(dir, '-m', 'Seal new labels');
  git(dir, {}, 'tag', 'labels-v2');
  assert.deepEqual(checkLabels(dir), []);
  writeFileSync(file, '{"id":"one","label":"reworded","_synthetic":true}\n');
  git(dir, {}, 'add', 'test/labels');
  commit(dir, '-m', 'Seal tenth labels');
  git(dir, {}, 'tag', 'labels-v10');
  assert.deepEqual(checkLabels(dir), []);
  rmSync(file);
  assert.deepEqual(checkLabels(dir), ['test/labels differs from labels-v10']);
});

test('history: an empty repo and a clean commit both pass', () => {
  const dir = tempRepo();
  assert.deepEqual(checkHistory(dir), []);
  commit(dir, '-m', 'Add the thing');
  assert.deepEqual(checkHistory(dir, parseDenylist('BadWord\n')), []);
});

test('history: a trailer or footer in a message is refused, with the short sha', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Add the thing');
  const trailer = 'Co-Authored-By: Someone <s@example.invalid>'; // gate-allow
  commit(dir, '-m', 'Second', '-m', trailer);
  const footer = 'Generated with a tool'; // gate-allow
  commit(dir, '-m', 'Third', '-m', footer);
  const found = checkHistory(dir);
  assert.equal(found.length, 2);
  assert.match(found[0], /^[0-9a-f]{7} message carries a generated-by footer$/);
  assert.match(found[1], /^[0-9a-f]{7} message carries a co-author trailer$/);
});

test('history: a denylist pattern in a message is refused', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Mentions BADWORD in passing');
  const found = checkHistory(dir, parseDenylist('BadWord\n'));
  assert.equal(found.length, 1);
  assert.match(found[0], /message matches denylist pattern "BadWord"$/);
});

test('history: a different author or committer is refused', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Other author', '--author', 'Other <o@example.invalid>');
  const other = { GIT_COMMITTER_NAME: 'Other', GIT_COMMITTER_EMAIL: 'o@example.invalid' };
  git(dir, other, 'commit', '-q', '--allow-empty', '-m', 'Other committer');
  const found = checkHistory(dir);
  assert.equal(found.length, 2);
  assert.match(found[0], /committer Other <o@example.invalid> is not the repo identity$/);
  assert.match(found[1], /author Other <o@example.invalid> is not the repo identity$/);
});

test('history: git notes are refused', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Add the thing');
  git(dir, {}, 'notes', 'add', '-m', 'a note');
  assert.deepEqual(checkHistory(dir), ['notes: git notes are present']);
});

test('history: no identity configured is refused', () => {
  const dir = tempRepo();
  git(dir, {}, 'config', '--unset', 'user.name');
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'];
  const saved = keys.map((k) => process.env[k]);
  keys.forEach((k) => (process.env[k] = join(scratch, 'no-config')));
  try {
    assert.deepEqual(checkHistory(dir), ['config git user.name or user.email is not set']);
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
});

test('history: a tag carrying a trailer, a denylist word or another tagger is refused', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Add the thing');
  git(dir, {}, 'tag', '-a', 'v1', '-m', 'Release', '-m', 'Co-Authored-By: Someone <s@example.invalid>'); // gate-allow
  git(dir, {}, 'tag', '-a', 'v2', '-m', 'Mentions BADWORD');
  const other = { GIT_COMMITTER_NAME: 'Other', GIT_COMMITTER_EMAIL: 'o@example.invalid' };
  git(dir, other, 'tag', '-a', 'v3', '-m', 'Fine words');
  git(dir, {}, 'tag', 'v4');
  const found = checkHistory(dir, parseDenylist('BadWord\n'));
  assert.deepEqual(found, [
    'tag v1 message carries a co-author trailer',
    'tag v2 message matches denylist pattern "BadWord"',
    'tag v3 tagger Other <o@example.invalid> is not the repo identity',
  ]);
});

test('history: notes under any ref are refused', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Add the thing');
  git(dir, {}, 'notes', '--ref', 'review', 'add', '-m', 'a note');
  assert.deepEqual(checkHistory(dir), ['notes: git notes are present']);
});

test('history: a pinned identity stands in for git config', () => {
  const dir = tempRepo();
  commit(dir, '-m', 'Add the thing');
  process.env.GOLDFISHED_IDENTITY = 'Someone Else <else@example.invalid>';
  try {
    assert.equal(checkHistory(dir).length, 2);
    process.env.GOLDFISHED_IDENTITY = 'Test Person <test@example.invalid>';
    assert.deepEqual(checkHistory(dir), []);
  } finally {
    delete process.env.GOLDFISHED_IDENTITY;
  }
});
