process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import claudeCode from '../src/agents/claude-code.mjs';
import { foldSession } from '../src/fold.mjs';
import * as grader from '../src/grade.mjs';
import { mask } from '../src/mask.mjs';
import { mulberry32 } from '../src/prng.mjs';
import { render } from '../scripts/gen-long.mjs';
import { matchSnapshot } from './snapshot.mjs';
const modules = Object.fromEntries(await Promise.all(['retro', 'card', 'init', 'misc', 'probe'].map(async n => [n, (await import(`../src/cli/${n}.mjs`)).commands]))), { retro, card } = modules;
const sandbox = mkdtempSync(join(tmpdir(), 'gfr-sandbox-'));
Object.assign(process.env, { HOME: sandbox, USERPROFILE: sandbox, CLAUDE_CONFIG_DIR: join(sandbox, 'c'), CODEX_HOME: join(sandbox, 'x'), GOLDFISHED_HOME: join(sandbox, 'g') });
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
const NOW = Date.UTC(2026, 9, 19, 12), DAY = 86400000, FISH = '><(((o>', bin = fileURLToPath(new URL('../bin/goldfished.mjs', import.meta.url));
const read = (path, base = import.meta.url) => readFileSync(new URL(path, base), 'utf8'), lines = path => read(path).trim().split('\n').map(JSON.parse);
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), forbidden = ['text', 'message', 'path', 'project', 'dir', 'cwd'];
const canary = ['s', 'k-ant-canary0000000000000000 sam@example.test Zq8Kd3Lm9Xv2Bn7Rt5Yw1Pc4'].join('');
const norm = s => s.replace(/ in (under 1s|\d+s)\./u, ' in <secs>.').replace(/\((\d+(\.\d)? (B|kB|MB))\)/u, '(<size>)').replace(/"tool_version":"[^"]*"/u, '"tool_version":"<version>"');
const walk = (value, visit, key = '') => { visit(value, key); if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, Array.isArray(value) ? key : k); };
const files = dir => existsSync(dir) ? Object.fromEntries(readdirSync(dir, { recursive: true }).map(f => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), 'utf8') : null])) : null;
function session(root, name, texts, { compactions = 3, extra = {}, cwd = '/srv/invented/harbour-a', plain = 'Notes about nothing in particular, only brass lanterns and quiet tides.' } = {}) {
  const tag = name.replace(/\W/gu, ''), at = (h, m) => new Date(Date.UTC(2026, 9, 10, h, m)).toISOString(), file = join(root, 'p', name);
  const rows = texts.map((text, i) => ({ type: 'user', uuid: `${tag}-u${i}`, timestamp: at(9, i), cwd, version: '2.1.292', turnOrigin: 'human', message: { role: 'user', content: text }, ...extra }));
  for (let i = 1; i <= compactions; i++) rows.push({ type: 'system', subtype: 'compact_boundary', uuid: `${tag}-b${i}`, timestamp: at(10, i), compactMetadata: { trigger: 'auto', preTokens: 1e5, postTokens: 2e4 } },
    { type: 'user', uuid: `${tag}-s${i}`, timestamp: at(10, i), isCompactSummary: true, message: { role: 'user', content: `${plain} ${i}` } });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
function world(t, { claude, codex } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gfr-')), home = join(root, 'home'), project = join(root, 'project');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [join(home, 'c/projects'), join(home, 'x/sessions'), join(project, '.git')]) mkdirSync(dir, { recursive: true });
  if (claude) cpSync(fixture('claude-code'), join(home, 'c/projects'), { recursive: true });
  if (codex) cpSync(fixture('codex/sessions'), join(home, 'x/sessions'), { recursive: true });
  const env = { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, 'c'), CODEX_HOME: join(home, 'x'), GOLDFISHED_HOME: join(home, 'g') };
  const io = (over = {}) => { const out = [], err = []; return { out: s => out.push(s), err: s => err.push(s), cwd: project, isTTY: false, outTTY: false, errTTY: false, today: '2026-10-19', nowMs: NOW, env: { ...env }, ...over, got: { out, err } }; };
  const run = async (flags = {}, over = {}) => {
    const o = io(over), real = Date.now, frozen = !real.mock;
    if (frozen) Date.now = () => NOW;
    try { const code = await retro.retro({ positional: [], flags: Object.fromEntries(Object.entries({ days: '0', ...flags }).filter(([, v]) => v !== undefined)) }, o); return { code, out: o.got.out.join('\n'), err: o.got.err.join('\n') }; } finally { if (frozen) Date.now = real; }
  };
  const w = { root, home, project, env, io, run, claude: join(home, 'c/projects'), goldfished: env.GOLDFISHED_HOME, json: async flags => JSON.parse((await run({ json: true, ...flags })).out) };
  w.long = async (spec = { 'claude-code': [12, 3], codex: [12, 3] }) => {
    const story = lines('./long/saga-01.story.jsonl'), names = readdirSync(new URL('./long/fates/', import.meta.url)).sort();
    for (const [agent, [fates, copies]] of Object.entries(spec)) for (const name of names.slice(0, fates)) for (let copy = 0; copy < copies; copy++)
      await render(story, lines(`./long/fates/${name}`), { agent, copy, root: agent === 'codex' ? join(home, 'x/sessions') : join(w.claude, 'p') });
    return w;
  };
  return w;
}
const both = t => world(t, { claude: true, codex: true });
test('every command goes to its module, --help prints its usage, bad names and flags exit 1, no command runs retro', async t => {
  const names = Object.values(modules).flatMap(Object.keys), w = world(t); assert.equal(new Set(names).size, names.length);
  const env = { ...process.env, ...w.env }, run = (args, extra = {}) => spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', cwd: w.project, ...extra });
  for (const [file, m] of Object.entries(modules)) for (const name of Object.keys(m)) {
    const out = [], code = await m[name]({ positional: [], flags: { help: true } }, { out: s => out.push(s), err: s => out.push(s), env, cwd: sandbox, isTTY: false });
    const got = run([name, '--help']), stray = name === Object.keys(m)[0] ? run([name, '--no-such-flag']) : { status: 1, stdout: '' };
    assert.deepEqual([code, got.status, got.stdout, stray.status, stray.stdout], [0, 0, out[0] + '\n', 1, ''], `${file} ${name}`);
    if (name === 'retro') matchSnapshot('retro', 'help', got.stdout);
  }
  matchSnapshot('retro', 'overview', run(['--help']).stdout); assert.equal(run(['-h']).stdout, run(['--help']).stdout);
  for (const [args, line] of [[['nonsense'], 'goldfished: unknown command. Try: goldfished --help'], [['retro', '--bogus'], 'goldfished: unknown flag --bogus. Try: goldfished retro --help']]) {
    const bad = run(args); assert.deepEqual([bad.status, bad.stdout, bad.stderr], [1, '', line + '\n']);
  }
  const hook = run(['hook', 'claude-code', 'session-start'], { input: '{}' }), bare = run([]);
  assert.equal(run(['hook', 'claude-code']).status, 1); assert.deepEqual([hook.status, hook.stdout, hook.stderr, bare.status, bare.stderr], [0, '', '', 0, '']);
  assert.ok(bare.stdout.startsWith('goldfished found no sessions. It looked in: ~/c/projects, ~/x/sessions.'));
});
test('bad flags, and a stack trace only with GOLDFISHED_DEBUG=1', async t => {
  const w = world(t), dir = 'goldfished: --dir needs --agent, because each agent keeps its files somewhere different.';
  assert.deepEqual([(await w.run({ dir: w.root })).err, (await w.run({ dir: w.root, agent: 'all' })).err], [dir, dir]);
  for (const days of ['x', '-1', '1.5', '']) assert.equal((await w.run({ days })).err, 'goldfished: invalid --days. Try: goldfished retro --help');
  assert.equal((await w.run({ agent: 'nobody' })).code, 1); assert.equal((await w.run({ agent: true })).err, 'goldfished: invalid --agent. Try: goldfished retro --help');
  for (const key of ['show', 'audit', 'names', 'save']) {
    const got = await w.run({ json: true, [key]: true });
    assert.deepEqual([got.code, got.out, got.err], [1, '', `goldfished: --${key} cannot be used with --json. Try: goldfished retro --help`]);
  }
  assert.equal(existsSync(w.goldfished), false);
  writeFileSync(join(w.root, 'a-file'), 'x');
  const run = debug => spawnSync(process.execPath, [bin, 'retro', '--agent', 'claude-code', '--dir', join(w.root, 'a-file')], { env: { ...process.env, ...w.env, GOLDFISHED_DEBUG: debug }, encoding: 'utf8', cwd: w.project });
  const quiet = run(''), loud = run('1');
  assert.deepEqual([quiet.status, quiet.stdout, quiet.stderr, loud.status], [1, '', 'goldfished: could not run retro. Check your files and try again.\n', 1]);
  assert.match(loud.stderr, /\n\s+at /u);
});
test('claude-code and codex fixtures, text and --json, match their snapshots', async t => {
  const w = both(t);
  for (const [name, flags] of [['fixtures-both', {}], ['fixtures-claude-code', { agent: 'claude-code' }], ['fixtures-codex', { agent: 'codex' }]]) {
    const text = await w.run(flags), js = await w.run({ ...flags, json: true });
    matchSnapshot('retro', name, norm(text.out)); matchSnapshot('retro', `${name}-json`, norm(js.out));
    assert.deepEqual([text.code, js.out.includes('\n'), norm(js.err)], [0, false, norm(text.out)]);
    assert.equal(JSON.parse(js.out).tool_version, JSON.parse(read('../package.json')).version);
  }
  assert.equal((await w.run({ agent: 'codex', dir: join(w.home, 'x/sessions') })).out, (await w.run({ agent: 'codex' })).out);
});
test('--days filters by file modified time', async t => {
  const w = world(t), at = (file, days) => utimesSync(file, new Date(NOW - days * DAY), new Date(NOW - days * DAY));
  at(session(w.claude, 'fresh.jsonl', ['Keep the harbour timetable in plain text.']), 2); at(session(w.claude, 'old.jsonl', ['Never buy a new brass lantern again.']), 40);
  const count = async days => /read (\d+) files?/u.exec((await w.run({ days })).out)?.[1] ?? '0';
  assert.deepEqual([await count(undefined), await count('30'), await count('60'), await count('0'), await count('1')], ['1', '1', '2', '2', '0']);
  assert.match((await w.run({ days: '0' })).out, /^goldfished retro {3}all sessions /u); assert.match((await w.run({ days: '7' })).out, /^goldfished retro {3}last 7 days /u);
});
test('automated and subagent sessions are not graded and stay off the not counted line', async t => {
  const w = world(t), short = 'Yes, go on.', pasted = 'x '.repeat(900);
  session(w.claude, 'graded.jsonl', ['Keep the harbour timetable in plain text.', short, pasted]);
  session(w.claude, 'auto.jsonl', ['Never buy a new brass lantern again.', short, pasted, pasted], { extra: { entrypoint: 'sdk-cli' } });
  session(w.claude, 'q/subagents/agent-1.jsonl', ['Keep the quay lights on all night.', short, short, pasted]);
  const agent = (await w.json()).agents[0];
  assert.deepEqual([agent.not_counted, agent.sessions, agent.messages], [{ short: 1, pasted: 1 }, 1, 3]);
  assert.match((await w.run()).out, /not graded: 1 automated session, 1 subagent\s+file/u);
});
test('sessions with the card re-sent stay out of the curve and are reported in card', async t => {
  const w = await world(t).long(), js = await w.json(), [claude, codex] = js.agents;
  assert.deepEqual([claude.sessions, claude.curve[0].sessions, claude.card.sessions, claude.card.age], [36, 24, 12, 6]);
  assert.ok(claude.card.kept_per_100 >= 0 && claude.card.kept_per_100 <= 100); assert.deepEqual(claude.curve, codex.curve);
  matchSnapshot('retro', 'long', norm((await w.run()).out)); matchSnapshot('retro', 'long-json', norm(JSON.stringify(js)));
  const alone = world(t);
  session(alone.claude, 'a.jsonl', ['Keep the harbour timetable in plain text.']);
  writeFileSync(join(alone.claude, 'p/card.jsonl'), readFileSync(fixture('claude-code/card-resent.jsonl')));
  const only = (await alone.json()).agents[0];
  assert.deepEqual([only.card.sessions, only.card.kept_per_100, only.curve.length > 0], [1, null, true]);
});
test('headline agent: most messages at the headline age, else most typed, adapter order on a tie, --agent overrides', async t => {
  const name = out => /^(\S+), by times compacted$/mu.exec(out)[1], at = spec => world(t).long(spec);
  const more = await at({ 'claude-code': [12, 2], codex: [12, 3] });
  assert.deepEqual([name((await more.run()).out), name((await more.run({ agent: 'claude-code' })).out), (await more.json()).headline.agent], ['codex', 'claude-code', 'codex']);
  assert.equal(name((await (await at({ 'claude-code': [12, 3], codex: [12, 3] })).run()).out), 'claude-code');
  const few = await at({ 'claude-code': [1, 1], codex: [2, 1] });
  assert.deepEqual([(await few.json()).headline, name((await few.run()).out), name((await few.run({ agent: 'claude-code' })).out)], [null, 'codex', 'claude-code']);
});
test('each status: none, not_recorded, drift, too_few, ok', async t => {
  const empty = world(t), none = await empty.run({ json: true });
  assert.deepEqual(JSON.parse(none.out).agents, []); matchSnapshot('retro', 'no-sessions', norm(none.err));
  const quiet = world(t);
  session(quiet.claude, 'plain.jsonl', ['Keep the harbour timetable in plain text.'], { compactions: 0 });
  mkdirSync(join(quiet.home, '.cursor')); mkdirSync(join(quiet.home, '.gemini'));
  matchSnapshot('retro', 'none-compacted', norm((await quiet.run()).out));
  assert.deepEqual((await quiet.json()).agents.map(a => [a.id, a.status, a.sessions]), [['claude-code', 'not_recorded', null], ['cursor', 'not_recorded', null]]);
  assert.deepEqual((await quiet.json({ agent: 'cursor' })).agents.map(a => a.id), ['cursor']);
  const drift = world(t), file = session(drift.claude, 'drift.jsonl', ['Keep the harbour timetable in plain text.'], { compactions: 0 });
  writeFileSync(file, readFileSync(file, 'utf8') + JSON.stringify({ type: 'system', subtype: 'compact_started_v2', uuid: 'odd' }) + '\n');
  const d = (await drift.json()).agents[0];
  assert.deepEqual([d.status, d.sessions, d.span, d.curve, d.drift], ['drift', null, null, [], { files: 1, unread: 1 }]);
  matchSnapshot('retro', 'drift', norm((await drift.run()).out));
  assert.deepEqual((await both(t).json()).agents.map(a => a.status), ['too_few', 'too_few']);
  const ok = await (await world(t).long({ 'claude-code': [12, 3] })).json();
  assert.deepEqual([ok.agents[0].status, ok.agents[0].verdict, ok.headline.agent], ['ok', 'fair', 'claude-code']);
  assert.ok(ok.headline.ci95[0] <= ok.headline.kept_per_100 && ok.headline.kept_per_100 <= ok.headline.ci95[1]);
});
test('--json holds counts only, and default output holds no text, path or project name', async t => {
  const w = both(t);
  session(w.claude, 'canary.jsonl', [`Keep ${canary} private at harbour-a.`]);
  const got = await w.run({ json: true });
  assert.equal(got.out.split('\n').length, 1);
  walk(JSON.parse(got.out), (value, key) => { assert.ok(!forbidden.includes(key), key); if (typeof value === 'string' && !['span_rule', 'tool_version'].includes(key)) assert.ok(value.length <= 40, value); });
  for (const text of [got.out, got.err, (await w.run()).out]) for (const word of ['canary', 'Zq8Kd3', 'harbour', 'copper-kettle', 'tide-tables', 'invented', w.root]) assert.ok(!text.includes(word), word);
});
test('--show and --audit print masked, cut pieces behind a warning, with numbered projects', async t => {
  const w = world(t), many = prefix => Array.from({ length: 15 }, (_, i) => `${prefix} number ${i}: Keep ${canary} ${'harbour '.repeat(14)}`), warn = flag => `${flag} prints pieces of your own messages. Do not paste this output anywhere.`;
  session(w.claude, 'a.jsonl', many('Older'), { cwd: '/srv/invented/harbour-a' });
  const newer = session(w.claude, 'b.jsonl', many('Newer'), { cwd: '/srv/invented/harbour-b', plain: 'Nothing to see, only quiet water and brass.' });
  writeFileSync(newer, readFileSync(newer, 'utf8').replaceAll('2026-10-10', '2026-10-12'));
  const shown = await w.run({ show: true }), rows = shown.out.split('\n').filter(l => l.startsWith('  ['));
  assert.deepEqual([shown.err.split('\n')[0], rows.length], [warn('--show'), 20]);
  assert.ok(rows.slice(0, 15).every(l => l.startsWith('  [claude-code project-1 age 3] Newer')) && rows.slice(15).every(l => l.startsWith('  [claude-code project-2 age 3] Older')));
  for (const l of rows) assert.ok(l.slice(l.indexOf('] ') + 2).length <= 80 && !/canary|Zq8Kd3|sam@|harbour-/u.test(l) && !l.endsWith(' '), l);
  assert.ok(rows[0].includes('[hidden]')); matchSnapshot('retro', 'show', norm(shown.out));
  const named = (await w.run({ show: true, names: true })).out;
  assert.ok(named.includes('  [claude-code harbour-b age 3] Newer') && named.includes('  [claude-code harbour-a age 3] Older'));
  const audit = await w.run({ audit: true }), picked = audit.out.split('\n').filter(l => /^ {2}\[|^ {4}(you|summary): /u.test(l));
  assert.deepEqual([audit.err.split('\n')[0], picked.length, audit.out], [warn('--audit'), 15, (await w.run({ audit: true })).out]);
  picked.forEach((l, i) => assert.ok(i % 3 ? l.slice(l.indexOf(': ') + 2).length <= 80 : /^ {2}\[claude-code project-\d age [123]\] (kept|partly there|not found) \(score \d\.\d\d\)$/u.test(l), l));
  assert.ok(!/canary|Zq8Kd3|sam@/u.test(audit.out) && audit.out.includes('[hidden]')); matchSnapshot('retro', 'audit', norm(audit.out));
  assert.ok(!(await w.run()).out.includes('  ['));
});
test('--audit draws 5 from the union of every fold by Algorithm R with seed 1', async t => {
  const w = world(t, { claude: true }), pool = [], chosen = [], rng = mulberry32(1);
  const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
  for await (const s of claudeCode.sessions(await claudeCode.listFiles(w.claude, {}), tally)) if (!s.auto && !s.sub) pool.push(...foldSession(s, grader, { sampleSeed: 1 }).auditPool);
  pool.forEach((entry, i) => { const n = i + 1, slot = n <= 5 ? n - 1 : Math.floor(rng() * n); if (slot < 5) chosen[slot] = entry; });
  assert.ok(pool.length > 5);
  const got = (await w.run({ audit: true })).out.split('\n').filter(l => l.startsWith('    you: ')).map(l => l.slice(9));
  assert.deepEqual(got, chosen.map(e => Array.from(mask(e.text.replace(/\s+/gu, ' ').trim(), 'display')).slice(0, 80).join('').trimEnd()));
});
test('--save writes one counts-only line per agent, and the next run reports the old span', async t => {
  const w = await world(t).long(), file = join(w.goldfished, 'history.jsonl');
  assert.ok((await w.run()).out.includes('read-only, nothing leaves this machine')); assert.equal(existsSync(w.goldfished), false);
  const saved = await w.run({ save: true });
  assert.ok(saved.out.includes('writes counts only to ~/.goldfished') && !saved.out.includes('Span last time') && saved.out.includes('npx goldfished init'));
  const first = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual([readdirSync(w.goldfished), first.map(l => l.id), first[0].date], [['history.jsonl'], ['claude-code', 'codex'], new Date(NOW).toISOString()]);
  for (const l of first) walk(l, (v, k) => { assert.ok(!forbidden.includes(k), k); if (typeof v === 'string' && k !== 'span_rule') assert.ok(v.length <= 40, v); });
  const dated = (days, span) => first.map(l => JSON.stringify({ ...l, date: new Date(NOW - days * DAY).toISOString(), span }));
  writeFileSync(file, [...dated(10, 1), ...dated(2, 5)].join('\n') + '\n');
  const again = await w.run({ save: true });
  assert.ok(again.out.includes('Span last time (9 Oct 2026): 1. Now: 2.')); assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 6);
  matchSnapshot('retro', 'save-history', norm(again.out));
  const frozen = files(w.goldfished);
  await w.run(); await w.run({ json: true }); await w.run({ demo: true, save: true });
  assert.deepEqual(files(w.goldfished), frozen);
});
test('the init line follows the trusted card, and the probes line follows the saved probes', async t => {
  const w = world(t, { claude: true }), init = 'Keep your goal and rules in front of your agent: npx goldfished init', cardFile = join(w.project, '.goldfished/card.md');
  assert.ok((await w.run()).out.includes(init));
  assert.equal(await card.goal({ positional: ['Keep the harbour open.'], flags: {} }, w.io({ isTTY: true })), 0);
  assert.ok(!(await w.run()).out.includes(init));
  writeFileSync(cardFile, readFileSync(cardFile, 'utf8') + '\n');
  assert.ok((await w.run()).out.includes(init));
  writeFileSync(join(w.goldfished, 'state.json'), JSON.stringify({ probes: { codex: { agent: 'codex', date: '2026-10-17', kept: true }, 'claude-code': { agent: 'claude-code', date: '2026-10-18', kept: false } } }));
  assert.ok((await w.run()).out.replace(/\n {2}/gu, ' ').includes('Your own probes: codex kept the card (17 Oct 2026); claude-code did not (18 Oct 2026).'));
  const far = spawnSync(process.execPath, [bin, 'retro', '--days', '0'], { env: { ...process.env, ...w.env, TZ: 'Pacific/Pago_Pago' }, encoding: 'utf8', cwd: w.project });
  assert.ok(far.stdout.includes('codex kept the card (17 Oct 2026)'));
});
test('--demo reads nothing, is byte-identical under any time zone, and has no fish; the fish needs a terminal', async t => {
  const w = world(t, { claude: true }), first = await w.run({ demo: true, save: true }, { outTTY: true });
  process.env.TZ = 'America/New_York';
  const second = await w.run({ demo: true }, { outTTY: true });
  assert.equal(process.env.TZ, 'America/New_York'); process.env.TZ = 'UTC';
  assert.equal(first.out, second.out); assert.equal(first.out.split('\n')[0], 'Example from synthetic sessions, not real data.');
  assert.ok(!first.out.includes(FISH) && first.out.includes('read-only') && first.err === '' && !existsSync(w.goldfished));
  matchSnapshot('retro', 'demo', first.out);
  const js = await w.run({ demo: true, json: true });
  assert.deepEqual([js.out.split('\n').length, JSON.parse(js.out).grader.id], [1, grader.GRADER.id]);
  assert.ok(js.err.startsWith('Example from synthetic sessions, not real data.\n')); matchSnapshot('retro', 'demo-json', js.out);
  const fish = async over => (await w.run({}, over)).out.startsWith(FISH);
  assert.deepEqual([await fish({ outTTY: true }), await fish({ outTTY: false }), await fish({ outTTY: true, env: { ...w.env, NO_COLOR: '1' } })], [true, false, false]);
});
test('progress goes to stderr only on a terminal and only after two seconds', async t => {
  const w = world(t, { claude: true });
  let ticks = 0;
  t.mock.method(Date, 'now', () => 1e12 + 3000 * ticks++);
  t.mock.method(globalThis, 'setInterval', fn => { fn(); return 0; });
  assert.equal((await w.run({}, { errTTY: false })).err, '');
  assert.match((await w.run({}, { errTTY: true })).err, /^\rreading 0 of \d+ files\n\r {79}\r$/u);
  const js = await w.run({ json: true }, { errTTY: true });
  assert.ok(js.err.startsWith('\rreading 0 of')); assert.equal(js.out.split('\n').length, 1);
  t.mock.restoreAll();
  assert.equal((await w.run({}, { errTTY: true })).err, '');
});
