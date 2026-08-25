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
    maxWorkers: 3,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
