/**
 * Tests for outcome logging (FR-16) in src/engine/autoresolve.ts (Task 16).
 *
 * Story: "Given any attempt concludes, when the tick finishes, then the
 * daemon log contains one outcome line identifying the PR, the stage
 * reached, and refreshed/escalated/skipped."
 * (.docs/stories/auto-resolve-open-pr-conflicts.md, FR-16)
 *
 * `logOutcome` is the single shared formatter; these snapshot tests pin its
 * exact wire format, then verify the three call sites (`isEligibleForResolve`
 * → skipped, `publishResolution` success path → refreshed, `publishResolution`
 * escalation paths → escalated) each emit exactly one such line.
 *
 * All tests use FAKE git/gh/fs runners; no real git/gh binaries required.
 */

import { describe, it, expect } from 'vitest';
import {
  logOutcome,
  isEligibleForResolve,
  publishResolution,
  type AutoresolveFs,
} from '../../src/engine/autoresolve.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';

const PR_URL = 'https://github.com/foo/bar/pull/42';

function fakeGit(
  handler: (args: string[]) => { exitCode: number; stdout: string; stderr: string },
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args: string[]) => {
    calls.push([...args]);
    return handler(args);
  };
  return { git, calls };
}

function fakeGh(
  handler: (args: string[]) => { stdout: string } | Error,
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    const result = handler(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { gh, calls };
}

const baseEntry: WatchEntry = {
  prUrl: PR_URL,
  slug: 'foo/bar',
  repoCwd: '/repo',
  resolveAttempts: 1,
  lastResolveAt: undefined,
};

describe('engine/autoresolve — logOutcome (FR-16 wire format)', () => {
  it('snapshot: refreshed outcome line', () => {
    const logs: string[] = [];
    logOutcome((msg) => logs.push(msg), PR_URL, 'lease-push', 'refreshed');
    expect(logs).toMatchInlineSnapshot(`
      [
        "outcome: pr=https://github.com/foo/bar/pull/42 stage=lease-push result=refreshed",
      ]
    `);
  });

  it('snapshot: escalated outcome line', () => {
    const logs: string[] = [];
    logOutcome((msg) => logs.push(msg), PR_URL, 'suite-gate', 'escalated');
    expect(logs).toMatchInlineSnapshot(`
      [
        "outcome: pr=https://github.com/foo/bar/pull/42 stage=suite-gate result=escalated",
      ]
    `);
  });

  it('snapshot: skipped(<reason>) outcome line', () => {
    const logs: string[] = [];
    logOutcome(
      (msg) => logs.push(msg),
      PR_URL,
      'eligibility',
      'skipped(cooldown not elapsed: 12 minutes remaining)',
    );
    expect(logs).toMatchInlineSnapshot(`
      [
        "outcome: pr=https://github.com/foo/bar/pull/42 stage=eligibility result=skipped(cooldown not elapsed: 12 minutes remaining)",
      ]
    `);
  });
});

describe('engine/autoresolve — outcome logging at call sites', () => {
  it('isEligibleForResolve: logs exactly one skipped(<reason>) line with the PR identifier when a gate rejects', async () => {
    const logs: string[] = [];
    const entry: WatchEntry = { ...baseEntry, resolveAttempts: 0, lastResolveAt: undefined };
    const prState: PrMergeState = { state: 'MERGED', mergeable: 'UNKNOWN', hasFailingOrPendingChecks: false, labels: [] };
    const cfg: HarnessConfig | undefined = { mergeable_autoresolve: { enabled: true } } as any;
    const fs: AutoresolveFs = { worktreeExists: async () => false };

    const result = await isEligibleForResolve(
      entry,
      prState,
      cfg,
      new Date(),
      fs,
      (msg) => logs.push(msg),
    );

    expect(result.eligible).toBe(false);
    expect(logs.length).toBe(1);
    expect(logs[0]).toBe(`outcome: pr=${PR_URL} stage=eligibility result=skipped(PR is MERGED; pruned from watch)`);
  });

  it('isEligibleForResolve: logs nothing when eligible', async () => {
    const logs: string[] = [];
    const entry: WatchEntry = { ...baseEntry, resolveAttempts: 0, lastResolveAt: undefined };
    const prState: PrMergeState = { state: 'CONFLICTING', mergeable: 'CONFLICTING', hasFailingOrPendingChecks: false, labels: [] };
    const cfg: HarnessConfig | undefined = { mergeable_autoresolve: { enabled: true } } as any;
    const fs: AutoresolveFs = { worktreeExists: async () => false };

    const result = await isEligibleForResolve(
      entry,
      prState,
      cfg,
      new Date(),
      fs,
      (msg) => logs.push(msg),
    );

    expect(result.eligible).toBe(true);
    expect(logs.length).toBe(0);
  });

  it('publishResolution: success path logs one refreshed line with the PR identifier and lease-push stage', async () => {
    const { git } = fakeGit((args) => {
      if (args[0] === 'push') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const { gh } = fakeGh(() => ({ stdout: '' }));

    const logs: string[] = [];
    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      entry: baseEntry,
      gh: { runGh: gh, cwd: '/repo', log: (msg) => logs.push(msg) },
    });

    expect(result).toEqual({ published: true });
    const outcomeLines = logs.filter((l) => l.startsWith('outcome:'));
    expect(outcomeLines).toEqual([
      `outcome: pr=${PR_URL} stage=lease-push result=refreshed`,
    ]);
  });

  it('publishResolution: lease-rejection path logs one escalated line with the lease-push stage', async () => {
    const { git } = fakeGit((args) => {
      if (args[0] === 'push') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '! [rejected] feat/widget -> feat/widget (stale info)',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const { gh } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments: [] }) };
      return { stdout: '' };
    });

    const logs: string[] = [];
    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      entry: baseEntry,
      gh: { runGh: gh, cwd: '/repo', log: (msg) => logs.push(msg) },
    });

    expect(result.published).toBe(false);
    const outcomeLines = logs.filter((l) => l.startsWith('outcome:'));
    expect(outcomeLines).toEqual([
      `outcome: pr=${PR_URL} stage=lease-push result=escalated`,
    ]);
  });

  it('publishResolution: earlier-stage failure logs one escalated line with that stage, before any git call', async () => {
    const { git, calls: gitCalls } = fakeGit(() => ({ exitCode: 0, stdout: '', stderr: '' }));
    const { gh } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments: [] }) };
      return { stdout: '' };
    });

    const logs: string[] = [];
    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      entry: baseEntry,
      gh: { runGh: gh, cwd: '/repo', log: (msg) => logs.push(msg) },
      earlierFailure: { stage: 'suite-gate', reason: 'suite command exited with code 1' },
    });

    expect(result.published).toBe(false);
    expect(gitCalls.length).toBe(0);
    const outcomeLines = logs.filter((l) => l.startsWith('outcome:'));
    expect(outcomeLines).toEqual([
      `outcome: pr=${PR_URL} stage=suite-gate result=escalated`,
    ]);
  });
});
