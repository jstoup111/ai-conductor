import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Kill-switch: blocks the pr-labels production gh/git runners from shelling
    // out during tests (sets AI_CONDUCTOR_NO_REAL_EXEC). See test/setup.ts.
    setupFiles: ['./test/setup.ts'],
  },
});
