import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// Keep the ordinary suite's environment, setup, global teardown, and leak
// guards while selecting this explicit opt-in smoke file only. Vitest merges
// `exclude` arrays additively, so this deliberately does not merge the default
// config that excludes every `*.smoke.test.ts` file.
ensureRunTmpRootSync(tmpdir());

export default defineConfig({
  test: {
    include: ['test/engine/daemon-e2e-live.smoke.test.ts'],
    exclude: [],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 3, minForks: 1 } },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
