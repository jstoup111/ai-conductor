import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// Smoke tests are opt-in, but retain the ordinary suite's runtime guards.
// Vitest merges `exclude` arrays additively, so this must override the default
// smoke exclusions rather than inherit them.
ensureRunTmpRootSync(tmpdir());

export default defineConfig({
  test: {
    include: ['test/smoke/**', '**/*.smoke.test.ts'],
    exclude: [],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 3,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
