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
});
