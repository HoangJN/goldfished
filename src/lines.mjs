import { createReadStream } from 'node:fs';

export async function* readLines(file, { mayNeed } = {}) {
  const totals = { lines: 0, bytes: 0, skippedLong: 0, lineBuckets: [] };
  let parts = [], length = 0, prefix = Buffer.alloc(0), dropped = false, checked = false;
  function finish(partial = false) {
    const n = ++totals.lines, bucket = Math.floor(Math.log2(Math.max(1, length)));
    totals.lineBuckets[bucket] = (totals.lineBuckets[bucket] ?? 0) + 1;
    let line;
    if (dropped) totals.skippedLong++;
    else {
      let text = Buffer.concat(parts, length).toString('utf8');
      if (n === 1) text = text.replace(/^\uFEFF/u, '');
      text = text.replace(/\r$/u, '');
      line = partial ? { n, text, partial: true } : { n, text };
    }
    parts = []; length = 0; prefix = Buffer.alloc(0); dropped = false; checked = false;
    return line;
  }
  for await (const chunk of createReadStream(file)) {
    totals.bytes += chunk.length;
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
      const part = chunk.subarray(start, stop);
      length += part.length;
      if (!dropped) {
        if (prefix.length < 4096) prefix = Buffer.concat([prefix, part.subarray(0, 4096 - prefix.length)]);
        if (length > 16 * 1024 * 1024 && !checked) {
          checked = true;
          dropped = mayNeed ? !mayNeed(prefix.toString('utf8').replace(/^\uFEFF/u, '')) : false;
        }
        if (dropped) parts = []; else parts.push(part);
      }
      if (end >= 0) { const line = finish(); if (line) yield line; }
      start = stop + 1;
    }
  }
  if (length) { const line = finish(true); if (line) yield line; }
  return totals;
}
