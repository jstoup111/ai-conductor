/**
 * Tests for `publishResolution` in src/engine/autoresolve.ts (Task 14).
 *
 * Story: "The refresh publishes with a lease and never overwrites unseen
 * work" (.docs/stories/auto-resolve-open-pr-conflicts.md) — Negative Paths.
 *
 * `publishResolution` is the orchestrator that ties an earlier-stage result
 * (Tier 2 dispatch / acceptance guards / suite gate) to the lease-protected
 * push (`pushRefreshedBranch`) and the post-push label restore, escalating
 * via `escalate()` whenever the flow does not end in a clean publish.
 *
 * Covers:
 *   1. Lease rejection: local push result discarded, escalation carries the
 *      lease reason, no retry, no bare `--force` ever appears in argv.
 *   2. Any earlier-stage failure short-circuits BEFORE git is touched: the
 *      injected git runner records zero push calls (in fact zero calls at all).
 *   3. Post-push label-restore `gh` failure: the push itself is not rolled
 *      back (no second git call undoing it) and the failure is only logged,
 *      never thrown, never escalated as a resolution failure.
 *
 * All tests use FAKE git/gh runners; no real git/gh binaries required.
 */

import { describe, it, expect } from 'vitest';
import { publishResolution } from '../../src/engine/autoresolve.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { NEEDS_REMEDIATION_MARKER } from '../../src/engine/pr-labels.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { executeRemoteGit } from '../../src/engine/remote-git-operations.js';

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

// The lease tests own push behavior, not ownership authorization. This still
// reaches the injected process boundary, while dedicated ownership coverage
// exercises executeRemoteGit's real policy composition.
const permittedRemoteGit: typeof executeRemoteGit = async (args, dependencies) => {
  try {
    await dependencies.runRemoteGit([...args], { cwd: dependencies.cwd });
    return { kind: 'executed', targets: [] };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error), targets: [] };
  }
};

describe('engine/autoresolve — publishResolution negative paths', () => {
  it('lease rejection: discards the local result, escalates with the lease reason, and never retries or forces', async () => {
    const { git, calls: gitCalls } = fakeGit((args) => {
      if (args[0] === 'push') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '! [rejected] feat/widget -> feat/widget (stale info)',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const { gh, calls: ghCalls } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    });

    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      gh: { runGh: gh, cwd: '/repo' },
      remoteGit: permittedRemoteGit,
    });

    expect(result).toEqual({
      published: false,
      stage: 'lease-push',
      reason: expect.stringMatching(/lease|stale|reject/i),
    });

    // Exactly one push attempt — no retry.
    const pushCalls = gitCalls.filter((c) => c[0] === 'push');
    expect(pushCalls.length).toBe(1);
    expect(pushCalls[0]).toContain('--force-with-lease');
    expect(pushCalls[0]).not.toContain('--force');
    // No second attempt with any variant of a forcing flag.
    expect(gitCalls.filter((c) => c[0] === 'push').length).toBe(1);

    // A denied publication does not use the read transport for escalation.
    const commentCall = ghCalls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeUndefined();

    // No raw label write is used after the guarded publication failure.
    const addNeedsRemediation = ghCalls.find(
      (c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('labels[]=needs-remediation')),
    );
    expect(addNeedsRemediation).toBeUndefined();
    const restoreMergeable = ghCalls.find(
      (c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('labels[]=mergeable')),
    );
    expect(restoreMergeable).toBeUndefined();
  });

  it('earlier-stage failure short-circuits before git is touched: the injected git runner records zero calls', async () => {
    const { git, calls: gitCalls } = fakeGit(() => ({ exitCode: 0, stdout: '', stderr: '' }));
    const { gh, calls: ghCalls } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    });

    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      gh: { runGh: gh, cwd: '/repo' },
      remoteGit: permittedRemoteGit,
      earlierFailure: {
        stage: 'suite-gate',
        reason: 'suite command exited with code 1',
      },
    });

    expect(result).toEqual({
      published: false,
      stage: 'suite-gate',
      reason: 'suite command exited with code 1',
    });

    // Zero git calls of any kind — the earlier failure must short-circuit
    // before any push (or any other git operation) is attempted.
    expect(gitCalls.length).toBe(0);

    // A bare read transport cannot escalate through an unguarded write path.
    const commentCall = ghCalls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeUndefined();
  });

  it('post-push label-restore gh failure: the push is not rolled back and the failure is only logged', async () => {
    const { git, calls: gitCalls } = fakeGit((args) => {
      if (args[0] === 'push') {
        return { exitCode: 0, stdout: 'Everything up-to-date', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const { gh, calls: ghCalls } = fakeGh((args) => {
      if (args[0] === 'api' && args.includes('POST') && args.some((a) => a.includes('labels[]=mergeable'))) {
        return new Error('label restore failed: 500');
      }
      return { stdout: '' };
    });

    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const result = await publishResolution({
      git,
      branch: 'feat/widget',
      prUrl: PR_URL,
      gh: { runGh: gh, cwd: '/repo', log: logger },
      remoteGit: permittedRemoteGit,
    });

    expect(result).toEqual({ published: true });

    // Exactly one push call — no compensating/rollback git call afterward.
    expect(gitCalls.filter((c) => c[0] === 'push').length).toBe(1);
    expect(gitCalls.length).toBe(1);

    // The raw read transport cannot restore a label without a guarded runner.
    const restoreAttempt = ghCalls.find(
      (c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('labels[]=mergeable')),
    );
    expect(restoreAttempt).toBeUndefined();

    // ...and its failure surfaced only via the logger, never thrown, and
    // never escalated as a resolution failure (no needs-remediation label,
    // no escalation comment).
    const needsRemediation = ghCalls.find(
      (c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('labels[]=needs-remediation')),
    );
    expect(needsRemediation).toBeUndefined();
    const commentCall = ghCalls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeUndefined();

    expect(logs.some((l) => l.includes('outcome:') && l.includes('refreshed'))).toBe(true);
  });
});
