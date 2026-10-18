#!/usr/bin/env node
// Runs the Codex platform proofs in a scratch folder with its own Codex home.
// Usage: node run.mjs init | iso | cx1 | cx2 | cx3 | finish | all
// GFPROOF_AUTH names a signed-in auth.json to copy in. GFPROOF_MODEL picks the model. Values stay in the scratch folder; this prints names, sizes and outcomes.
import codexAdapter from '../../../src/agents/codex.mjs';
import * as L from './lib.mjs';
import { message, rollout, show } from './lib.mjs';
const say = (k, v) => console.log(`   ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const words = 'amber basalt cedar dune ember fjord garnet harbour iris juniper kestrel lantern meadow nectar orchard pebble quartz reed saffron thistle umber velvet willow yarrow zephyr'.split(' ');
const notes = (n, count) => {
  let x = n * 7919;
  const pick = () => words[(x = (x * 1103515245 + 12345) % 2147483648) % words.length];
  return Array.from({ length: count }, (_, i) => `Note ${n}.${i}: the ${pick()} ${pick()} keeps the ${pick()} gate.`).join(' ');
};
const texts = (row) => (row.payload?.content ?? []).map((b) => b.text ?? '').join('');
const developer = (rows) => rows.filter((r) => r.type === 'response_item' && r.payload?.role === 'developer');
async function iso() {
  console.log('## ISO');
  const specs = [{ tag: 'iss', event: 'SessionStart', mode: 'log' }, { tag: 'iup', event: 'UserPromptSubmit', mode: 'log', where: 'json' }];
  L.configure(`${L.OUT}/iso`, specs, { agents: 'The code word is ISOCODE-PINE.' });
  const listed = await L.hooksList();
  const norm = (p) => p.replaceAll(String.fromCharCode(92), '/').toLowerCase();
  const own = listed.hooks.every((h) => norm(h.sourcePath).startsWith(norm(L.HOME)));
  const run = show(await L.codex('iso', { specs, trust: false, agents: 'The code word is ISOCODE-PINE.', prompt: 'Quote the code word starting ISOCODE- from your instructions.' }));
  const rows = rollout(run.threadId)?.rows ?? [];
  const blocks = rows.filter((r) => r.type === 'response_item' && /# AGENTS.md instructions/.test(texts(r)));
  const body = blocks.map((r) => texts(r).split('<INSTRUCTIONS>')[1]?.split('</INSTRUCTIONS>')[0]?.trim());
  const r = {
    homeIsScratch: norm(listed.home) === norm(L.HOME),
    hooksListed: listed.hooks.length,
    allHooksFromScratchHome: own,
    trustBefore: listed.hooks.map((h) => h.trustStatus),
    probesFired: run.probes.length,
    rolloutInScratch: rows.length > 0,
    instructionBlocks: blocks.length,
    instructionTextIsOnlyTheDecoy: body.length === 1 && body[0] === 'The code word is ISOCODE-PINE.',
    answer: message(run).includes('ISOCODE-PINE'),
  };
  say('result', r);
}
async function cx1() {
  console.log('## CX1 location and trust');
  const places = ['toml', 'json', 'ptoml', 'pjson'];
  const specs = places.map((w) => ({ where: w, tag: w, event: 'SessionStart', mode: 'log' }));
  const loc = show(await L.codex('cx1-loc', { specs }));
  const rl = await L.hooksList();
  const r = { fired: loc.probes.map((p) => p.tag).sort(), trustedByState: loc.trusted, listedSources: rl.hooks.map((h) => h.source + '/' + h.sourcePath.split(/[\\/]/).slice(-2).join('/')), warnings: rl.warnings.length };
  say('location', r);
  console.log('## CX1 context');
  const ctx = [
    { tag: 'ssA', event: 'SessionStart', mode: 'say', args: ['CODEWORD-ALPHA'] },
    { tag: 'ssC', event: 'SessionStart', mode: 'both', args: ['CODEWORD-CHARLIE', 'screen line from session start'] },
    { tag: 'upB', event: 'UserPromptSubmit', mode: 'say', args: ['CODEWORD-BRAVO'] },
    { tag: 'upD', event: 'UserPromptSubmit', mode: 'both', args: ['CODEWORD-DELTA', 'screen line from prompt hook'] },
  ];
  const c = show(await L.codex('cx1-ctx', { specs: ctx, prompt: 'List every word of the form CODEWORD-<LETTERS> that appears anywhere in your context, exactly as written, comma separated. If none, say none.' }));
  const rows = rollout(c.threadId).rows;
  const dev = developer(rows).map(texts);
  const everything = [c.events.map((e) => JSON.stringify(e)).join(''), c.stderr, rows.map((x) => JSON.stringify(x)).join('')].join('');
  const rc = {
    modelNamedAll: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'].every((w) => message(c).includes('CODEWORD-' + w)),
    storedAsDeveloperItems: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'].map((w) => dev.includes('CODEWORD-' + w)),
    screenLineAnywhereInHeadlessOutput: /screen line from/.test(everything),
  };
  say('context', rc);
  console.log('## CX1 cap');
  const lens = [[5999, 'a'], [9500, 'a'], [9999, 'a'], [10000, 'a'], [10001, 'a'], [12000, 'a'], [30000, 'a'], [3333, 'c'], [3334, 'c'], [10000, 'c']];
  const capSpecs = lens.map(([n, k]) => ({ tag: `s${k}${n}`, event: 'SessionStart', mode: 'ctx', args: [String(n), k === 'c' ? 'cjk' : 'ascii'] }))
    .concat([[10000, 'a'], [10001, 'a'], [3334, 'c']].map(([n, k]) => ({ tag: `u${k}${n}`, event: 'UserPromptSubmit', mode: 'ctx', args: [String(n), k === 'c' ? 'cjk' : 'ascii'] })));
  const cap = show(await L.codex('cx1-cap', { specs: capSpecs }));
  const capRows = developer(rollout(cap.threadId).rows).map(texts);
  const outcome = [];
  for (const s of capSpecs) {
    const text = capRows.find((t) => t.includes(`[${s.tag}]`));
    const spilled = /^Warning: truncated output \(original token count: (\d+)\)/.exec(text ?? '');
    outcome.push({ tag: s.tag, event: s.event, chars: [...(text ?? '')].length, bytes: Buffer.byteLength(text ?? ''), whole: !spilled && (text ?? '').includes(`[END${s.tag}]`), spilledTokens: spilled ? Number(spilled[1]) : null, pathNamed: /Full hook output saved to:/.test(text ?? '') });
  }
  for (const o of outcome) say(o.tag, o);
}
async function cx2() {
  console.log('## CX2 block and prompt input');
  const block = show(await L.codex('cx2-block', { specs: [{ tag: 'blk', event: 'UserPromptSubmit', mode: 'block', args: ['goldfished answers here, no model turn'] }], prompt: 'gf: list' }));
  const done = block.events.find((e) => e.type === 'turn.completed');
  const rows = rollout(block.threadId).rows;
  const r = {
    assistantMessages: block.events.filter((e) => e.item?.type === 'agent_message').length,
    tokens: done ? done.usage.input_tokens + done.usage.output_tokens : null,
    reasonShownInHeadlessOutput: /goldfished answers here/.test(block.events.map((e) => JSON.stringify(e)).join('') + block.stderr),
    promptKeptInSessionFile: rows.some((x) => /gf: list/.test(JSON.stringify(x))),
    promptKeys: Object.keys(JSON.parse(block.probes[0].stdin)),
  };
  say('block', r);
  const entries = (seen) => seen.filter((m) => m.method === 'hook/completed').map((m) => ({ status: m.params.run.status, entries: m.params.run.entries.map((e) => e.kind + ':' + e.text) }));
  r.screenBlock = entries(await L.appTurn('cx2-app-block', [{ tag: 'ab', event: 'UserPromptSubmit', mode: 'block', args: ['REASON-TEXT'] }], 'gf: list'));
  r.screenBlockWithMessage = entries(await L.appTurn('cx2-app-blocksys', [{ tag: 'abs', event: 'UserPromptSubmit', mode: 'blocksys', args: ['REASON-TEXT', 'SYSTEM-TEXT'] }], 'gf: list'));
  const passed = await L.appTurn('cx2-app-sys', [{ tag: 'as', event: 'UserPromptSubmit', mode: 'sys', args: ['SYSTEM-TEXT'] }], 'Reply with the single word ok.');
  r.screenPassThrough = entries(passed);
  r.passThroughModelAnswered = passed.some((m) => m.method === 'item/completed' && m.params.item?.type === 'agentMessage');
  say('screen', { block: r.screenBlock, blockWithMessage: r.screenBlockWithMessage, passThrough: r.screenPassThrough, answered: r.passThroughModelAnswered });
}
async function cx3() {
  console.log('## CX3 compaction and session file');
  const specs = [
    { tag: 'ssc', event: 'SessionStart', mode: 'say', matcher: 'compact', args: ['CODEWORD-ECHO'] },
    { tag: 'ss', event: 'SessionStart', mode: 'log' },
    { tag: 'pre', event: 'PreCompact', mode: 'log' },
    { tag: 'post', event: 'PostCompact', mode: 'log' },
    { tag: 'up', event: 'UserPromptSubmit', mode: 'log' },
  ];
  const config = ['model_auto_compact_token_limit=22000'];
  const one = show(await L.codex('cx3-1', { specs, config, prompt: 'Here are some notes. Reply with the single word read.\n' + notes(1, 600) }));
  const two = show(await L.codex('cx3-2', { specs, config, resume: one.threadId, prompt: 'Reply with the code word that starts CODEWORD- if one appears anywhere in your context, else the word none.' }));
  const order = two.probes.map((p) => `${p.event}${JSON.parse(p.stdin).source ? ':' + JSON.parse(p.stdin).source : ''}${JSON.parse(p.stdin).trigger ? ':' + JSON.parse(p.stdin).trigger : ''}(${p.tag})`);
  const rows = rollout(one.threadId).rows;
  const at = rows.findIndex((x) => x.type === 'compacted');
  const echo = developer(rows).findIndex((x) => texts(x) === 'CODEWORD-ECHO');
  const echoRow = rows.findIndex((x) => x.type === 'response_item' && x.payload.role === 'developer' && texts(x) === 'CODEWORD-ECHO');
  const r = {
    compacted: rows.filter((x) => x.type === 'compacted').length,
    hookOrderOnCompactingTurn: order,
    compactHookInputKeys: Object.keys(JSON.parse(two.probes.find((p) => p.event === 'PostCompact').stdin)),
    startCompactKeys: Object.keys(JSON.parse(two.probes.find((p) => p.tag === 'ssc').stdin)),
    modelHadAddedContext: message(two).includes('CODEWORD-ECHO'),
    addedContextStoredAfterCompactedRecord: echo >= 0 && echoRow > at,
    matcherSelectedCompactOnly: one.probes.concat(two.probes).filter((p) => p.tag === 'ssc').length === 1,
  };
  say('compaction', r);
  const files = (await Promise.all(codexAdapter.roots({ CODEX_HOME: L.HOME }, '').map((x) => codexAdapter.listFiles(x)))).flat().filter((f) => f.file.includes(one.threadId));
  const meta = rows[0].payload;
  const c = rows[at].payload;
  const counts = {};
  for (const x of rows) counts[`${x.type}/${x.payload?.type ?? ''}`] = (counts[`${x.type}/${x.payload?.type ?? ''}`] ?? 0) + 1;
  const shape = {
    filesForTheThread: files.length,
    recordKinds: counts,
    sessionMetaKeys: Object.keys(meta),
    sessionMeta: { source: meta.source, originator: meta.originator, cliVersion: typeof meta.cli_version },
    compactedPayloadKeys: Object.keys(c),
    replacementItems: c.replacement_history.map((i) => `${i.type}${i.role ? '/' + i.role : ''}${i.encrypted_content ? ':encrypted' : ''}`),
    userMessageEvents: rows.filter((x) => x.type === 'event_msg' && x.payload.type === 'user_message').length,
    userMessageViaItemCompleted: rows.filter((x) => x.type === 'event_msg' && x.payload.type === 'item_completed' && x.payload.item?.type === 'UserMessage').length,
  };
  say('shape', shape);
  const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
  const sessions = [];
  for await (const s of codexAdapter.sessions(files, tally)) sessions.push(s);
  const adapter = {
    sessions: sessions.length,
    auto: sessions[0].auto,
    typed: sessions[0].typed.length,
    compactions: sessions[0].compactions.map((x) => (x.visible === null ? null : [...x.visible].length)),
    understood: tally.understood,
    malformed: tally.malformed,
    drift: codexAdapter.driftCheck(tally),
  };
  say('adapter', adapter);
}
const proofs = { iso, cx1, cx2, cx3 };
const cmd = process.argv[2];
console.log(`codex ${L.version()}`);
if (cmd === 'init') { L.init(); console.log('scratch made'); }
else if (cmd === 'finish') console.log(L.finish() ? 'sign-in copy deleted' : 'COULD NOT DELETE');
else for (const name of cmd === 'all' ? Object.keys(proofs) : [cmd]) await proofs[name]();
