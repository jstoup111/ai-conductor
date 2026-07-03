// Test: blocker-resolver skeleton (BlockerVerdict union + createBlockerResolver)
//
// Task 1 baseline: resolver with a fake runner returning `[]` yields
// `{ kind: 'unblocked' }` for a valid sourceRef.

import { describe, it, expect } from 'vitest';
import { createBlockerResolver } from '../../src/engine/blocker-resolver.js';
import type { BlockerRunner } from '../../src/engine/blocker-resolver.js';

interface Call {
  args: string[];
}

function makeRunner(stdout: string): { run: BlockerRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: BlockerRunner = async (args) => {
    calls.push({ args: [...args] });
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
    const run: BlockerRunner = async () => {
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
    const run: BlockerRunner = async (args) => {
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
});
