import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const runRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai-conductor-vitest-run-')));
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
  rmSync(runRoot, { recursive: true, force: true });
});

if (signal !== null) {
  process.kill(process.pid, signal);
} else {
  process.exitCode = code ?? 1;
}
