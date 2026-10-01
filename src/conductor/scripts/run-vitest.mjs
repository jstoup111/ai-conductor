import { existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installVitestTmpRoot } from './vitest-temp.mjs';

const installation = installVitestTmpRoot({ fresh: true });
const runRoot = installation.root;
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageVitest = join(packageRoot, 'node_modules', '.bin', 'vitest');
const vitestCommand = existsSync(packageVitest) ? packageVitest : 'vitest';
const defaultOldSpaceLimit = '--max-old-space-size=6144';
const inheritedNodeOptions = process.env.NODE_OPTIONS ?? '';
const nodeOptions = /(?:^|\s)--max-old-space-size(?:=|\s)/.test(inheritedNodeOptions)
  ? inheritedNodeOptions
  : [inheritedNodeOptions, defaultOldSpaceLimit].filter(Boolean).join(' ');
const child = spawn(vitestCommand, process.argv.slice(2), {
  env: {
    ...process.env,
    AI_CONDUCTOR_TEST_TMP_ROOT: runRoot,
    TMPDIR: runRoot,
    NODE_OPTIONS: nodeOptions,
  },
  stdio: 'inherit',
});

const forwardedSignals = ['SIGINT', 'SIGTERM'];
for (const signal of forwardedSignals) {
  process.once(signal, () => child.kill(signal));
}

const { code, signal } = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (exitCode, exitSignal) => resolve({
    code: exitCode,
    signal: exitSignal,
  }));
}).finally(() => {
  if (installation.ownsRoot) rmSync(runRoot, { recursive: true, force: true });
});

if (signal !== null) {
  process.kill(process.pid, signal);
} else {
  process.exitCode = code ?? 1;
}
