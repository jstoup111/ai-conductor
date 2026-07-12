import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Global guards (see test/setup.ts): never spawn a real build daemon, and
    // block the pr-labels gh/git seam from real exec (AI_CONDUCTOR_NO_REAL_EXEC).
    setupFiles: ['./test/setup.ts'],
    // Global setup/teardown (see test/global-setup.ts): detect and fail on any
    // .pipeline leak into the test cwd. This guards against the specific bug
    // where the conductor suite pollutes its own working directory.
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 3, minForks: 1 } },
    testTimeout: 10000,
  },
});
