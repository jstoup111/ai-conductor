import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
import { ensureRunTmpRootSync } from './test/tmpdir-leak-guard.js';

// Tmpdir leak guard (#1112): point TMPDIR at ONE run-scoped root before vitest
// constructs anything. `os.tmpdir()` reads TMPDIR at call time, so every
// `mkdtemp(join(tmpdir(), …))` in the suite — the ~1,426 call sites, most of
// which never clean up — lands inside that root, and test/global-setup.ts
// deletes it wholesale at teardown. Installed here rather than in globalSetup
// because vitest's project tmpDir is computed before globalSetup (see
// ensureRunTmpRootSync). Package scripts install the redirect before Vitest 4
// itself loads; this idempotent call covers programmatic project creation.
// Forked workers inherit the env, proven by tmpdir-redirect-propagation.test.ts.
ensureRunTmpRootSync(tmpdir());

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/smoke/**', '**/*.smoke.test.ts'],
    environment: 'node',
    // Global guards (see test/setup.ts): never spawn a real build daemon, and
    // block the pr-labels gh/git seam from real exec (AI_CONDUCTOR_NO_REAL_EXEC).
    setupFiles: ['./test/setup.ts'],
    // Global setup/teardown (see test/global-setup.ts): detect and fail on any
    // .pipeline leak into the test cwd. This guards against the specific bug
    // where the conductor suite pollutes its own working directory.
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 3,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
