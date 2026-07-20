/**
 * Tests for ci-fix.ts (Task 15–16: RETRY hint builder).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 */

import { describe, it, expect } from 'vitest';
import { buildCiFixHint, isEligibleForCiFix, runCiFix, productionCiFixRunner } from '../../src/engine/ci-fix.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { execSync } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fake GhRunner that returns check results and run logs.
 *
 * When `gh pr checks --json` is called, returns the `prChecks` response.
 * When `gh run view --log-failed` is called, returns the `runLogs` response.
 * Can optionally throw on specific commands.
 */
function makeFakeGhForHints(options: {
  prChecks: { stdout: string };
  runLogs?: { stdout: string };
  throwOnRunView?: boolean;
}): GhRunner {
  return async (args) => {
    // gh pr checks <url> --json
    if (args[0] === 'pr' && args[1] === 'checks' && args[args.length - 1] === '--json') {
      return options.prChecks;
    }

    // gh run view <run-id> --log-failed
    if (args[0] === 'run' && args[1] === 'view' && args.includes('--log-failed')) {
      if (options.throwOnRunView) {
        throw new Error('gh run view failed');
      }
      return options.runLogs || { stdout: '' };
    }

    return { stdout: '' };
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ci-fix: buildCiFixHint', () => {
  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const CWD = '/fake/repo';

  it('happy path: returns check name + log excerpt from one failed check', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'unit-tests',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/foo/bar/runs/123',
              },
            ],
          },
        ],
      }),
    };

    const runLogs = {
      stdout: `FAILED: unit-tests
line 1 of error
line 2 of error
line 3 of error
line 4 of error
line 5 of error
line 6 of error
line 7 of error
line 8 of error
line 9 of error
line 10 of error`,
    };

    const gh = makeFakeGhForHints({ prChecks, runLogs });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    expect(hint).toContain('unit-tests');
    expect(hint).toContain('line 1 of error');
    expect(hint).toContain('line 2 of error');
    // Should have bounded length, might not include all lines
    expect(hint.length).toBeLessThan(1000);
  });

  it('degradation: gh run view throws → hint contains check name + link, non-empty, no throw', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'lint-check',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/foo/bar/runs/456',
              },
            ],
          },
        ],
      }),
    };

    const gh = makeFakeGhForHints({ prChecks, throwOnRunView: true });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    // Hint must be non-empty
    expect(hint).toBeTruthy();
    expect(hint.length).toBeGreaterThan(0);
    // Must contain check name
    expect(hint).toContain('lint-check');
    // Must contain the link
    expect(hint).toContain('https://github.com/foo/bar/runs/456');
  });

  it('degradation: no run link present → hint contains check name, non-empty, no throw', async () => {
    const prChecks = {
      stdout: JSON.stringify({
        checkSuites: [
          {
            checkRuns: [
              {
                name: 'test-suite',
                conclusion: 'FAILURE',
                // No detailsUrl
              },
            ],
          },
        ],
      }),
    };

    const gh = makeFakeGhForHints({ prChecks });
    const hint = await buildCiFixHint(gh, CWD, PR_URL);

    // Hint must be non-empty
    expect(hint).toBeTruthy();
    expect(hint.length).toBeGreaterThan(0);
    // Must contain check name
    expect(hint).toContain('test-suite');
  });
});

// ── Tests for isEligibleForCiFix (Task 13) ────────────────────────────────────

describe('ci-fix: isEligibleForCiFix eligibility gates (Task 13)', () => {
  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const SLUG = 'foo/bar#42';
  const REPO_CWD = '/fake/repo';
  const NOW = new Date('2026-07-08T12:00:00Z');

  const defaultEntry: WatchEntry = {
    prUrl: PR_URL,
    slug: SLUG,
    repoCwd: REPO_CWD,
    ciFixAttempts: 0,
  };

  const defaultState: PrMergeState = {
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    hasFailingOrPendingChecks: true,
    labels: [],
    checksOutcome: 'failed',
  };

  const defaultConfig: HarnessConfig = {
    ci_watch: {
      enabled: true,
    },
  };

  it('eligible: all gates pass', async () => {
    const result = await isEligibleForCiFix(defaultEntry, defaultState, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 1 (cap): attempts >= 2 → ineligible with reason cap', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 2 };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cap');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('cap'))).toBe(true);
  });

  it('gate 1 (cap): attempts = 1 → eligible', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 1 };
    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 2 (sticky label): needs-remediation present → ineligible', async () => {
    const state = { ...defaultState, labels: ['needs-remediation'] };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('sticky');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('sticky'))).toBe(true);
  });

  it('gate 2 (sticky label): needs-remediation absent → eligible', async () => {
    const state = { ...defaultState, labels: ['mergeable', 'ci-failed'] };
    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('gate 3 (conflict): mergeable = CONFLICTING → ineligible', async () => {
    const state = { ...defaultState, mergeable: 'CONFLICTING' };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('conflict-precedence');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('conflict-precedence'))).toBe(true);
  });

  it('gate 3 (conflict): mergeable = MERGEABLE → eligible', async () => {
    const state = { ...defaultState, mergeable: 'MERGEABLE' };
    const result = await isEligibleForCiFix(defaultEntry, state, defaultConfig, NOW);
    expect(result.eligible).toBe(true);
  });

  it('multiple gate failures: first gate wins', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 2 };
    const state = { ...defaultState, labels: ['needs-remediation'] };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(entry, state, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    // Cap gate should reject first (attempt 2 >= cap 2)
    expect(result.reason).toContain('cap');
    // Only one outcome line logged
    expect(logs.filter((l) => l.includes('skipped')).length).toBe(1);
  });

  it('no counter change on skip', async () => {
    const entry = { ...defaultEntry, ciFixAttempts: 5 };
    const state = { ...defaultState, mergeable: 'CONFLICTING' };

    const result = await isEligibleForCiFix(entry, state, defaultConfig, NOW);

    expect(result.eligible).toBe(false);
    // Entry's ciFixAttempts should not be mutated
    expect(entry.ciFixAttempts).toBe(5);
  });
});

// ── Tests for isEligibleForCiFix (Task 14: serial guard + cooldown) ──────────

describe('ci-fix: isEligibleForCiFix eligibility gates (Task 14)', () => {
  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const SLUG = 'foo/bar#42';
  const REPO_CWD = '/fake/repo';
  const NOW = new Date('2026-07-08T12:00:00Z');

  const defaultEntry: WatchEntry = {
    prUrl: PR_URL,
    slug: SLUG,
    repoCwd: REPO_CWD,
    ciFixAttempts: 0,
  };

  const defaultState: PrMergeState = {
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    hasFailingOrPendingChecks: true,
    labels: [],
    checksOutcome: 'failed',
  };

  const defaultConfig: HarnessConfig = {
    ci_watch: {
      enabled: true,
    },
  };

  it('gate 4 (serial guard): when no resolution in flight → passes eligibility', async () => {
    // The serial guard checks isResolutionInFlight() which is a module-level flag
    // set by withResolveWorktree in autoresolve.ts. In test environment (no actual
    // resolution running), the flag is always false, so this gate always passes.
    // The actual guard behavior is tested via autoresolve integration tests.
    const result = await isEligibleForCiFix(defaultEntry, defaultState, defaultConfig, NOW);

    // With all conditions met and no resolution in flight, should be eligible
    expect(result.eligible).toBe(true);
  });

  it('gate 5 (cooldown): lastCiFixAt within cooldown → ineligible(cooldown)', async () => {
    // lastCiFixAt is 10 minutes ago, cooldown is 60 minutes by default
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60 * 1000);
    const entry = { ...defaultEntry, lastCiFixAt: tenMinutesAgo.toISOString() };
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW, logger);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cooldown');
    // Verify one outcome line was logged
    expect(logs.some((l) => l.includes('skipped') && l.includes('cooldown'))).toBe(true);
  });

  it('gate 5 (cooldown): lastCiFixAt past cooldown → eligible', async () => {
    // lastCiFixAt is 61 minutes ago, cooldown is 60 minutes by default → eligible
    const sixtyOneMinutesAgo = new Date(NOW.getTime() - 61 * 60 * 1000);
    const entry = { ...defaultEntry, lastCiFixAt: sixtyOneMinutesAgo.toISOString() };

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW);

    expect(result.eligible).toBe(true);
  });

  it('gate 5 (cooldown): no lastCiFixAt → eligible (first attempt)', async () => {
    const entry = { ...defaultEntry };
    // No lastCiFixAt field

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW);

    expect(result.eligible).toBe(true);
  });

  it('no counter change on cooldown skip', async () => {
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60 * 1000);
    const entry = { ...defaultEntry, ciFixAttempts: 1, lastCiFixAt: tenMinutesAgo.toISOString() };

    const result = await isEligibleForCiFix(entry, defaultState, defaultConfig, NOW);

    expect(result.eligible).toBe(false);
    // Entry's ciFixAttempts should not be mutated
    expect(entry.ciFixAttempts).toBe(1);
  });
});

// ── Tests for runCiFix (Task 17: resolver worktree lifecycle) ────────────────

describe('ci-fix: runCiFix resolver worktree lifecycle (Task 17)', () => {
  // Real git subprocesses (worktree add/remove, checkout, log, push) run in
  // every test in this block. Task 19 added several more git calls per test
  // (checkout -B, guards, suite gate, lease push), which pushes wall time
  // past vitest's 5s default under load — raise it here rather than globally.
  const REAL_GIT_TIMEOUT_MS = 20000;

  const PR_URL = 'https://github.com/foo/bar/pull/42';
  const SLUG = 'foo/bar#42';

  /**
   * Creates a temporary git fixture repo with origin remote.
   * Returns { repoPath, origin, cleanup }
   */
  async function createFixtureRepo() {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-fix-test-'));
    const repoPath = join(tmpDir, 'repo');
    const originPath = join(tmpDir, 'origin.git');

    // Create a bare origin repo
    execSync(`git init --bare "${originPath}"`);

    // Create the main repo and configure remote
    execSync(`git init -b main "${repoPath}"`);
    execSync(`git config user.email "test@example.com"`, { cwd: repoPath });
    execSync(`git config user.name "Test User"`, { cwd: repoPath });
    execSync(`git remote add origin "${originPath}"`, { cwd: repoPath });

    // Create initial commit and push to origin
    execSync(`git commit --allow-empty -m "initial"`, { cwd: repoPath });
    execSync(`git push -u origin main`, { cwd: repoPath });

    // Create and push a feature branch
    execSync(`git checkout -b feat/fix`, { cwd: repoPath });
    execSync(`git commit --allow-empty -m "feature work"`, { cwd: repoPath });
    execSync(`git push -u origin feat/fix`, { cwd: repoPath });

    // Switch back to main
    execSync(`git checkout -q main`, { cwd: repoPath });

    const cleanup = async () => {
      try {
        await rmdir(tmpDir, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    };

    return { repoPath, originPath, cleanup };
  }

  it('happy path: runs callback inside worktree at PR branch tip, worktree removed after success', async () => {
    const { repoPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      // Import the function we're testing (we'll implement it)
      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      // Mock fix-runner stub that creates a commit
      const fixRunner = {
        run: async ({ worktreePath }: { worktreePath: string }) => {
          execSync(`git commit --allow-empty -m "ci fix commit"`, { cwd: worktreePath });
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);

      // Verify the result
      expect(result.kind).toBe('changed');

      // Verify worktree was cleaned up
      const worktreePath = join(repoPath, '.worktrees', `ci-fix-${SLUG}`);
      const worktreeExists = execSync(`git worktree list --porcelain 2>/dev/null | grep -q "${worktreePath}" && echo "yes" || echo "no"`).toString().trim();
      expect(worktreeExists).toBe('no');

      // Verify primary checkout is still on main
      const currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath }).toString().trim();
      expect(currentBranch).toBe('main');
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('worktree removed after callback throws', async () => {
    const { repoPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      // Fix-runner that throws
      const fixRunner = {
        run: async () => {
          throw new Error('Fix failed');
        },
      };

      let threwError = false;
      try {
        await runCiFix(entry, branch, hint, { fixRunner }, logger);
      } catch (err) {
        threwError = true;
      }

      // Verify it threw
      expect(threwError).toBe(true);

      // Verify worktree was still cleaned up despite the throw
      const worktreePath = join(repoPath, '.worktrees', `ci-fix-${SLUG}`);
      const worktreeExists = execSync(`git worktree list --porcelain 2>/dev/null | grep -q "${worktreePath}" && echo "yes" || echo "no"`).toString().trim();
      expect(worktreeExists).toBe('no');

      // Verify primary checkout unchanged
      const currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath }).toString().trim();
      expect(currentBranch).toBe('main');
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('branch-gone: aborts with logged reason, no throw, no primary-tree mutation', async () => {
    const { repoPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/nonexistent'; // Branch that doesn't exist
      const hint = 'Test hint';

      const fixRunner = {
        run: async () => {
          throw new Error('Should not reach here');
        },
      };

      // Should not throw, but should log the issue
      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);

      // Should return an aborted outcome (not throw)
      expect(result.kind).toBe('branch-gone');

      // Should have logged the abort reason
      const abortLogs = logs.filter((l) => l.includes('branch-gone') || l.includes('not found'));
      expect(abortLogs.length).toBeGreaterThan(0);

      // Verify primary checkout unchanged
      const currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath }).toString().trim();
      expect(currentBranch).toBe('main');
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('happy path: guards + suite gate pass -> pushRefreshed invoked on PR branch (Task 19)', async () => {
    const { repoPath, originPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      const fixRunner = {
        run: async ({ worktreePath }: { worktreePath: string }) => {
          execSync(`git commit --allow-empty -m "ci fix commit"`, { cwd: worktreePath });
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);

      expect(result.kind).toBe('changed');

      // The push landed on origin: the bare repo's feat/fix ref carries the new commit
      const originLog = execSync(`git log --format=%s feat/fix`, { cwd: originPath }).toString();
      expect(originLog).toContain('ci fix commit');

      expect(logs.some((l) => l.includes('refreshed'))).toBe(true);
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('suite gate fails -> no push, outcome logged, attempt stays consumed (Task 19)', async () => {
    const { repoPath, originPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      const beforeSha = execSync(`git rev-parse feat/fix`, { cwd: originPath }).toString().trim();

      const fixRunner = {
        run: async ({ worktreePath }: { worktreePath: string }) => {
          execSync(`git commit --allow-empty -m "ci fix commit"`, { cwd: worktreePath });
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(
        entry,
        branch,
        hint,
        { fixRunner, suiteCommand: 'exit 1' },
        logger,
      );

      // Attempt stays consumed: the outcome remains 'changed' even though nothing published
      expect(result.kind).toBe('changed');

      const afterSha = execSync(`git rev-parse feat/fix`, { cwd: originPath }).toString().trim();
      expect(afterSha).toBe(beforeSha);

      expect(
        logs.some((l) => l.toLowerCase().includes('suite') && l.toLowerCase().includes('escalat')),
      ).toBe(true);
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('acceptance guards report lost commits -> no push (Task 19)', async () => {
    const { repoPath, originPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      const beforeSha = execSync(`git rev-parse feat/fix`, { cwd: originPath }).toString().trim();

      const fixRunner = {
        run: async ({ worktreePath }: { worktreePath: string }) => {
          // Drop the original "feature work" commit entirely and replace it —
          // simulates a lossy fix session that loses prior work.
          execSync(`git reset --hard HEAD~1`, { cwd: worktreePath });
          execSync(`git commit --allow-empty -m "different work"`, { cwd: worktreePath });
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);

      expect(result.kind).toBe('changed');

      const afterSha = execSync(`git rev-parse feat/fix`, { cwd: originPath }).toString().trim();
      expect(afterSha).toBe(beforeSha);

      expect(
        logs.some((l) => l.toLowerCase().includes('guard') && l.toLowerCase().includes('escalat')),
      ).toBe(true);
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('cleans up stale worktree from crashed prior run', async () => {
    const { repoPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      // Create a stale worktree directory to simulate a crash
      const worktreePath = join(repoPath, '.worktrees', `ci-fix-${SLUG}`);
      execSync(`mkdir -p "${worktreePath}"`);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      let callbackRan = false;
      const fixRunner = {
        run: async () => {
          callbackRan = true;
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);

      // Verify callback ran (stale worktree was cleaned)
      expect(callbackRan).toBe(true);
      expect(result.kind).toBe('changed');

      // Verify worktree cleaned up again
      const worktreeExists = execSync(`git worktree list --porcelain 2>/dev/null | grep -q "${worktreePath}" && echo "yes" || echo "no"`).toString().trim();
      expect(worktreeExists).toBe('no');
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);

  it('primary checkout leak assertion: git status clean and HEAD/branch unchanged after fix run (Task 20)', async () => {
    const { repoPath, cleanup } = await createFixtureRepo();
    try {
      const logs: string[] = [];
      const logger = (msg: string) => logs.push(msg);

      const { runCiFix } = await import('../../src/engine/ci-fix.js');

      const entry = { prUrl: PR_URL, slug: SLUG, repoCwd: repoPath, ciFixAttempts: 0 };
      const branch = 'feat/fix';
      const hint = 'Test hint';

      const beforeBranch = execSync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath }).toString().trim();
      const beforeHead = execSync(`git rev-parse HEAD`, { cwd: repoPath }).toString().trim();

      const fixRunner = {
        run: async ({ worktreePath }: { worktreePath: string }) => {
          execSync(`git commit --allow-empty -m "ci fix commit"`, { cwd: worktreePath });
          return { kind: 'changed' as const };
        },
      };

      const result = await runCiFix(entry, branch, hint, { fixRunner }, logger);
      expect(result.kind).toBe('changed');

      // Primary checkout must be fully clean — no staged/unstaged/untracked pollution.
      const status = execSync(`git status --porcelain`, { cwd: repoPath }).toString();
      expect(status).toBe('');

      // HEAD and branch must be exactly what they were before the resolver ran —
      // proves worktree isolation is real, not just hoped-for (no accidental
      // rebase/checkout/merge leaked into the primary checkout).
      const afterBranch = execSync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath }).toString().trim();
      const afterHead = execSync(`git rev-parse HEAD`, { cwd: repoPath }).toString().trim();
      expect(afterBranch).toBe(beforeBranch);
      expect(afterHead).toBe(beforeHead);
    } finally {
      await cleanup();
    }
  }, REAL_GIT_TIMEOUT_MS);
});

// ── CF-1 (RED): productionCiFixRunner must delegate to an injected      ──────
// ── StepRunner-backed dispatcher seam, not shell out to `claude --fix-session` ─
//
// T2 added `DefaultStepRunner.resolveCiFailure(ctx)` as the real dispatch
// path (src/engine/step-runners.ts). `productionCiFixRunner` (this file,
// ~line 258) still shells out via execa with the fictional `--fix-session`
// flag and has no seam through which a StepRunner/dispatcher can be
// injected. This test mirrors the existing `fixRunner` injection pattern
// used by `runCiFix` (see `deps.fixRunner` above) and the collaborator
// injection pattern used elsewhere (e.g. `resolveSetupFailure`,
// `resolveRebaseConflict` in rebase.ts/step-runners.ts): a fake dispatcher
// is injected and the test asserts it — not `execa` — is what gets called.
//
// Expected to FAIL until T4 gives `productionCiFixRunner` a way to receive
// an injected StepRunner-backed dispatcher instead of hardcoding the execa
// `--fix-session` spawn.
describe('ci-fix: productionCiFixRunner delegates to injected StepRunner dispatcher (CF-1, RED)', () => {
  it('run() calls the injected dispatcher seam instead of shelling out to `claude --fix-session`', async () => {
    const calls: Array<{ worktreePath: string; hint: string; entry: WatchEntry }> = [];

    // Fake StepRunner-backed dispatcher, mirroring DefaultStepRunner.resolveCiFailure's
    // shape: takes a CI-failure context and resolves to an attempt outcome.
    const fakeDispatcher = {
      resolveCiFailure: async (ctx: { worktreePath: string; hint: string; entry: WatchEntry }) => {
        calls.push(ctx);
        return { kind: 'changed' as const };
      },
    };

    const entry: WatchEntry = {
      prUrl: 'https://github.com/foo/bar/pull/42',
      slug: 'foo/bar#42',
      repoCwd: '/fake/repo',
      ciFixAttempts: 0,
    };
    const hint = 'CI checks failed: build';
    const worktreePath = '/fake/repo/.worktrees/ci-fix-foo-bar-42';

    // `productionCiFixRunner` currently accepts no dispatcher — this call
    // exercises the seam this task expects to exist. Until T4 wires it up,
    // this either fails to type/compile against the real interface or the
    // fake dispatcher is silently never invoked because the production
    // implementation still calls execa directly.
    const runner = productionCiFixRunner as unknown as {
      run(opts: {
        worktreePath: string;
        hint: string;
        entry: WatchEntry;
        dispatcher?: typeof fakeDispatcher;
      }): Promise<{ kind: string }>;
    };

    const outcome = await runner.run({ worktreePath, hint, entry, dispatcher: fakeDispatcher });

    expect(outcome).toEqual({ kind: 'changed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ worktreePath, hint, entry });
  });
});

// ── Resolver real-binary smoke (Task 24) — REMOVED (T4) ──────────────────────
//
// This test used to spawn a stub `claude` binary and assert argv
// `['--fix-session', '--pr-url', ..., '--hint', ...]` round-tripped through a
// real subprocess. That was the fictional `--fix-session` CLI flag this
// feature exists to remove (CF-1/CF-3): `productionCiFixRunner` no longer
// spawns a subprocess at all — it delegates to an injected StepRunner-backed
// dispatcher (see the CF-1 describe block above). There is no more argv to
// round-trip, so the smoke test's premise no longer applies; it is deleted
// rather than rewritten. Dispatcher round-trip coverage now lives in the
// CF-1 describe block above and in test/integration/ci-fix-resolver-autofix.test.ts.
