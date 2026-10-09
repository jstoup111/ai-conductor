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
// A managed daemon process uses this private bypass to keep its PATH-level gh
// observer from recursing.  Test fixtures own their own gh boundary, so passing
// the bypass through makes production adapters escape those fixtures.
const { CONDUCT_GH_REAL_EXECUTABLE: _managedGhObserverBypass, ...testEnvironment } = process.env;
const child = spawn(vitestCommand, process.argv.slice(2), {
  env: {
    ...testEnvironment,
    AI_CONDUCTOR_TEST_TMP_ROOT: runRoot,
    TMPDIR: runRoot,
    // Native subprocesses do not consistently prefer TMPDIR: some read TMP
    // or TEMP first. Keep all three aliases inside the run root so they
    // cannot bypass the global tmpdir leak guard.
    TMP: runRoot,
    TEMP: runRoot,
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
