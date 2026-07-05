/**
 * Eligibility gate tests for auto-resolving open PR conflicts.
 *
 * Tests exercise `isEligibleForResolve(entry, prState, cfg, now, fs)`
 * with injected dependencies (fs module) for deterministic testing.
 * Each test case verifies one eligibility condition.
 */

import { describe, it, expect } from 'vitest';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { isEligibleForResolve } from '../../src/engine/autoresolve.js';

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
