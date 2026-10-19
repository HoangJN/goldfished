process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
process.exitCode = 0;
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { if (raw.length < 1 << 20) raw += c; });
process.stdin.on('end', async () => {
  try { await (await import('../src/hook.mjs')).main(process.argv[2], process.argv[3], raw); } catch {}
});
setTimeout(() => process.stdin.destroy(), 2000).unref();
