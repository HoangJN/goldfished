import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const profile = JSON.parse(readFileSync(new URL('../bench/profile.json', import.meta.url), 'utf8'));
const MiB = 2 ** 20, GiB = 2 ** 30;
const prose = 'Copper lanterns lit the invented harbour. The tide carried empty boats towards the stone bridge. ';
const padding = n => prose.repeat(Math.ceil(n / prose.length)).slice(0, n);
function random(seed) {
  return () => { let t = seed += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function writeFile(file, produce) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'wx'); let pending = '', bytes = 0;
  const flush = () => { const data = Buffer.from(pending); let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset); bytes += data.length; pending = ''; };
  try { produce(row => { pending += JSON.stringify(row) + '\n'; if (pending.length >= MiB) flush(); }); flush(); }
  finally { closeSync(fd); }
  return bytes;
}
export function generateBench({ gib, seed = 1, out, longLines = true }) {
  if (!Number.isFinite(gib) || gib <= 0 || !Number.isSafeInteger(seed) || !out) throw new Error('Invalid benchmark options');
  const budget = Math.round(gib * GiB), rng = random(seed), manifest = {};
  for (const agent of ['claude-code', 'codex']) {
    const cc = agent === 'claude-code', cfg = profile[agent], files = cfg.files;
    const huge = longLines ? 64 * MiB : 0;
    if (budget < huge + files * 4096) throw new Error('Dataset is too small for this profile');
    const weights = Array.from({ length: files }, () => cc ? Math.exp(cfg.logSigma *
      Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())) : 1);
    if (!cc) weights[0] = files - 1;
    const weight = weights.reduce((a, b) => a + b, 0), mean = profile.normalLineBytes + (cc && longLines ? 4.5 * MiB / 1000 : 0);
    const total = Math.floor((budget - huge) / mean), minimum = cc ? 700 : 2;
    const counts = weights.map((w, i) => Math.max(cc && i < 3 ? minimum : 2, Math.floor(total * w / weight)));
    const lengths = new Map(), overheads = [], normals = [];
    let index = 0, overhead = 0, normal = 0, typed = 0, compactions = 0;
    const rows = (i, emit) => {
      const id = `bench-${seed}-${i}`, count = counts[i];
      let serial = 0;
      const stamp = () => new Date(Date.UTC(2026, 0, 1) + serial++ * 1000).toISOString();
      const user = (text, summary = false) => ({ type: 'user', uuid: `${id}-${serial}`, parentUuid: null,
        timestamp: stamp(), sessionId: id, cwd: '/srv/invented/harbour', version: '2.1.292',
        ...(summary ? { isCompactSummary: true } : { turnOrigin: 'human' }), message: { role: 'user', content: text } });
      emit({ _synthetic: true, note: 'Invented harbour benchmark.' });
      if (!cc) emit({ timestamp: stamp(), type: 'session_meta', payload: { id, cwd: '/srv/invented/harbour',
        cli_version: '0.163.0', source: 'cli', originator: 'codex_cli_rs' } });
      const boundaries = cc ? (i < cfg.deepFiles ? cfg.deepCompactions : i < files * cfg.compactedFraction ? 1 : 0) : 1;
      for (let j = 0; j < count; j++) {
        const k = index++, isLong = cc && longLines && k % 1000 === 999, human = k % 100 < 3;
        const text = human ? `Keep the harbour ledger in plain text. Invented turn ${seed}-${i}-${j}.` : '';
        const row = cc ? human ? user(text) : { type: 'assistant', uuid: `${id}-${serial}`, timestamp: stamp(),
          sessionId: id, message: { role: 'assistant', content: [{ type: 'text', text: '' }] } } :
          human ? { timestamp: stamp(), type: 'event_msg', payload: { type: 'user_message', message: text } } :
            { timestamp: stamp(), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] } };
        emit(row, { k, isLong, human });
        if (Math.floor((j + 1) * boundaries / count) > Math.floor(j * boundaries / count)) {
          if (cc) {
            emit({ type: 'system', subtype: 'compact_boundary', uuid: `${id}-b${j}`, timestamp: stamp(),
              sessionId: id, compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 21000 } });
            emit(user('Keep the harbour ledger in plain text.', true));
          } else emit({ timestamp: stamp(), type: 'compacted', payload: { message: 'Keep the harbour ledger in plain text.', replacement_history: [] } });
        }
      }
      if (i === 0 && huge) emit(cc ? { type: 'assistant', uuid: `${id}-huge`, timestamp: stamp(),
        message: { role: 'assistant', content: [{ type: 'text', text: '' }] } } :
        { timestamp: stamp(), type: 'compacted', payload: { message: '',
          replacement_history: [{ type: 'compaction', encrypted_content: '' }] } }, { huge: true });
    };
    for (let i = 0; i < files; i++) {
      const before = overhead, prior = normal;
      rows(i, (row, info) => {
      overhead += JSON.stringify(row).length + 1;
      if (row.subtype === 'compact_boundary' || row.type === 'compacted') compactions++;
      if (info?.human) typed++;
      else if (info?.isLong) { const n = MiB + Math.floor(rng() * (7 * MiB + 1)) - JSON.stringify(row).length;
        lengths.set(info.k, n); overhead += n; }
      else if (info?.huge) overhead += huge - JSON.stringify(row).length;
      else if (info) normal++;
      });
      overheads.push(overhead - before); normals.push(normal - prior);
    }
    const remaining = budget - overhead, fill = Math.floor(remaining / normal); let extra = remaining % normal;
    if (fill < 0) throw new Error('Long lines exceed dataset budget');
    index = 0;
    const sizes = [];
    for (let i = 0; i < files; i++) {
      const target = i === 0 ? Math.floor(budget / 2) : Math.floor((budget - Math.floor(budget / 2)) * i / (files - 1)) -
        Math.floor((budget - Math.floor(budget / 2)) * (i - 1) / (files - 1));
      const content = target - overheads[i], width = cc ? fill : Math.floor(content / normals[i]);
      if (!cc) extra = content % normals[i];
      const filler = padding(width + 1);
      const folder = cc ? `harbour-${Math.floor(i / 20)}` : '2026/01/01';
      sizes.push(writeFile(join(out, agent, folder, `${cc ? '' : 'rollout-'}bench-${i}.jsonl`), emit => rows(i, (row, info) => {
        if (info && !info.human) {
          const n = info.huge ? huge - JSON.stringify(row).length : lengths.get(info.k) ?? width + Number(extra-- > 0);
          const text = info.huge || info.isLong ? padding(n) : filler.slice(0, n);
          if (cc) row.message.content[0].text = text;
          else if (info.huge) row.payload.replacement_history[0].encrypted_content = text;
          else row.payload.content[0].text = text;
        }
        emit(row);
      })));
    }
    manifest[agent] = { bytes: sizes.reduce((a, b) => a + b, 0), files, lines: index, typed, compactions,
      longLines: lengths.size, largestFile: Math.max(...sizes), minLong: lengths.size ? Math.min(...lengths.values()) : 0,
      maxLong: Math.max(0, ...lengths.values()) };
  }
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].slice(2);
    if (!['gib', 'seed', 'out'].includes(key) || !process.argv[i + 1]) throw new Error('Use --gib <n> --seed <s> --out <dir>');
    options[key] = key === 'out' ? process.argv[i + 1] : Number(process.argv[i + 1]);
  }
  console.log(JSON.stringify(generateBench(options)));
}
