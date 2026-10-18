// A hook that does nothing useful. It writes what it was handed, and what it said back, to a file.
// argv: <outdir> <tag> <event> <mode> [a] [b]
import { writeFileSync } from 'node:fs';

const [out, tag, event, mode, a, b] = process.argv.slice(2);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let reply = null;
  const wrap = (extra) => ({ hookSpecificOutput: { hookEventName: event, ...extra } });
  if (mode === 'ctx') {
    const n = Number(a);
    const ch = b === 'cjk' ? String.fromCharCode(0x6f22) : 'x';
    const head = `[${tag}]`;
    const tail = `[END${tag}]`;
    reply = wrap({ additionalContext: head + ch.repeat(n - head.length - tail.length) + tail });
  } else if (mode === 'say') reply = wrap({ additionalContext: a });
  else if (mode === 'both') reply = { ...wrap({ additionalContext: a }), systemMessage: b };
  else if (mode === 'sys') reply = { systemMessage: a };
  else if (mode === 'block') reply = { decision: 'block', reason: a };
  const sent = reply ? JSON.stringify(reply) : '';
  const name = `${tag}-${event}-${Date.now()}-${process.pid}.json`;
  writeFileSync(`${out}/${name}`, JSON.stringify({ tag, event, mode, at: Date.now(), stdin: raw, sent, code: 0 }));
  if (sent) process.stdout.write(sent);
});
