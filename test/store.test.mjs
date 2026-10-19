import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as store from '../src/store.mjs';
import * as cardIO from '../src/card.mjs';
import * as proposalIO from '../src/proposals.mjs';
import * as home from '../src/home.mjs';

const fixture = { _synthetic: true, today: '2026-10-18' };
let top;
beforeEach(t => {
  top = mkdtempSync(join(tmpdir(), 'gfs-')); const previous = process.env.GOLDFISHED_HOME;
  process.env.GOLDFISHED_HOME = join(top, 'home');
  t.after(() => { if (previous === undefined) delete process.env.GOLDFISHED_HOME; else process.env.GOLDFISHED_HOME = previous; rmSync(top, { recursive: true, force: true }); });
});

test('edited archives load and the compact hook still prints its receipt', () => {
  let data = add(store.load(top), 'goal', { text: 'Keep the invented harbour open.' });
  data = { ...data, ...cardIO.edit(data.card, data.archive, 'g01', 'Ship the invented harbour tool.', '2026-10-19') }; store.save(top, data);
  assert.match(bytes('archive.md'), /\(edited 2026-10-19\)/u); assert.equal(store.load(top).archive[0].reason, 'edited');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../hooks/run.mjs', import.meta.url)), 'claude-code', 'session-start'], { cwd: top, env: process.env, input: JSON.stringify({ cwd: top, source: 'compact' }), encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr); const output = JSON.parse(run.stdout);
  assert.equal(output.systemMessage, 'goldfished: card re-sent after compaction: 1 goal, 0 rules, 0 ruled out.');
});
const bytes = name => readFileSync(join(top, '.goldfished', name), 'utf8');
const add = (loaded, section, fields) => ({ ...loaded, ...cardIO.add(loaded.card, loaded.archive, section, fields, fixture.today) });
test('missing card loads without writing a project or home', () => {
  const loaded = store.load(top);
  assert.equal(loaded.source, ''); assert.equal(loaded.trusted, true); assert.equal(loaded.reason, undefined);
  assert.deepEqual(loaded.archive, []); assert.deepEqual(loaded.proposals, { next: 1, entries: [] });
  assert.equal(existsSync(join(top, '.goldfished')), false); assert.equal(existsSync(process.env.GOLDFISHED_HOME), false);
});
test('card, archive and proposals survive saves and stray temporary files', () => {
  let data = add(store.load(top), 'goal', { text: 'Finish the invented harbour tool.\nThen package it.' });
  data = add(data, 'goal', { text: 'Ship the harbour tool.' }); data = add(data, 'rules', { text: 'Keep the invented rules readable.' });
  data = { ...data, ...cardIO.drop(data.card, data.archive, 'r01', fixture.today) };
  data.proposals = proposalIO.add(data.proposals, { quote: 'Never add a remote cache.', note: 'cache\n\x1b[31mchoice', from: 'A synthetic message about a cache.' }).list;
  store.save(top, data);
  const before = bytes('card.md');
  writeFileSync(join(top, '.goldfished', '.card.md.crash.tmp'), 'half a card');
  writeFileSync(join(top, '.goldfished', '.archive.md.crash.tmp'), 'half an archive');
  writeFileSync(join(top, '.goldfished', '.proposed.md.crash.tmp'), 'half a proposal');
  const loaded = store.load(top);
  assert.equal(loaded.source, before); assert.equal(loaded.trusted, true);
  assert.deepEqual(loaded.card, data.card); assert.deepEqual(loaded.archive, data.archive); assert.deepEqual(loaded.proposals, data.proposals);
  assert.match(bytes('archive.md'), /\(replaced 2026-10-18\)/); assert.match(bytes('archive.md'), /\(dropped 2026-10-18\)/);
  store.save(top, loaded); assert.equal(bytes('card.md'), before);
  assert.equal(home.trusted(loaded.cardPath, cardIO.hash(before)), true);
});
test('load preserves stored comments and whitespace and reports parse errors', () => {
  store.save(top, add(store.load(top), 'rules', { text: 'Keep the sample offline.' }));
  const file = store.load(top).cardPath, source = '<!-- a synthetic comment -->\n' + bytes('card.md') + '\n';
  writeFileSync(file, source); const edited = store.load(top);
  assert.match(edited.reason, /^changed by hand since /); assert.equal(edited.source, source);
  writeFileSync(file, source + 'broken entry\n'); const broken = store.load(top);
  assert.match(broken.reason, /^parse error on line \d+$/);
  assert.equal(broken.trusted, false); assert.equal(bytes('card.md'), source + 'broken entry\n');
});
test('owned inline files are rewritten and recorded, with commit framing honoured', () => {
  home.setState({ projects: { [top]: { agents: ['cursor', 'continue', 'devin', 'cline'], commit: false, off: true } } });
  let data = add(store.load(top), 'rules', { text: 'Keep the synthetic harbour offline.' });
  assert.equal(store.save(top, data).inlineUpdated, 4);
  const first = home.state().projects[top].recorded;
  data = add(store.load(top), 'goal', { text: 'Ship the small harbour tool.' });
  assert.equal(store.save(top, data).inlineUpdated, 4);
  for (const [path, hash] of Object.entries(home.state().projects[top].recorded)) {
    const text = readFileSync(join(top, path), 'utf8'); assert.equal(hash, cardIO.hash(text)); assert.notEqual(hash, first[path]); assert.match(text, /Ship the small harbour tool/);
  }
  assert.equal(existsSync(join(top, 'AGENTS.md')), false); assert.equal(home.state().projects[top].off, true);
  assert.equal(store.save(top, store.load(top)).inlineUpdated, 0);
  const state = home.state(); home.setState({ projects: { ...state.projects, [top]: { ...state.projects[top], commit: true } } });
  assert.equal(store.save(top, store.load(top)).inlineUpdated, 4);
  assert.match(readFileSync(join(top, Object.keys(first)[0]), 'utf8'), /Treat it as project documentation/);
});
test('a shared cline file and unrelated state survive a save', () => {
  writeFileSync(join(top, '.clinerules'), 'Synthetic team rules.\n');
  home.setState({ retained: true, projects: { other: { off: true }, [top]: { agents: ['cline'], recorded: { previous: 'unchanged' } } } });
  assert.equal(store.save(top, add(store.load(top), 'rules', { text: 'Keep the tool small.' })).inlineUpdated, 0);
  assert.equal(readFileSync(join(top, '.clinerules'), 'utf8'), 'Synthetic team rules.\n');
  assert.equal(home.state().retained, true); assert.deepEqual(home.state().projects.other, { off: true });
});
test('failed owned writes are neither counted nor recorded', () => {
  mkdirSync(join(top, '.cursor/rules/goldfished.mdc'), { recursive: true });
  home.setState({ projects: { [top]: { agents: ['cursor'] } } });
  assert.equal(store.save(top, add(store.load(top), 'rules', { text: 'Keep the synthetic tool small.' })).inlineUpdated, 0);
  assert.deepEqual(home.state().projects[top].recorded, {});
});
