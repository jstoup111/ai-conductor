import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { installVitestTmpRoot } from './vitest-temp.mjs';

const installation = installVitestTmpRoot({ fresh: true });
const runRoot = installation.root;
const child = spawn('vitest', process.argv.slice(2), {
  env: {
    ...process.env,
    AI_CONDUCTOR_TEST_TMP_ROOT: runRoot,
    TMPDIR: runRoot,
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
