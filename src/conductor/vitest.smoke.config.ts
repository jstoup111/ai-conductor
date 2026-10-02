import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// Smoke tests are opt-in, but retain the ordinary suite's runtime guards.
// Vitest merges `exclude` arrays additively, so replace the default smoke
// exclusions while keeping checkout-local Vitest fixtures out of discovery.
ensureRunTmpRootSync();

export default defineConfig({
  test: {
    include: ['test/smoke/**', '**/*.smoke.test.ts'],
    exclude: ['**/.vitest-tmp/**'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 3,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
