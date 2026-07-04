import { snapshotPipeline, diffPipeline } from './pipeline-leak-guard.js';

/**
 * Global vitest setup/teardown: detect .pipeline leaks during test runs.
 *
 * This is the vitest globalSetup entry point (see vitest.config.ts).
 * On test suite startup, we snapshot the .pipeline directory state.
 * After all tests complete, we re-snapshot and diff. If any files were
 * added or modified in .pipeline, we fail the suite with a detailed error.
 *
 * TRIP TEST CASE (manual verification):
 * To verify the guard works, temporarily add a file to .pipeline during a test:
 *   1. Add `await mkdir(join(process.cwd(), '.pipeline'), { recursive: true });`
 *   2. Add `await writeFile(join(process.cwd(), '.pipeline', 'HALT'), 'leak');`
 *      to any .test.ts file (e.g., in backlog-priority.test.ts afterEach cleanup)
 *   3. Run tests: expect teardown to fail with ".pipeline leak into <cwd>"
 *   4. Remove the plant and re-run: suite passes silently
 *
 * Once verified, this guard is active for all future test runs.
 */
export default async function setup() {
  const beforeState = await snapshotPipeline(process.cwd());

  // Return the async teardown function
  return async () => {
    const afterState = await snapshotPipeline(process.cwd());
    const diff = diffPipeline(beforeState, afterState);

    if (diff.added.length > 0 || diff.modified.length > 0) {
      const leakedFiles = [...diff.added, ...diff.modified].join(', ');
      throw new Error(
        `.pipeline leak into ${process.cwd()} during test run: ${leakedFiles}`
      );
    }
  };
}
