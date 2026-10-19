import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as L from './lib.mjs';
import adapter from '../../../src/agents/codex.mjs';
import * as grader from '../../../src/grade.mjs';
import { foldSession } from '../../../src/fold.mjs';

const prompts = [
  'Keep the copper kettle beside the pantry. Reply only with ok.',
  'Paint the garden gate a bright violet. Reply only with ok.',
  'Leave the harbour timetable in plain text. Reply only with ok.',
  'Keep the orchard path open on Sundays. Reply only with ok.',
];
const specs = [{ tag: 'cx4', event: 'UserPromptSubmit', mode: 'say', args: ['The invented hook code word is REED.'] }];
const agents = 'Keep answers to one word for this invented proof.';
const words = 'amber basalt cedar dune ember fjord garnet harbour iris juniper kestrel lantern meadow nectar orchard pebble quartz reed saffron thistle umber velvet willow yarrow zephyr'.split(' ');
let execFailed = 0, appFailed = 0;
const textOf = item => typeof item?.message === 'string' ? item.message :
  typeof item?.content === 'string' ? item.content : (item?.content ?? []).map(part => part.text ?? '').join('\n');
function counts(id) {
  const rows = L.rollout(id).rows, typed = {}, injected = {}, kinds = {}, occurrences = prompts.map(() => 0), shapes = {};
  for (const row of rows) {
    const p = row.payload;
    const key = `${row.type}/${p?.type ?? ''}${p?.role ? '/' + p.role : ''}`;
    kinds[key] = (kinds[key] ?? 0) + 1;
    if (['task_started', 'task_complete', 'task_completed', 'item_completed', 'user_message'].includes(p?.type) || row.type === 'turn_context') shapes[key] = Object.keys(p).sort();
    const item = p?.type === 'item_completed' ? p.item : p;
    const text = textOf(item), found = prompts.indexOf(text);
    if (found >= 0) { typed[key] = (typed[key] ?? 0) + 1; occurrences[found]++; }
    else if (row.type === 'response_item' && p?.type === 'message' && ['user', 'developer'].includes(p.role)) {
      const markers = p.role === 'user' ? p.content.map(part => part.text?.startsWith('# AGENTS.md instructions') ? 'AGENTS.md instructions' :
        part.text?.startsWith('<environment_context>') ? 'environment_context' : 'other') :
        [text.includes('The invented hook code word is REED.') ? 'hook output' : 'other'];
      for (const marker of markers) { const name = `${p.role}/${marker}`; injected[name] = (injected[name] ?? 0) + 1; }
    }
  }
  return { files: 1, meta: rows.filter(r => r.type === 'session_meta').map(r => ({ source: r.payload.source, originator: r.payload.originator })),
    kinds, shapes, typed, injected, occurrences: occurrences.filter(Boolean), compactions: rows.filter(r => r.type === 'compacted').length,
    failedTurns: rows.filter(r => r.payload?.type === 'task_complete' && r.payload.error).length };
}
async function app(resume, texts, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(L.CODEX, ['app-server'], { cwd: L.PROJ, env: L.childEnv() });
    let buffer = '', id, turn = 0, ended = false;
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    const end = error => { if (ended) return; ended = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve(id); };
    const timer = setTimeout(() => end(new Error('App proof timed out')), 240000);
    child.stderr.on('data', () => {});
    child.on('error', end);
    child.on('exit', () => { if (!ended) end(new Error('App proof exited early')); });
    const next = () => send({ id: 10 + turn, method: 'turn/start', params: { threadId: id, input: [{ type: 'text', text: texts[turn++] }] } });
    child.stdout.on('data', data => {
      const lines = (buffer + data).split('\n'); buffer = lines.pop();
      for (const line of lines) {
        const m = JSON.parse(line);
        if (m.method && m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'declined' } });
        else if (m.error) end(new Error('App request failed: ' + m.error.code));
        else if (m.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: resume ? 'thread/resume' : 'thread/start', params: {
            ...(resume ? { threadId: resume } : {}), cwd: L.PROJ, model: process.env.GFPROOF_MODEL,
            sandbox: 'read-only', approvalPolicy: 'never', ...(config ? { config } : {}),
          } });
        } else if (m.id === 2) { id = m.result.thread.id; next(); }
        else if (m.method === 'turn/completed') {
          if (m.params.turn.status !== 'completed') appFailed++;
          if (turn < texts.length) next();
          else setTimeout(() => end(), 500);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'gfproof', title: null, version: '0' } } });
  });
}

if (process.argv[2] === 'observe') {
  if (L.ROOT.replaceAll('\\', '/').toLowerCase() !== 'd:/dev/gf-scratch/b23/live') throw new Error('Set the B23 scratch child folder');
  L.init();
  mkdirSync(join(L.ROOT, 'tmp'), { recursive: true });
  process.env.TEMP = process.env.TMP = join(L.ROOT, 'tmp');
  try {
    console.log(L.version());
    let execId;
    for (const [i, prompt] of prompts.slice(0, 3).entries()) {
      const run = await L.codex('cx4-exec-' + i, { specs, agents, resume: execId, prompt });
      if (!run.threadId) throw new Error('Exec proof made no thread');
      if (run.status !== 0) execFailed++;
      execId ??= run.threadId;
      console.log('exec turns completed ' + (i + 1));
    }
    L.configure(`${L.OUT}/cx4-app`, specs, { agents });
    await L.trustAll();
    const appId = await app(null, prompts.slice(0, 3));
    console.log('app turns completed 3');
    await app(appId, prompts.slice(3));
    const result = { exec: { ...counts(execId), failedTurns: execFailed }, app: { ...counts(appId), failedTurns: appFailed } };
    const dir = join(L.ROOT, 'app-sessions/2026/10/19');
    mkdirSync(dir, { recursive: true });
    copyFileSync(L.rollout(appId).file, join(dir, 'rollout-proof.jsonl'));
    writeFileSync(join(L.OUT, 'cx4-counts.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { L.finish(); }
} else if (process.argv[2] === 'live') {
  if (L.ROOT.replaceAll('\\', '/').toLowerCase() !== 'd:/dev/gf-scratch/b23/live') throw new Error('Set the B23 scratch child folder');
  L.init();
  mkdirSync(join(L.ROOT, 'tmp'), { recursive: true });
  process.env.TEMP = process.env.TMP = join(L.ROOT, 'tmp');
  const limit = Number(process.env.GFPROOF_LIMIT ?? 20000), turns = Number(process.env.GFPROOF_TURNS ?? 8), size = Number(process.env.GFPROOF_WORDS ?? 600);
  try {
    console.log(L.version());
    L.configure(`${L.OUT}/cx4-live`, [], { agents });
    await L.trustAll();
    const texts = Array.from({ length: turns }, (_, i) => `Rule ${i + 1}: keep the ${words[i * 3 % words.length]} ledger in plain text and never move the ${words[i * 5 % words.length]} gate. Now write about ${size} words of invented harbour log, in plain sentences.`);
    const appId = await app(null, texts, { model_auto_compact_token_limit: limit });
    const result = { ...counts(appId), failedTurns: appFailed, limit, turns };
    const dir = join(L.ROOT, 'app-sessions/2026/10/19');
    mkdirSync(dir, { recursive: true });
    copyFileSync(L.rollout(appId).file, join(dir, 'rollout-live.jsonl'));
    writeFileSync(join(L.OUT, 'cx4-live-counts.json'), JSON.stringify({ ...result, shapes: undefined }, null, 2));
    console.log(JSON.stringify({ ...result, shapes: undefined }));
  } finally { L.finish(); }
} else if (process.argv[2] === 'retro') {
  const result = spawnSync(process.execPath, [join(L.here, '../../../bin/goldfished.mjs'), 'retro', '--agent', 'codex', '--dir', join(L.ROOT, 'app-sessions'), '--json'],
    { encoding: 'utf8', env: L.childEnv(), timeout: 240000 });
  writeFileSync(join(L.OUT, 'cx4-retro.json'), result.stdout);
  console.log('retro exit ' + result.status);
  const files = await adapter.listFiles(join(L.ROOT, 'app-sessions'));
  const report = JSON.parse(result.stdout);
  const tally = { files: 0, bytes: 0, lines: 0, malformed: 0, skippedLong: 0, types: new Map(), rejects: new Map(), compactLike: 0, understood: 0, lineBuckets: [] };
  let sessions = 0, typed = 0, compactions = 0, automated = 0, labelled = 0;
  const ages = {};
  for await (const session of adapter.sessions(files, tally)) {
    sessions++; typed += session.typed.length; compactions += session.compactions.length; automated += Number(session.auto);
    const fold = foldSession(session, grader, { sampleSeed: 1 });
    labelled += fold.labelled;
    for (const [age, c] of [...fold.ages].sort((x, y) => x[0] - y[0])) ages[age] = c;
  }
  console.log(JSON.stringify({ sessions, typed, compactions, automated, graded: labelled, drift: !adapter.driftCheck(tally).ok, kept: ages,
    json: report.agents.map(a => ({ status: a.status, sessions: a.sessions, messages: a.messages, compacted: a.compacted })) }));
} else if (process.argv[2] === 'counts') {
  const result = {};
  for (const file of readdirSync(join(L.HOME, 'sessions'), { recursive: true }).filter(file => file.endsWith('.jsonl'))) {
    const meta = JSON.parse(readFileSync(join(L.HOME, 'sessions', file), 'utf8').split('\n')[0]).payload;
    result[meta.source === 'exec' ? 'exec' : 'app'] = counts(meta.id);
  }
  writeFileSync(join(L.OUT, 'cx4-counts.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
