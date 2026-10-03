import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// End-to-end tier: real tmux sockets and whole-daemon drives. These files are
// excluded from the default suite (vitest.config.ts) because they are the
// slowest and most load-sensitive tests, and run instead in their own CI job
// (`npm run test:e2e`). They keep the ordinary suite's runtime guards. Vitest
// merges `exclude` arrays additively, so this overrides the default exclusions.
ensureRunTmpRootSync();

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    exclude: [],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
