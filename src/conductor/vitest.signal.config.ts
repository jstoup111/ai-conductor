import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// Keep this signal-simulation suite in the same run-scoped tmpdir contract as
// the forked aggregate batches.
ensureRunTmpRootSync(tmpdir());

export default defineConfig({
  test: {
    include: ['test/engine/deterministic-build-verification-group.test.ts'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // This suite deliberately exercises the Conductor SIGHUP handler. A
    // thread worker shares its process with Vitest's coordinator, so the
    // simulated signal terminates the runner instead of just the test worker.
    // Keep the one excluded file in a single fork: it preserves process
    // isolation without consuming the ordinary suite's two-fork budget.
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
