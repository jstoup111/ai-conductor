// Test: blocker-resolver skeleton (BlockerVerdict union + createBlockerResolver)
//
// Task 1 baseline: resolver with a fake runner returning `[]` yields
// `{ kind: 'unblocked' }` for a valid sourceRef.

import { describe, it, expect } from 'vitest';
import { createBlockerResolver } from '../../src/engine/blocker-resolver.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

interface Call {
  args: string[];
  cwd: string;
}

function makeRunner(stdout: string): { run: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: GhRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    return { stdout };
  };
  return { run, calls };
}

describe('createBlockerResolver', () => {
  it('returns unblocked when blocked_by is empty', async () => {
    const { run } = makeRunner('[]');
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({ kind: 'unblocked' });
  });

  it('forwards the configured cwd to the runner on every invocation', async () => {
    const { run, calls } = makeRunner('[]');
    const resolver = createBlockerResolver({ run, cwd: '/tmp/scratch-cwd' });

    await resolver.resolve('owner/repo#5');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe('/tmp/scratch-cwd');
  });

  it('returns blocked with the blocker ref when blocked_by has an open issue', async () => {
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 100,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'open',
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: '100' }],
    });
  });

  it('returns unblocked when blocked_by has a closed issue (reason: completed)', async () => {
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 100,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'closed',
          state_reason: 'completed',
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({ kind: 'unblocked' });
  });

  it('returns unblocked when blocked_by has a closed issue (reason: not_planned)', async () => {
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 100,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'closed',
          state_reason: 'not_planned',
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({ kind: 'unblocked' });
  });

  it('returns blocked when a previously-closed blocker has been reopened', async () => {
    // Simulates a state transition: the blocker was closed at some point (its
    // history), but the current dependencies API response shows it as open
    // again — reopening must re-block the dependent issue.
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 100,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'open',
          state_reason: null,
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: '100' }],
    });
  });

  it('names only the open issues when blocked_by mixes closed and open', async () => {
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 100,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'closed',
        },
        {
          number: 200,
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'open',
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: '200' }],
    });
  });

  it('honors cross-repo blockers without filtering by repo', async () => {
    const { run } = makeRunner(
      JSON.stringify([
        {
          number: 300,
          repository_url: 'https://api.github.com/repos/other-owner/other-repo',
          state: 'open',
        },
      ]),
    );
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'other-owner/other-repo', number: '300' }],
    });
  });

  it('returns indeterminate when the runner throws (network/API failure)', async () => {
    const run: GhRunner = async () => {
      throw new Error('gh: connection reset');
    };
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#5');

    expect(verdict.kind).toBe('indeterminate');
    expect((verdict as { detail: string }).detail).toContain('gh: connection reset');
  });

  it('returns indeterminate for an unparseable sourceRef without calling the runner', async () => {
    const { run, calls } = makeRunner('[]');
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('garbage');

    expect(verdict.kind).toBe('indeterminate');
    expect((verdict as { detail: string }).detail).toContain('garbage');
    expect(calls.length).toBe(0);
  });

  it('isolates errors per ref: one throwing ref does not affect another that succeeds', async () => {
    const calls: string[] = [];
    const run: GhRunner = async (args) => {
      calls.push(args.join(' '));
      if (args.some((a) => a.includes('repos/owner/repoA'))) {
        throw new Error('boom for A');
      }
      return { stdout: '[]' };
    };
    const resolver = createBlockerResolver({ run });

    const verdictA = await resolver.resolve('owner/repoA#1');
    const verdictB = await resolver.resolve('owner/repoB#2');

    expect(verdictA).toEqual({ kind: 'indeterminate', detail: expect.stringContaining('boom for A') });
    expect(verdictB).toEqual({ kind: 'unblocked' });
    expect(calls.length).toBe(2);
  });

  it('detects a 2-node cycle: A blocked_by B, B blocked_by A (both open)', async () => {
    const blockedByOf = (blocker: string) =>
      JSON.stringify([
        {
          number: Number(blocker),
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'open',
        },
      ]);

    const run: GhRunner = async (args) => {
      const path = args[1] ?? '';
      if (path.includes('/issues/1/')) {
        return { stdout: blockedByOf('2') };
      }
      if (path.includes('/issues/2/')) {
        return { stdout: blockedByOf('1') };
      }
      return { stdout: '[]' };
    };
    const resolver = createBlockerResolver({ run });

    const verdictA = await resolver.resolve('owner/repo#1');
    const verdictB = await resolver.resolve('owner/repo#2');

    expect(verdictA.kind).toBe('cycle');
    expect(verdictB.kind).toBe('cycle');
    const membersA = (verdictA as { members: { repo: string; number: string }[] }).members
      .map((m) => m.number)
      .sort();
    const membersB = (verdictB as { members: { repo: string; number: string }[] }).members
      .map((m) => m.number)
      .sort();
    expect(membersA).toEqual(['1', '2']);
    expect(membersB).toEqual(['1', '2']);
  });
  it('does not report a deep chain (A->B->C, all open, C terminal) as a cycle', async () => {
    const blockedByOf = (blocker: string) =>
      JSON.stringify([
        {
          number: Number(blocker),
          repository_url: 'https://api.github.com/repos/owner/repo',
          state: 'open',
        },
      ]);

    const run: GhRunner = async (args) => {
      const path = args[1] ?? '';
      if (path.includes('/issues/1/')) {
        return { stdout: blockedByOf('2') }; // A blocked_by B
      }
      if (path.includes('/issues/2/')) {
        return { stdout: blockedByOf('3') }; // B blocked_by C
      }
      // C has no blockers — chain terminates.
      return { stdout: '[]' };
    };
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#1');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: '2' }],
    });
  });

  it('does not report a cycle when the return path is broken by a closed blocker', async () => {
    // A blocked_by B (open); B blocked_by A, but that particular blocked_by
    // entry for B->A is closed — so the path back to A is broken and this
    // is not a cycle. Since B's only blocker (A) is closed, B itself is
    // unblocked, which also means A has no *open* path back through B.
    const run: GhRunner = async (args) => {
      const path = args[1] ?? '';
      if (path.includes('/issues/1/')) {
        return {
          stdout: JSON.stringify([
            {
              number: 2,
              repository_url: 'https://api.github.com/repos/owner/repo',
              state: 'open',
            },
          ]),
        }; // A blocked_by B (open)
      }
      if (path.includes('/issues/2/')) {
        return {
          stdout: JSON.stringify([
            {
              number: 1,
              repository_url: 'https://api.github.com/repos/owner/repo',
              state: 'closed',
              state_reason: 'completed',
            },
          ]),
        }; // B blocked_by A, but that entry is closed
      }
      return { stdout: '[]' };
    };
    const resolver = createBlockerResolver({ run });

    const verdict = await resolver.resolve('owner/repo#1');

    expect(verdict).toEqual({
      kind: 'blocked',
      blockers: [{ repo: 'owner/repo', number: '2' }],
    });
  });
});
