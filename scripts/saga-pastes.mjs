import { readFileSync } from 'node:fs';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (ms) => new Date(Date.UTC(2026, 3, 3) + ms).toISOString().slice(0, 19) + 'Z';
const MON = ['Apr', 'May'];
const WORDS = ['weight', 'temp', 'humidity', 'battery', 'tare', 'clock', 'uplink', 'sample', 'brood', 'frame'];
const STATS = ['raw', 'avg', 'min', 'max', 'offset', 'status', 'count', 'step'];
const NOTES = ['Updated at the end of each sample window.', 'Cleared when the scale restarts.', 'Read only.',
  'Held until the next uplink slot.', 'Signed, two complement.', 'Zero while the scale is warming up.'];
const MODULES = ['ingest', 'parse', 'store', 'poll', 'alerts'];
const FRAMES = [['ingest.py', 'poll_once', 'rows = parse_file(path)'], ['parse.py', 'parse_file', 'return [parse_row(l, n) for n, l in enumerate(fh, 1)]'],
  ['parse.py', 'parse_row', 'weight = int(fields[3])', "ValueError: invalid literal for int() with base 10: 'n/a'"],
  ['store.py', 'save_batch', 'cur.executemany(SQL_INSERT, batch)', 'OperationalError: database is locked'],
  ['clock.py', 'to_epoch', 'return calendar.timegm(time.strptime(text, FMT))', "ValueError: time data '2026-04-03 25:10' does not match format"]];
const KEYS = ['sample_interval_s', 'tare_offset_g', 'uplink_slot', 'batt_cutoff_mv', 'file_stamp_fmt', 'warmup_s', 'burst_limit', 'retry_wait_s'];

const KINDS = {
  log: (r, p, i) => {
    const ts = stamp(i * 41000 + Math.floor(r() * 30000)), h = `h${pad(1 + Math.floor(r() * 40))}`, y = pad(1 + Math.floor(r() * 6));
    const file = `incoming/yard-${y}/202604${pad(3 + (i % 20))}-${pad(i % 24)}${pad(10 * (i % 6))}.csv`;
    const m = MODULES[Math.floor(r() * MODULES.length)], d = Math.floor(r() * 900);
    const pool = [`INFO read ${file} rows=${7 + (d % 4)} ms=${20 + (d % 90)}`, `INFO stored ${6 + (d % 5)} readings for yard-${y}`,
      `DEBUG poll found ${d % 9} new files`, `WARN ${h} weight step ${d} g inside one hour`, `WARN ${h} brood temp ${(150 + d % 250) / 10} C looks off`,
      `WARN ${h} no reading for ${10 + (d % 80)} min`, `ERROR could not parse ${file} line ${1 + (d % 12)}: bad weight field`];
    return `${ts} ${pool[Math.floor(r() * pool.length)].replace(' ', ` ${p.project}.${m} `)}`;
  },
  csv: (r, p, i, st) => {
    const h = i % 40, w = (st.w[h] = (st.w[h] ?? 26000 + h * 450) + Math.floor(r() * 90) - 38);
    const flag = r() < 0.04 ? ['gap', 'spike', 'low_batt'][Math.floor(r() * 3)] : '';
    return `${stamp(Math.floor(i / 40) * 600000)},yard-${pad(1 + (h % 6))},h${pad(h + 1)},${w},${180 + Math.floor(r() * 160)},${3300 + Math.floor(r() * 700)},${flag}`;
  },
  stack: (r, p, i) => {
    const end = 2 + Math.floor(r() * 3), n = 3 + Math.floor(r() * 3);
    const body = FRAMES.slice(Math.max(0, end - n + 1), end + 1).map(([f, fn, src]) => `  File "${p.cwd}/${p.project}/${f}", line ${20 + Math.floor(r() * 180)}, in ${fn}\n    ${src}`);
    return `${stamp(i * 52000)} ERROR batch ${i} failed\nTraceback (most recent call last):\n${body.join('\n')}\n${FRAMES[end][3]}\n`;
  },
  listing: (r, p, i) => {
    const y = pad(1 + (Math.floor(i / 120) % 6)), at = Date.UTC(2026, 3, 3) + i * 600000, dt = new Date(at);
    const head = i % 120 === 0 ? `\n./incoming/yard-${y}:\ntotal ${400 + Math.floor(r() * 300)}\n` : '';
    return `${head}-rw-r--r--  1 comb  comb  ${String(1700 + Math.floor(r() * 400)).padStart(5)} ${MON[dt.getUTCMonth() - 3] ?? 'Jun'} ${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())} ${dt.toISOString().slice(0, 10).replaceAll('-', '')}-${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}.csv`;
  },
  spec: (r, p, i) => {
    const name = `${WORDS[i % WORDS.length]}_${STATS[Math.floor(r() * STATS.length)]}`, addr = (0x40 + i * 4).toString(16).toUpperCase().padStart(4, '0');
    const sect = i % 24 === 0 ? `\n${Math.floor(i / 24) + 3}. Register block ${Math.floor(i / 24) + 1}\n` : '';
    const note = NOTES[Math.floor(r() * NOTES.length)];
    return `${sect}0x${addr}  ${name.padEnd(16)} ${['u16', 'u32', 'i16', 'i32'][Math.floor(r() * 4)]}  ${['g', 'mg', 'C/10', 'mV', 's'][Math.floor(r() * 5)].padEnd(5)} ${WORDS[i % WORDS.length]} ${name.split('_')[1]} value, sampled every ${10 + Math.floor(r() * 50)} s. ${note}`;
  },
  diff: (r, p, i) => {
    const file = `firmware/sched-${pad(1 + (i % 9))}.cfg`, a = 4 + Math.floor(r() * 60), k = Math.floor(r() * KEYS.length);
    const ctx = [1, 2, 3].map((j) => ` ${KEYS[(k + j) % KEYS.length]}=${Math.floor(r() * 500)}`);
    return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${a},7 +${a},7 @@\n${ctx[0]}\n-${KEYS[k]}=${Math.floor(r() * 900)}\n+${KEYS[k]}=${Math.floor(r() * 900)}\n${ctx[1]}\n${ctx[2]}`;
  },
};

const HEAD = {
  csv: 'ts,yard,hive,weight_g,brood_c10,battery_mv,flag',
  listing: 'incoming: file listing',
  spec: 'Hive scale register map, revision C',
};

export function renderPaste(spec, project) {
  const make = KINDS[spec.kind];
  if (!make) throw new Error(`unknown paste kind ${spec.kind}`);
  const r = rng(spec.seed), st = { w: [] }, want = spec.tokens * 4;
  const out = HEAD[spec.kind] ? [HEAD[spec.kind]] : [];
  let size = out.join('\n').length;
  for (let i = 0; size < want; i++) {
    const part = make(r, project, i, st);
    out.push(part);
    size += part.length + 1;
  }
  return out.join('\n');
}

export function renderStory(path) {
  const [head, ...turns] = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lines = turns.map(({ paste, ...turn }) => JSON.stringify(paste ? { ...turn, text: `${turn.text}\n\n${renderPaste(paste, head)}` } : turn));
  return [JSON.stringify(head), ...lines].join('\n') + '\n';
}
