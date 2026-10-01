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
// The ordinary suite's final worker exceeded 6 GiB after completing 1,158 of
// 1,159 files. Keep two forks (rather than adding a third) so this 8 GiB
// per-worker minimum remains within the self-host user-slice ceiling.
const defaultOldSpaceLimit = '--max-old-space-size=8192';
const inheritedNodeOptions = process.env.NODE_OPTIONS ?? '';
const inheritedOldSpaceLimit = /(?:^|\s)--max-old-space-size(?:=|\s+)(\d+)(?=\s|$)/.exec(inheritedNodeOptions);
const nodeOptions = inheritedOldSpaceLimit !== null && Number(inheritedOldSpaceLimit[1]) >= 8192
  ? inheritedNodeOptions
  : [
    inheritedNodeOptions.replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+(?=\s|$)/, '').trim(),
    defaultOldSpaceLimit,
  ].filter(Boolean).join(' ');
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
