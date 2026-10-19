#!/usr/bin/env node
import { commands as card } from '../src/cli/card.mjs';
import { commands as init } from '../src/cli/init.mjs';
import { commands as misc } from '../src/cli/misc.mjs';
import { commands as probe } from '../src/cli/probe.mjs';
import { commands as retro } from '../src/cli/retro.mjs';
import { main } from '../src/hook.mjs';

const commands = { ...card, ...init, ...misc, ...probe, ...retro }, values = new Set(['agent', 'agents', 'dir', 'days', 'quote', 'note', 'saw']);
const argv = process.argv.slice(2), positional = [], flags = {}, named = argv[0] !== undefined && !argv[0].startsWith('-');
const name = named ? argv.shift() : 'retro';
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
  if (arg === '-h') flags.help = true;
  else if (arg.startsWith('--')) {
    const equal = arg.indexOf('='), key = arg.slice(2, equal < 0 ? undefined : equal);
    flags[key] = equal >= 0 ? arg.slice(equal + 1) : values.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  } else if (arg.startsWith('-')) flags[arg.slice(1)] = true;
  else positional.push(arg);
}
process.stdout.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const now = new Date(), pad = n => String(n).padStart(2, '0'), io = {
  out: s => process.stdout.write(s + (s.endsWith('\n') ? '' : '\n')),
  err: s => process.stderr.write(s + (s.startsWith('\r') || s.endsWith('\n') ? '' : '\n')),
  isTTY: Boolean(process.stdin.isTTY), outTTY: Boolean(process.stdout.isTTY), errTTY: Boolean(process.stderr.isTTY),
  env: process.env, cwd: process.cwd(), nowMs: now.getTime(), today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
};
try {
  if (name === 'hook') {
    if (flags.help) io.out('goldfished hook <agent> <event>');
    else if (Object.keys(flags).length || positional.length !== 2) { io.err('goldfished: invalid hook arguments. Try: goldfished hook --help'); process.exitCode = 1; }
    else { let input = ''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) input += chunk; await main(...positional, input); }
  } else if (!named && flags.help && !positional.length && Object.keys(flags).length === 1)
    io.out(`usage: goldfished [command] [options]\ncommands: ${Object.keys(commands).join(', ')}\nNo command runs retro. Try: goldfished <command> --help`);
  else if (!Object.hasOwn(commands, name)) { io.err('goldfished: unknown command. Try: goldfished --help'); process.exitCode = 1; }
  else process.exitCode = await commands[name]({ positional, flags }, io);
} catch (error) {
  io.err(`goldfished: could not run ${name}. Check your files and try again.`);
  if (io.env.GOLDFISHED_DEBUG === '1') io.err(error?.stack ?? String(error));
  process.exitCode = 1;
}
