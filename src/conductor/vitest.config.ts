import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Global guard: never spawn a real build daemon during the suite (see test/setup.ts).
    setupFiles: ['./test/setup.ts'],
  },
});
