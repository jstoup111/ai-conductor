/**
 * Auto-resolve tests for eligibility gate and Tier 2 dispatch.
 *
 * Tests for `isEligibleForResolve` exercise the eligibility gate with
 * injected dependencies (fs module) for deterministic testing.
 * Each test case verifies one eligibility condition.
 *
 * Tests for `runTier2` exercise the bounded rebase-conflict resolution
 * dispatch with injected resolvers over real git repos (following the
 * pattern from rebase-resolution.test.ts for tier1). Covers:
 *   - cap=0 disables dispatch
 *   - cap > 0 calls resolveRebaseConflicts
 *   - resolver cannot-resolve → short-circuit
 *   - resolver succeeds → rebase completes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { isEligibleForResolve, runTier2, runSuiteGate } from '../../src/engine/autoresolve.js';
import { makeGitRunner, type ResolutionAttempt } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — eligibility gate', () => {
  const baseEntry: WatchEntry = {
    prUrl: 'https://github.com/example/repo/pull/42',
    slug: 'example/repo',
    repoCwd: '/repo',
    resolveAttempts: 0,
    lastResolveAt: undefined,
  };

  const basePrState: PrMergeState = {
    state: 'CONFLICTING',
    mergeable: 'CONFLICTING',
    hasFailingOrPendingChecks: false,
    labels: [],
  };

  const baseConfig: HarnessConfig = {
    mergeable_autoresolve: {
      enabled: true,
      cooldownMinutes: 60,
    },
  };

  // Mock fs object with configurable behavior
  const makeMockFs = (opts: { worktreeExists?: boolean } = {}) => {
    return {
      worktreeExists: async (_path: string): Promise<boolean> => {
        return opts.worktreeExists ?? false;
      },
    };
  };

  const now = new Date('2026-01-15T12:00:00Z');

  it('happy path: all conditions met → eligible', async () => {
    // No attempts yet, cooldown not applicable, worktree absent, no labels
    const eligible = await isEligibleForResolve(
      baseEntry,
      basePrState,
      baseConfig,
      now,
      makeMockFs(),
    );
    expect(eligible).toEqual({ eligible: true });
  });

  it('disabled config → not eligible', async () => {
    const config: HarnessConfig = {
      mergeable_autoresolve: {
        enabled: false,
        cooldownMinutes: 60,
      },
    };
    const result = await isEligibleForResolve(
      baseEntry,
      basePrState,
      config,
      now,
      makeMockFs(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('has needs-remediation label → not eligible (sticky)', async () => {
    const prState: PrMergeState = {
      ...basePrState,
      labels: ['needs-remediation'],
    };
    const result = await isEligibleForResolve(
      baseEntry,
      prState,
      baseConfig,
      now,
      makeMockFs(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('needs-remediation');
  });

  it('cooldown not elapsed → not eligible, no attempt increment', async () => {
    const entry: WatchEntry = {
      ...baseEntry,
      resolveAttempts: 1,
      lastResolveAt: new Date('2026-01-15T11:30:00Z').toISOString(), // 30 min ago
    };
    // Cooldown is 60 minutes, so 30 minutes is not enough
    const result = await isEligibleForResolve(entry, basePrState, baseConfig, now, makeMockFs());
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cooldown');
  });

  it('attempts >= cap → not eligible', async () => {
    // Resolve the attempt cap: default is 3 if not set, so 3 attempts means we hit the cap
    const entry: WatchEntry = {
      ...baseEntry,
      resolveAttempts: 3,
      lastResolveAt: new Date('2026-01-01T00:00:00Z').toISOString(), // long ago
    };
    const result = await isEligibleForResolve(entry, basePrState, baseConfig, now, makeMockFs());
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('attempt');
  });

  it('PR merged → not eligible', async () => {
    const prState: PrMergeState = {
      ...basePrState,
      state: 'MERGED',
    };
    const result = await isEligibleForResolve(
      baseEntry,
      prState,
      baseConfig,
      now,
      makeMockFs(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('MERGED');
  });

  it('PR closed → not eligible', async () => {
    const prState: PrMergeState = {
      ...basePrState,
      state: 'CLOSED',
    };
    const result = await isEligibleForResolve(
      baseEntry,
      prState,
      baseConfig,
      now,
      makeMockFs(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('CLOSED');
  });

  it('PR state UNKNOWN → not eligible', async () => {
    const prState: PrMergeState = {
      ...basePrState,
      state: 'UNKNOWN',
    };
    const result = await isEligibleForResolve(
      baseEntry,
      prState,
      baseConfig,
      now,
      makeMockFs(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('UNKNOWN');
  });

  it('worktree already exists → not eligible', async () => {
    const mockFs = makeMockFs({ worktreeExists: true });
    const result = await isEligibleForResolve(
      baseEntry,
      basePrState,
      baseConfig,
      now,
      mockFs,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('worktree');
  });

  it('respects custom rebase_resolution_attempts cap', async () => {
    const config: HarnessConfig = {
      ...baseConfig,
      rebase_resolution_attempts: 2, // Custom cap
    };
    const entry: WatchEntry = {
      ...baseEntry,
      resolveAttempts: 2,
      lastResolveAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    };
    const result = await isEligibleForResolve(entry, basePrState, config, now, makeMockFs());
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('attempt');
  });

  it('eligible when cooldown just elapsed', async () => {
    const entry: WatchEntry = {
      ...baseEntry,
      resolveAttempts: 1,
      lastResolveAt: new Date('2026-01-15T11:00:00Z').toISOString(), // exactly 60 min ago
    };
    const eligible = await isEligibleForResolve(entry, basePrState, baseConfig, now, makeMockFs());
    expect(eligible.eligible).toBe(true);
  });

  it('not eligible when cooldown not quite elapsed', async () => {
    const entry: WatchEntry = {
      ...baseEntry,
      resolveAttempts: 1,
      lastResolveAt: new Date('2026-01-15T11:00:01Z').toISOString(), // 59:59 min ago
    };
    const result = await isEligibleForResolve(entry, basePrState, baseConfig, now, makeMockFs());
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cooldown');
  });
});

describe('engine/autoresolve — Tier 2 gated dispatch (real git, injected resolver)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  // Build a repo where rebasing `feat` onto `main` conflicts on a.ts
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'autoresolve-tier2-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.ts'), 'mainchange\n');
    await g(['commit', '-q', '-am', 'main: change a']);

    await g(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /** Drive rebase into the paused conflict state that tier2 consumes. */
  async function intoConflict() {
    const git = makeGitRunner(repo);
    // Start the rebase (it will pause on conflict)
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to conflicts
    }
    return { git };
  }

  it('cap=0 → no dispatch, return conflict unchanged', async () => {
    const { git } = await intoConflict();
    let resolverCalls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      resolverCalls++;
      return { resolved: false, reason: 'should not be called' };
    };

    const outcome = await runTier2(git, repo, 'main', ['a.ts'], 0, resolver);

    expect(resolverCalls).toBe(0); // resolver never called
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('cap=0');
    }
  });

  it('cap=1, resolver succeeds → rebase completes, outcome reclassified', async () => {
    const { git } = await intoConflict();
    let resolverCalls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      resolverCalls++;
      await writeFile(join(repo, 'a.ts'), 'merged\n');
      await g(['add', 'a.ts']);
      await gc(['rebase', '--continue']);
      return { resolved: true };
    };

    const outcome = await runTier2(git, repo, 'main', ['a.ts'], 1, resolver);

    expect(resolverCalls).toBe(1);
    expect(outcome.kind).toBe('changed'); // a.ts is a code path
    // rebase actually finished + branch current with base
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
  });

  it('cap=1, resolver returns cannot-resolve → short-circuit, no further attempts', async () => {
    const { git } = await intoConflict();
    let resolverCalls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      resolverCalls++;
      return { resolved: false, reason: 'semantic conflict — cannot resolve' };
    };

    const outcome = await runTier2(git, repo, 'main', ['a.ts'], 1, resolver);

    expect(resolverCalls).toBe(1); // resolver called exactly once, then short-circuit
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('semantic conflict');
    }
  });

  it('cap=2, resolver fails first attempt, succeeds second → completes after retry', async () => {
    const { git } = await intoConflict();
    let resolverCalls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      resolverCalls++;
      if (resolverCalls === 1) {
        // First attempt: claim success but don't actually complete
        return { resolved: true };
      }
      // Second attempt: actually resolve it
      await writeFile(join(repo, 'a.ts'), 'merged\n');
      await g(['add', 'a.ts']);
      await gc(['rebase', '--continue']);
      return { resolved: true };
    };

    const outcome = await runTier2(git, repo, 'main', ['a.ts'], 2, resolver);

    expect(resolverCalls).toBe(2); // first failed, second succeeded
    expect(outcome.kind).toBe('changed');
  });

  it('resolver is called with correct context (remaining conflicts, base ref, project root)', async () => {
    const { git } = await intoConflict();
    const remaining = ['a.ts']; // actual conflict from the test repo setup
    const baseRef = 'main';
    let capturedContext: any;
    const resolver = async (ctx: any): Promise<ResolutionAttempt> => {
      capturedContext = ctx;
      return { resolved: false, reason: 'test: capturing context' };
    };

    await runTier2(git, repo, baseRef, remaining, 1, resolver);

    expect(capturedContext).toBeDefined();
    // resolveRebaseConflicts refreshes the conflict list from git, which may differ
    // from the input; verify it includes the actual conflicted file
    expect(capturedContext.conflicts).toContain('a.ts');
    // baseRef is resolved from git's rebase-merge/onto file during rebase, which is a commit hash
    expect(typeof capturedContext.baseRef).toBe('string');
    expect(capturedContext.baseRef.length).toBeGreaterThan(0);
    expect(capturedContext.projectRoot).toBe(repo);
  });
});

describe('engine/autoresolve — suite gate (green path)', () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), 'suite-gate-'));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  it('no suite command configured → returns success (noop)', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate(undefined, worktree, logger);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('suite command configured and passes (exit 0) → returns success', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate('echo "test passed"', worktree, logger);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
    // Duration should be logged
    expect(logs.some((l) => l.toLowerCase().includes('duration'))).toBe(true);
  });

  it('suite command runs in the worktree directory', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    // Create a marker file in the worktree
    const markerFile = join(worktree, 'test-marker.txt');
    await writeFile(markerFile, 'present\n');

    // Run a command that checks if the marker file exists
    const result = await runSuiteGate(
      'test -f test-marker.txt && echo "found"',
      worktree,
      logger,
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    // The command should have found the file (run in worktree cwd)
    expect(logs.some((l) => l.includes('found'))).toBe(true);
  });

  it('suite command failure (exit non-zero) → returns failure with exit code', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate('exit 42', worktree, logger);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(42);
    expect(result.duration).toBeGreaterThan(0);
    // Exit code should be logged
    expect(logs.some((l) => l.toLowerCase().includes('42'))).toBe(true);
  });

  it('exit code and duration are logged', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    await runSuiteGate('echo "running suite"', worktree, logger);

    const logOutput = logs.join(' ');
    expect(logOutput.toLowerCase()).toMatch(/duration|exit|suite/i);
  });

  it('captures and logs command stdout', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    await runSuiteGate('echo "test output here"', worktree, logger);

    expect(logs.some((l) => l.includes('test output here'))).toBe(true);
  });

  it('suite command with multiline output → all captured and logged', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const command = 'echo "line 1" && echo "line 2" && echo "line 3"';
    await runSuiteGate(command, worktree, logger);

    const logOutput = logs.join('\n');
    expect(logOutput).toContain('line 1');
    expect(logOutput).toContain('line 2');
    expect(logOutput).toContain('line 3');
  });

  it('suite command with longer execution time → duration captured accurately', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate('sleep 0.1 && echo "done"', worktree, logger);

    expect(result.ok).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(100); // at least ~100ms
    expect(logs.some((l) => l.includes('done'))).toBe(true);
  });
});

describe('engine/autoresolve — suite gate (fail-closed negative paths)', () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), 'suite-gate-fail-'));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  it('non-zero exit code → failure with exit code in reason', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate('exit 13', worktree, logger);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(13);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('13'); // exit code in reason
  });

  it('command not found (ENOENT) → failure with error reason', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate('/nonexistent/command/that/does/not/exist', worktree, logger);

    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.reason).toBeDefined();
    // Should indicate it couldn't find the command
    expect(result.reason?.toLowerCase()).toMatch(/command|not found|enoent/i);
  });

  it('timeout elapsed → kill process and return timeout failure', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    // Create a command that would run indefinitely
    const result = await runSuiteGate(
      'sleep 10',
      worktree,
      logger,
      { timeoutMs: 50 }, // 50ms timeout (should kill the sleep command)
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason?.toLowerCase()).toMatch(/timeout|timed out/);
    // Duration should be around the timeout value, not 10 seconds
    expect(result.duration).toBeLessThan(2000); // definitely less than 10 seconds
  });

  it('suite stderr is captured in failure reason', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await runSuiteGate(
      'echo "error message" >&2 && exit 1',
      worktree,
      logger,
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    const logOutput = logs.join('\n');
    expect(logOutput).toContain('error message');
  });

  it('empty suite command string with enabled config → treated as no command', async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    // Empty string should be treated as no command configured
    const result = await runSuiteGate('   ', worktree, logger);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(logs.some((l) => l.toLowerCase().includes('no command'))).toBe(true);
  });
});
