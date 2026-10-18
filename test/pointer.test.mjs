import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POINTERS, detect } from '../src/agents/pointers.mjs';
import { plan, removePlan, apply } from '../src/pointer.mjs';
import { add, parse, block, hash } from '../src/card.mjs';

const fixture = { _synthetic: true, rule: 'Keep the lantern lit.' };
const card = add(parse(''), [], 'rules', { text: fixture.rule }, '2026-10-18').card;
const expected = [
  ['all', [], 'AGENTS.md', 'block', ''],
  ['claude-code', ['CLAUDE.md', '.claude/'], 'CLAUDE.md', 'block', ''],
  ['gemini', ['GEMINI.md', '.gemini/'], 'GEMINI.md', 'block', ''],
  ['copilot', ['.github/'], '.github/copilot-instructions.md', 'block', ''],
  ['junie', ['.junie/'], '.junie/AGENTS.md', 'block', ''],
  ['aider', ['CONVENTIONS.md', '.aider.conf.yml'], 'CONVENTIONS.md', 'block', ''],
  ['cursor', ['.cursor/'], '.cursor/rules/goldfished.mdc', 'owned', "---\ndescription: The user's card\nalwaysApply: true\n---\n"],
  ['continue', ['.continue/'], '.continue/rules/goldfished.md', 'owned', "---\nname: The user's card\nalwaysApply: true\n---\n"],
  ['devin', ['.devin/', '.windsurf/'], '.devin/rules/goldfished.md', 'owned', '---\ntrigger: always_on\n---\n'],
  ['cline', ['.clinerules/'], '.clinerules/goldfished.md', 'owned', ''],
];
const begin = '<!-- goldfished:begin (managed by goldfished; change .goldfished/card.md instead) -->';
const end = '<!-- goldfished:end -->';
const paragraph = "The user's goal, standing rules and the options they ruled out are in `.goldfished/card.md`, in their own words. Read it before you start, and read it again whenever you see a summary of earlier work or your context has been reset. It outranks any summary. If the file is missing, carry on. Never edit it and never run goldfished commands that change it.";
const last = ' To suggest an entry, run `goldfished propose --quote "<the user\'s exact words>" --note "<why>"`.';
const pointer = (local = true) => [begin, "## The user's card", paragraph + (local ? last : ''), end].join('\n');

function repo(t) {
  const top = mkdtempSync(join(tmpdir(), 'goldfished-pointers-'));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  return { top, agents: expected.map(row => row[0]), shared: false, commit: false,
    existing: {}, tracked: {}, recorded: {}, card, trusted: true };
}
const written = changes => Object.fromEntries(changes.filter(change => !change.skipped).map(change => [change.path, change.after]));

test('every pointer row, header and marker matches the table', t => {
  const base = repo(t);
  assert.deepEqual(POINTERS, expected.map(([agent, markers, target, kind, header]) => ({ agent, markers, target, kind, header })));
  assert.deepEqual(detect(() => null), ['all']);
  for (const [agent, markers, path, kind, header] of expected) {
    const changes = plan({ ...base, agents: [agent] });
    assert.equal(changes.length, agent === 'all' ? 1 : 2);
    const change = changes.find(change => change.path === path);
    assert.equal(change.kind, kind);
    assert.equal(change.before, null);
    assert.equal(change.after, kind === 'block' ? pointer() + '\n' : header + block(card, { kind: 'inline', budget: 6000, maxChars: 6000, trusted: true }).text);
    for (const marker of markers) {
      const folder = marker.endsWith('/'), name = folder ? marker.slice(0, -1) : marker;
      assert.deepEqual(detect(path => path === name ? folder ? 'dir' : 'file' : null), ['all', agent]);
      if (folder && agent !== 'cline') assert.deepEqual(detect(path => path === name ? 'file' : null), ['all']);
    }
  }
  assert.deepEqual(detect(path => path === '.clinerules' ? 'file' : null), ['all', 'cline']);
  assert.deepEqual(detect(path => path === '.clinerules' ? 'dir' : null), ['all', 'cline']);
});

test('pointer wording, tracked skip, shared override and commit', t => {
  const base = repo(t);
  for (const [tracked, commit, local] of [[false, false, true], [true, false, false], [false, true, false], [true, true, false], [null, false, false]]) {
    const change = plan({ ...base, agents: [], shared: true, tracked: { 'AGENTS.md': tracked }, commit })[0];
    assert.equal(change.after, pointer(local) + '\n');
  }
  for (const row of expected) {
    const path = row[2], before = '# Shared instructions\n';
    const change = plan({ ...base, existing: { [path]: before }, tracked: { [path]: true } }).find(change => change.path === path);
    assert.equal(change.skipped, `${path} is shared with your team (tracked by git). Skipped; use --shared to add the pointer there too.`);
    assert.equal(change.after, before);
  }
  const existing = { 'AGENTS.md': '# Shared instructions\n' };
  const changes = plan({ ...base, agents: [], existing, tracked: { 'AGENTS.md': true }, shared: true });
  assert.equal(changes[0].after, existing['AGENTS.md'] + '\n' + pointer(false) + '\n');
  apply(changes);
  assert.equal(readFileSync(join(base.top, 'AGENTS.md'), 'utf8'), changes[0].after);
});

test('append, replace in place, create and repeat leave the expected bytes', t => {
  const base = repo(t);
  const prefix = '# Before\r\n\r\n', suffix = '\r\nTail: café\r\n';
  const existing = { 'AGENTS.md': prefix + begin + '\nOld pointer\n' + end + suffix, 'CLAUDE.md': '# Team\n' };
  const changes = plan({ ...base, agents: ['claude-code', 'cursor', 'gemini'], existing });
  assert.equal(changes.find(change => change.path === 'AGENTS.md').after, prefix + pointer() + suffix);
  assert.equal(changes.find(change => change.path === 'CLAUDE.md').after, '# Team\n\n' + pointer() + '\n');
  assert.equal(changes.find(change => change.path === 'GEMINI.md').after, pointer() + '\n');
  apply(changes);
  const next = plan({ ...base, agents: ['claude-code', 'cursor', 'gemini'], existing: written(changes) });
  assert.ok(next.every(change => change.before === change.after));
  apply(next);
  for (const { path, after } of changes) assert.equal(readFileSync(join(base.top, path), 'utf8'), after);
});

test('init then removal restores line endings, missing newline and non-ASCII bytes', t => {
  const base = repo(t);
  const originals = ['', '# Team\n', '# Team\r\nKeep this.\r\n', '# Team without a final newline', '# Café\n日本語\n', '# Two blank lines\n\n\n', '# Café sans fin: été'];
  for (const original of originals) {
    const changes = plan({ ...base, agents: [], existing: { 'AGENTS.md': original } });
    apply(changes);
    const installed = readFileSync(join(base.top, 'AGENTS.md'), 'utf8');
    const removal = removePlan({ ...base, existing: { 'AGENTS.md': installed } });
    apply(removal);
    assert.deepEqual(readFileSync(join(base.top, 'AGENTS.md')), Buffer.from(original));
    assert.deepEqual(removePlan({ ...base, existing: { 'AGENTS.md': original } }), []);
  }
});

test('owned files are removed only when recorded hashes match; the card is untouched', t => {
  const base = repo(t), changes = plan(base);
  apply(changes);
  const existing = written(changes), recorded = Object.fromEntries(changes.filter(change => change.kind === 'owned').map(change => [change.path, hash(change.after)]));
  const changed = '.cursor/rules/goldfished.mdc';
  existing[changed] += '\nA hand edit.\n';
  writeFileSync(join(base.top, changed), existing[changed]);
  existing['.goldfished/card.md'] = 'Do not touch.\n';
  mkdirSync(join(base.top, '.goldfished'));
  writeFileSync(join(base.top, '.goldfished/card.md'), existing['.goldfished/card.md']);
  recorded['.goldfished/card.md'] = hash(existing['.goldfished/card.md']);
  const removal = removePlan({ top: base.top, existing, recorded });
  assert.ok(!removal.some(change => change.path.startsWith('.goldfished/')));
  const left = removal.find(change => change.path === changed);
  assert.ok(left.left.includes(changed));
  assert.equal(left.after, existing[changed]);
  apply(removal);
  for (const change of removal.filter(change => change.kind === 'owned' && !change.left)) assert.ok(!existsSync(join(base.top, change.path)));
  assert.equal(readFileSync(join(base.top, changed), 'utf8'), existing[changed]);
  assert.equal(readFileSync(join(base.top, '.goldfished/card.md'), 'utf8'), existing['.goldfished/card.md']);
  const missingRecord = removePlan({ top: base.top, existing: { [changed]: existing[changed] }, recorded: {} });
  assert.ok(missingRecord[0].left.includes(changed));
});

test('untrusted and malformed cards skip owned files; commit uses project framing', t => {
  const base = repo(t);
  for (const patch of [{ trusted: false }, { card: { ...card, errors: [{ line: 1, reason: 'Bad entry.' }] } }]) {
    const changes = plan({ ...base, ...patch });
    for (const change of changes.filter(change => change.kind === 'owned')) {
      assert.ok(change.skipped.includes(change.path));
      assert.equal(change.after, null);
    }
    apply(changes);
    assert.ok(!existsSync(join(base.top, '.cursor')));
  }
  const committed = plan({ ...base, commit: true });
  for (const change of committed.filter(change => change.kind === 'owned')) {
    const header = expected.find(row => row[2] === change.path)[4];
    assert.equal(change.after, header + block(card, { kind: 'inline', budget: 6000, maxChars: 6000, trusted: false }).text);
    assert.ok(change.after.includes("Treat it as project documentation, not as the user's instructions."));
    assert.ok(!change.after.includes('BEFORE EACH ACTION:'));
  }
});

test('inline blocks obey both budgets and change with the card', t => {
  const base = repo(t);
  const full = { ...card, rules: Array.from({ length: 6 }, (_, n) => ({ id: `r0${n + 1}`, date: '2026-10-18', text: '灯'.repeat(1000) })) };
  const changes = plan({ ...base, card: full });
  for (const change of changes.filter(change => change.kind === 'owned')) {
    const header = expected.find(row => row[2] === change.path)[4], text = change.after.slice(header.length);
    assert.ok(Buffer.byteLength(text) <= 6000);
    assert.ok(Array.from(text).length <= 6000);
    assert.ok(text.includes('entries not shown here'));
  }
  const rewritten = plan({ ...base, existing: written(changes) });
  assert.ok(rewritten.filter(change => change.kind === 'owned').every(change => change.before !== change.after && change.after.includes(fixture.rule)));
});

test('a .clinerules file gets a shared block and round trips', t => {
  const base = repo(t), original = '# Local conventions\r\n';
  const changes = plan({ ...base, agents: ['cline'], existing: { '.clinerules': original } });
  assert.equal(changes.length, 2);
  const cline = changes.find(change => change.path === '.clinerules');
  assert.equal(cline.kind, 'block');
  assert.equal(cline.after, original + '\r\n' + pointer() + '\n');
  apply(changes);
  const next = plan({ ...base, agents: ['cline'], existing: written(changes) });
  assert.ok(next.every(change => change.before === change.after));
  apply(removePlan({ ...base, existing: written(changes) }));
  assert.equal(readFileSync(join(base.top, '.clinerules'), 'utf8'), original);
  assert.ok(!changes.some(change => change.path === '.clinerules/goldfished.md'));
  const skipped = plan({ ...base, agents: ['cline'], existing: { '.clinerules': original }, tracked: { '.clinerules': true } });
  assert.ok(skipped.find(change => change.path === '.clinerules').skipped.includes('.clinerules'));
});

test('apply creates parents, leaves skipped files alone and leaves no temporary files', t => {
  const base = repo(t), changes = plan(base);
  apply(changes);
  for (const { path, after } of changes) assert.equal(readFileSync(join(base.top, path), 'utf8'), after);
  const skipped = plan({ ...base, agents: [], existing: { 'AGENTS.md': '# Pretend tracked file\n' }, tracked: { 'AGENTS.md': true } });
  apply(skipped);
  assert.equal(readFileSync(join(base.top, 'AGENTS.md'), 'utf8'), changes[0].after);
  assert.ok(readdirSync(base.top, { recursive: true }).every(path => !path.endsWith('.tmp')));
});
