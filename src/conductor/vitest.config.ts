import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Global guards (see test/setup.ts): never spawn a real build daemon, and
    // block the pr-labels gh/git seam from real exec (AI_CONDUCTOR_NO_REAL_EXEC).
    setupFiles: ['./test/setup.ts'],
  },
});
