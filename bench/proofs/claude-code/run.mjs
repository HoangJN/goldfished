#!/usr/bin/env node
// Runs the Claude Code platform proofs in a scratch folder, with the developer's own settings left out.
// Usage: node run.mjs init | <proof> ...   Everything it writes stays under GFPROOF_ROOT.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GFPROOF_ROOT ?? 'D:/Dev/gf-scratch/b12-gfproof';
const PLUG = `${ROOT}/plugin`;
const PROJ = `${ROOT}/proj`;
const OUT = `${ROOT}/out`;
const model = process.env.GFPROOF_MODEL ? ['--model', process.env.GFPROOF_MODEL] : [];

export function init() {
  rmSync(ROOT, { recursive: true, force: true });
  for (const d of [`${PLUG}/.claude-plugin`, `${PLUG}/hooks`, PROJ, OUT]) mkdirSync(d, { recursive: true });
  writeFileSync(`${PLUG}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'gfproof', version: '0.0.1', description: 'proof hooks' }));
  copyFileSync(join(here, 'probe.mjs'), `${PLUG}/hooks/probe.mjs`);
}

function hooksFile(specs, dir, file = `${PLUG}/hooks/hooks.json`) {
  const hooks = {};
  for (const s of specs) {
    const args = ['${CLAUDE_PLUGIN_ROOT}/hooks/probe.mjs', dir, s.tag, s.event, s.mode, ...(s.args ?? []).map(String)];
    (hooks[s.event] ??= []).push({ ...(s.matcher ? { matcher: s.matcher } : {}), hooks: [{ type: 'command', command: 'node', args, timeout: 10 }] });
  }
  writeFileSync(file, JSON.stringify({ hooks }, null, 1));
}

// Windows keeps one variable called Path. Setting PATH beside it would leave two, so the old one goes first.
function childEnv(env, path) {
  const base = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([k]) => !(path && /^path$/i.test(k))));
  return path ? { ...base, Path: path } : base;
}

function prepare(label, { specs = [], persist = false, resume, tools = '', env = {}, extra = [], path, stream = false }) {
  const dir = `${OUT}/${label}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  hooksFile(specs, dir);
  copyFileSync(join(here, 'probe.mjs'), `${PLUG}/hooks/probe.mjs`);
  const args = ['-p', '--setting-sources', 'project,local', '--plugin-dir', PLUG, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--tools', tools, '--strict-mcp-config', ...(stream ? ['--input-format', 'stream-json'] : []), ...(persist ? [] : ['--no-session-persistence']), ...(resume ? ['--resume', resume] : []), ...model, ...extra];
  return { dir, args, opts: { cwd: PROJ, encoding: 'utf8', maxBuffer: 1 << 28, env: childEnv(env, path) } };
}

function collect(dir, label, out, err, status) {
  writeFileSync(`${dir}.stream.jsonl`, out);
  writeFileSync(`${dir}.stderr.txt`, err);
  const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: 'unparsed' }; } });
  const probes = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))).sort((x, y) => x.at - y.at);
  return { events, probes, status, stderr: err, sessionId: events.find((e) => e.session_id)?.session_id };
}

const CLAUDE = process.env.GFPROOF_CLAUDE ?? 'claude';

// One headless run. The prompt goes in on stdin so nothing is quoted. Returns the stream events and the probe records.
export function claude(label, o = {}) {
  const { dir, args, opts } = prepare(label, o);
  const r = spawnSync(o.bin ?? CLAUDE, args, { ...opts, input: o.prompt });
  return collect(dir, label, r.stdout ?? '', r.stderr ?? '', r.status);
}

// Streaming input: each message is sent once the one before it has produced a result, then the pipe is held open for `tail` ms.
export async function claudeStream(label, messages, o = {}, tail = 15000) {
  const { dir, args, opts } = prepare(label, { ...o, stream: true });
  const child = spawn(CLAUDE, args, opts);
  let out = '';
  let err = '';
  let results = 0;
  let sent = 0;
  const send = () => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: messages[sent++] } }) + '\n');
  child.stdout.on('data', (c) => {
    out += c;
    const n = out.split('\n').filter((l) => l.includes('"type":"result"')).length;
    if (n > results) { results = n; if (sent < messages.length) send(); else setTimeout(() => child.stdin.end(), tail); }
  });
  child.stderr.on('data', (c) => (err += c));
  send();
  const status = await new Promise((res) => child.on('close', res));
  return collect(dir, label, out, err, status);
}

// What a run did, in names and counts. Values stay in the scratch folder.
export function show(label, run) {
  const kinds = {};
  for (const e of run.events) kinds[`${e.type}${e.subtype ? ':' + e.subtype : ''}`] = (kinds[`${e.type}${e.subtype ? ':' + e.subtype : ''}`] ?? 0) + 1;
  const result = run.events.find((e) => e.type === 'result');
  console.log(`== ${label}: exit ${run.status}, events ${JSON.stringify(kinds)}`);
  if (result) console.log(`   result: subtype=${result.subtype} is_error=${result.is_error} turns=${result.num_turns} cost=${result.total_cost_usd}`);
  for (const p of run.probes) {
    let keys = '?';
    try { const j = JSON.parse(p.stdin); keys = Object.entries(j).map(([k, v]) => `${k}:${typeof v === 'string' ? v.length : typeof v}`).join(' '); } catch {}
    console.log(`   probe ${p.tag}/${p.event}/${p.mode} sent=${p.sent.length}c code=${p.code} stdin[${keys}]`);
  }
  return run;
}

const both = [
  { tag: 'ss', event: 'SessionStart', mode: 'log' },
  { tag: 'up', event: 'UserPromptSubmit', mode: 'log' },
];

const filler = () => {
  const words = 'amber basalt cedar dune ember fjord garnet harbour iris juniper kestrel lantern meadow nectar orchard pebble quartz reed saffron thistle umber velvet willow yarrow zephyr'.split(' ');
  return Array.from({ length: 2600 }, (_, i) => words[(i * 7 + (i >> 3)) % words.length]).join(' ');
};

// The kinds of record at the end of a session file, in order, with no text in them.
function transcriptTail(file, n = 14) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-n).map((r) => [r.type, r.subtype, r.attachment?.type, r.isCompactSummary ? 'summary' : '', r.message?.role].filter(Boolean).join('/'));
}

const seed = (label) => claude(label, { prompt: `Remember the code word MARIGOLD. The rest of this message is filler, ignore it.
${filler()}
Reply with the single word noted.`, specs: both, persist: true, extra: ['--max-turns', '1'] });

// Session folders the runs left behind: the one under the developer's projects folder and the one under the OS temp folder, found by the word gfproof in the name.
function clean() {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  for (const base of [join(home, '.claude', 'projects'), join(process.env.TEMP ?? '', 'claude')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).filter((n) => n.includes('gfproof'))) {
      rmSync(join(base, name), { recursive: true, force: true });
      console.log('removed', join(base.replace(home, '~'), name));
    }
  }
}

const proofs = {
  init,
  clean,
  // P1: what the prompt hook is handed for a typed prompt, a multi-line (pasted-looking) one, and a turn the agent starts itself.
  p1() {
    show('p1-multi', claude('p1-multi', { prompt: 'rule: first line\nsecond line\n\nthird line. Reply with the word ok.', specs: both, extra: ['--max-turns', '1'] }));
  },
  async p1self() {
    const self = show('p1-self', await claudeStream('p1-self', ['Run this in the background with the Bash tool (run_in_background true): sleep 3; echo finished. Then reply with the single word started.'], { specs: both, tools: 'Bash', extra: ['--allowedTools', 'Bash', '--permission-mode', 'bypassPermissions'] }, 25000));
    console.log('UserPromptSubmit records:', self.probes.filter((p) => p.event === 'UserPromptSubmit').length);
  },
  // P3: a blocked prompt spends no model turn; a systemMessage rides along with a prompt that still goes through.
  p3() {
    const hook = (mode, text) => [{ tag: 'ss', event: 'SessionStart', mode: 'log' }, { tag: 'up', event: 'UserPromptSubmit', mode, args: [text] }];
    const blocked = show('p3-block', claude('p3-block', { prompt: 'gf: list', specs: hook('block', 'GFREPLY blocked line') }));
    console.log('assistant events:', blocked.events.filter((e) => e.type === 'assistant').length);
    const passed = show('p3-sys', claude('p3-sys', { prompt: 'rule: be brief. Reply with the word ok.', specs: hook('sys', 'GFSCREEN shown line'), extra: ['--max-turns', '1'] }));
    console.log('assistant events:', passed.events.filter((e) => e.type === 'assistant').length);
  },
  // P5: added context at the sizes either side of the 10,000 character line, ascii and three-byte text. The model is asked which end markers reached it.
  p5(kind = 'ascii') {
    const sizes = [5999, 9500, 9999, 10000, 10001];
    const specs = sizes.map((n) => ({ tag: `s${n}`, event: 'SessionStart', mode: 'ctx', args: [n, kind] }));
    if (kind === 'ascii') specs.push(...[10000, 10001].map((n) => ({ tag: `u${n}`, event: 'UserPromptSubmit', mode: 'ctx', args: [n, kind] })));
    const prompt = 'List, comma separated, every marker of the form [ENDname] that you can see anywhere in your context, nothing else. If some context was cut and replaced by a file path, say CUT and quote the path.';
    const run = show(`p5-${kind}`, claude(`p5-${kind}`, { prompt, specs, extra: ['--max-turns', '1'] }));
    const resp = run.events.filter((e) => e.subtype === 'hook_response' && e.output);
    for (const e of resp) console.log(`   hook output ${e.hook_event}: ${e.output.length} chars, ends ${JSON.stringify(e.output.slice(-24))}`);
    const text = run.events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    console.log('   model said:', JSON.stringify(text));
  },
  // P9 and the manual half of P6: a session of about 5,000 tokens, resumed with /compact, with a hook on every compaction event.
  p9() {
    const first = seed('p9-first');
    show('p9-first', first);
    const u = first.events.find((e) => e.type === 'result')?.usage;
    console.log('   first run input tokens:', u && u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens);
    const specs = [
      ...both,
      { tag: 'pre', event: 'PreCompact', mode: 'log' },
      { tag: 'post', event: 'PostCompact', mode: 'log' },
      { tag: 'ctx', event: 'SessionStart', matcher: 'compact', mode: 'say', args: ['GFCTX card goes here'] },
    ];
    const second = show('p9-compact', claude('p9-compact', { prompt: '/compact', specs, persist: true, resume: first.sessionId }));
    console.log('   order:', second.probes.map((p) => `${p.tag}:${p.event}:${p.stdin.includes('"source"') ? JSON.parse(p.stdin).source : ''}`).join(' > '));
    const t = second.probes.find((p) => p.stdin.includes('transcript_path'));
    if (t) console.log('   transcript tail:', transcriptTail(JSON.parse(t.stdin).transcript_path).join(' | '));
  },
  // P6, auto half: resume the p9 session with the auto-compaction line set very low, so the next turn compacts by itself.
  p6auto(pct = '1', win) {
    const id = show('p6-seed', seed('p6-seed')).sessionId;
    const specs = [
      ...both,
      { tag: 'pre', event: 'PreCompact', mode: 'log' },
      { tag: 'post', event: 'PostCompact', mode: 'log' },
      { tag: 'ctx', event: 'SessionStart', matcher: 'compact', mode: 'say', args: ['GFCTX the card code word is PELICAN'] },
    ];
    const run = show('p6-auto', claude('p6-auto', { prompt: 'What is the card code word in your context? Answer with the word only, or NONE.', specs, persist: true, resume: id, env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: pct, ...(win ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: win } : {}) }, extra: ['--debug-file', `${OUT}/p6-auto.debug.txt`] }));
    console.log('   order:', run.probes.map((p) => `${p.tag}:${p.event}:${JSON.parse(p.stdin).source ?? JSON.parse(p.stdin).trigger ?? ''}`).join(' > '));
    console.log('   boundary events:', run.events.filter((e) => e.subtype === 'compact_boundary').map((e) => JSON.stringify(e.compact_metadata ?? {})));
    const text = run.events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
    console.log('   model said:', JSON.stringify(text));
    const t = run.probes.find((p) => p.stdin.includes('transcript_path'));
    if (t) console.log('   transcript tail:', transcriptTail(JSON.parse(t.stdin).transcript_path, 12).join(' | '));
  },
  // P11: node is not on PATH, so every hook fails to start. What does the run show? The hook is the one in hooks.json, exec form.
  p11() {
    const bin = spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0];
    const run = show('p11', claude('p11', { prompt: 'Reply with the word ok.', specs: both, bin, path: 'C:\\Windows\\System32;C:\\Windows', extra: ['--max-turns', '1'] }));
    for (const e of run.events.filter((x) => x.subtype === 'hook_response')) console.log('   hook_response', e.hook_event, e.outcome, 'exit', e.exit_code, 'stderr', JSON.stringify(e.stderr), 'output', JSON.stringify(e.output));
    for (const e of run.events.filter((x) => x.subtype === 'informational')) console.log('   informational', e.level, JSON.stringify(e.content));
    console.log('   stderr of the process:', JSON.stringify(run.stderr.slice(0, 300)));
    const plain = spawnSync(bin, ['-p', '--setting-sources', 'project,local', '--plugin-dir', PLUG, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--max-turns', '1', ...model], { cwd: PROJ, input: 'Reply with the word ok.', encoding: 'utf8', env: childEnv({}, 'C:\\Windows\\System32;C:\\Windows') });
    console.log('   plain text run: exit', plain.status, 'stdout', JSON.stringify(plain.stdout), 'stderr', JSON.stringify(plain.stderr));
    const text = run.events.filter((x) => x.type === 'assistant').flatMap((x) => x.message.content).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
    console.log('   model said:', JSON.stringify(text));
  },
  // P10: install and remove a plugin from a local marketplace under a throwaway config folder. No model call: the session is started without a login, which stops it before any request.
  p10() {
    const cfg = `${ROOT}/cfg`;
    const mk = `${ROOT}/mk`;
    const dir = `${OUT}/p10`;
    rmSync(cfg, { recursive: true, force: true });
    for (const d of [`${mk}/.claude-plugin`, `${mk}/hooks`, cfg, dir]) mkdirSync(d, { recursive: true });
    writeFileSync(`${mk}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'gfhook', version: '0.0.1', description: 'proof hook' }));
    writeFileSync(`${mk}/.claude-plugin/marketplace.json`, JSON.stringify({ name: 'gfproof-mk', owner: { name: 'proof' }, plugins: [{ name: 'gfhook', source: '.', description: 'proof hook' }] }));
    copyFileSync(join(here, 'probe.mjs'), `${mk}/hooks/probe.mjs`);
    hooksFile([{ tag: 'inst', event: 'SessionStart', mode: 'log' }], dir, `${mk}/hooks/hooks.json`);
    const env = { ...childEnv({ CLAUDE_CONFIG_DIR: cfg }), ANTHROPIC_API_KEY: '' };
    const cc = (...a) => { const r = spawnSync(CLAUDE, a, { cwd: PROJ, env, input: 'hi', encoding: 'utf8' }); console.log(`   claude ${a.slice(0, 4).join(' ')}: exit ${r.status}, out ${JSON.stringify((r.stdout + r.stderr).trim().slice(0, 160))}`); return r; };
    const tree = (d) => readdirSync(d, { recursive: true }).map(String);
    const real = `${process.env.USERPROFILE ?? process.env.HOME}/.claude/plugins`;
    const stamp = () => ['installed_plugins.json', 'known_marketplaces.json'].map((f) => { try { const s = statSync(`${real}/${f}`); return `${s.size}:${s.mtimeMs}`; } catch { return 'none'; } }).join(' ');
    const before = stamp();
    cc('plugin', 'marketplace', 'add', mk);
    cc('plugin', 'install', 'gfhook@gfproof-mk');
    cc('plugin', 'list');
    const fired = cc('-p', 'hi', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--max-turns', '1', '--no-session-persistence');
    writeFileSync(`${dir}.stream.jsonl`, fired.stdout);
    const res = fired.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'result');
    console.log('   result event:', res && JSON.stringify({ subtype: res.subtype, is_error: res.is_error, turns: res.num_turns, cost: res.total_cost_usd, input: res.usage?.input_tokens }));
    const records = readdirSync(dir).filter((f) => f.endsWith('.json'));
    console.log('   hook records written by the installed plugin:', records.length, 'hook events in stream:', fired.stdout.split('\n').filter((l) => l.includes('hook_started')).length);
    cc('plugin', 'uninstall', 'gfhook@gfproof-mk');
    cc('plugin', 'marketplace', 'remove', 'gfproof-mk');
    cc('plugin', 'list');
    console.log('   left in the config folder naming the plugin or marketplace:', tree(cfg).filter((f) => /gfhook|gfproof/.test(f)));
    const reg = (f) => { try { return Object.keys(JSON.parse(readFileSync(`${cfg}/plugins/${f}`, 'utf8'))); } catch { return 'unreadable'; } };
    console.log('   registry keys after removal:', reg('installed_plugins.json'), reg('known_marketplaces.json'));
    console.log('   plugin folder now:', existsSync(`${cfg}/plugins`) ? tree(`${cfg}/plugins`) : 'none');
    console.log('   developer plugin records unchanged:', before === stamp());
  },
  // One object carrying both added context and a screen line, from a SessionStart hook.
  both() {
    const specs = [{ tag: 'ss', event: 'SessionStart', mode: 'both', args: ['GFCTX the code word is PELICAN', 'GFSCREEN receipt line'] }];
    const run = show('both', claude('both', { prompt: 'What is the code word given to you by a start-up hook? Answer with the word only, or NONE.', specs, extra: ['--max-turns', '1'] }));
    for (const e of run.events.filter((x) => x.subtype === 'informational')) console.log('   informational', e.level, JSON.stringify(e.content));
    const text = run.events.filter((x) => x.type === 'assistant').flatMap((x) => x.message.content).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
    console.log('   model said:', JSON.stringify(text));
  },
  // P12: does a CLAUDE.local.md in the project folder reach the model?
  p12() {
    writeFileSync(`${PROJ}/CLAUDE.local.md`, 'The local code word is HERRING.\n');
    const run = show('p12', claude('p12', { prompt: 'What is the local code word given in your project instructions? Answer with the word only, or NONE.', specs: both, extra: ['--max-turns', '1'] }));
    const text = run.events.filter((x) => x.type === 'assistant').flatMap((x) => x.message.content).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
    console.log('   model said:', JSON.stringify(text));
    rmSync(`${PROJ}/CLAUDE.local.md`);
  },
  // ISO: with project and local settings only, nothing of the developer's fires. Every hook in the stream must be ours.
  iso() {
    const run = show('iso', claude('iso', { prompt: 'Reply with the word ok.', specs: both, extra: ['--max-turns', '1'] }));
    const hooks = run.events.filter((e) => /^hook_/.test(e.subtype ?? ''));
    const names = [...new Set(hooks.map((e) => `${e.subtype} ${e.hook_name ?? e.hook_event}`))];
    console.log('hook events:', names);
    const started = hooks.filter((e) => e.subtype === 'hook_started').length;
    const init = run.events.find((e) => e.subtype === 'init');
    console.log('hooks started', started, 'probe files', run.probes.length, 'plugins loaded', init.plugins.map((p) => p.source));
  },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [name, ...rest] = process.argv.slice(2);
  if (!proofs[name]) { console.error(`proofs: ${Object.keys(proofs).join(' ')}`); process.exit(2); }
  await proofs[name](...rest);
}

export { PLUG, PROJ, OUT, ROOT };
