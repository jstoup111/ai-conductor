import { defineConfig } from 'vitest/config';

/**
 * The N=1 coordinator starts a second Vitest process while the enclosing
 * suite is still active. Its launcher still gives the child a dedicated temp
 * root and this config retains the ordinary worker safety setup, but the
 * enclosing global teardown is the sole authority for shared /tmp leaks.
 * Running a second real-tmpdir guard here would attribute concurrent outer
 * workers' fixtures to the nested child.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
