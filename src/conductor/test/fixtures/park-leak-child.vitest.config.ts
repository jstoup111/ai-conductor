import '../../vitest.config.js';
import { defineConfig } from 'vitest/config';

// Importing the real config executes its module-scope containment install.
// This child process must not also run global teardown: that lifecycle owns
// the parent Vitest run root inherited by nested Vite state. The enclosing
// disposable repository in park-leak-guard.test.ts owns this child's root.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    // The parent suite already uses two forks. This nested one-test fixture
    // must remain serial so it cannot push the aggregate run beyond its
    // memory ceiling.
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
