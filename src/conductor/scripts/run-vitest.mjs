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
// Each unsharded aggregate run retains the complete test-result graph until
// teardown. Keep the worker limit bounded; the aggregate is split below so
// that graph cannot consume a worker's entire heap.
const VITEST_WORKER_HEAP_LIMIT_MB = 12288;

function workerHeapOptions(nodeOptions = '') {
  const match = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)(?=\s|$)/.exec(nodeOptions);
  if (match && Number(match[1]) >= VITEST_WORKER_HEAP_LIMIT_MB) return nodeOptions;

  const withoutHeapLimit = nodeOptions
    .replace(/(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)\d+(?=\s|$)/g, ' ')
    .trim();
  return `${withoutHeapLimit}${withoutHeapLimit ? ' ' : ''}--max-old-space-size=${VITEST_WORKER_HEAP_LIMIT_MB}`;
}
// A managed daemon process uses this private bypass to keep its PATH-level gh
// observer from recursing.  Test fixtures own their own gh boundary, so passing
// the bypass through makes production adapters escape those fixtures.
const { CONDUCT_GH_REAL_EXECUTABLE: _managedGhObserverBypass, ...testEnvironment } = process.env;
const vitestArgs = process.argv.slice(2);
const hasSelector = vitestArgs.some((argument) => argument !== 'run' && !argument.startsWith('-'));
const hasShard = vitestArgs.some((argument) => argument === '--shard' || argument.startsWith('--shard='));
// A full run retains all results in its coordinator until teardown. Running
// thirty-two bounded shards releases that graph between children. The largest
// sixteen-way shard still exceeds the worker ceiling on this suite. Explicit selectors
// and CI's already-sharded runs must retain their caller-provided semantics.
const invocations = hasSelector || hasShard
  ? [vitestArgs]
  : Array.from({ length: 32 }, (_, index) => [...vitestArgs, `--shard=${index + 1}/32`]);
const childEnvironment = {
  ...testEnvironment,
  AI_CONDUCTOR_TEST_TMP_ROOT: runRoot,
  TMPDIR: runRoot,
  // Native subprocesses do not consistently prefer TMPDIR: some read TMP
  // or TEMP first. Keep all three aliases inside the run root so they
  // cannot bypass the global tmpdir leak guard.
  TMP: runRoot,
  TEMP: runRoot,
  NODE_OPTIONS: workerHeapOptions(testEnvironment.NODE_OPTIONS),
};
let child;

const forwardedSignals = ['SIGINT', 'SIGTERM'];
for (const signal of forwardedSignals) process.once(signal, () => child?.kill(signal));

let result = { code: 0, signal: null };
try {
  for (const args of invocations) {
    child = spawn(vitestCommand, args, { env: childEnvironment, stdio: 'inherit' });
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0 || result.signal !== null) break;
  }
} finally {
  if (installation.ownsRoot) rmSync(runRoot, { recursive: true, force: true });
}

const { code, signal } = result;

if (signal !== null) {
  console.error(`[run-vitest] vitest terminated by signal ${signal}`);
  process.kill(process.pid, signal);
} else {
  if (code !== 0) console.error(`[run-vitest] vitest exited with code ${code ?? 1}`);
  process.exitCode = code ?? 1;
}
