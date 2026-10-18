#!/usr/bin/env node
const usage = 'usage: goldfished <command>  (nothing is built yet)';
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(usage);
  process.exit(0);
}

console.error(usage);
process.exit(1);
