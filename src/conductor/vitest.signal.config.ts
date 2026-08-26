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
    pool: 'threads',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
