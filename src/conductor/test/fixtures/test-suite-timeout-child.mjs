import { spawn } from 'node:child_process';

const sentinelPath = process.argv[2];
if (sentinelPath === undefined) throw new Error('sentinel path is required');

const descendant = spawn(
  process.execPath,
  [
    '-e',
    `const { writeFileSync } = require('node:fs');
process.on('SIGTERM', () => undefined);
setTimeout(() => writeFileSync(${JSON.stringify(sentinelPath)}, 'survived'), 250);
setTimeout(() => process.exit(0), 450);`,
  ],
  { stdio: 'ignore' },
);
descendant.unref();

process.on('SIGTERM', () => undefined);
setTimeout(() => process.exit(0), 450);
