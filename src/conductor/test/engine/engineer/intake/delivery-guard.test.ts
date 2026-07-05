// Unit tests for delivery-guard module — verifyPrState probe (Task 1, TR-1)
//
// verifyPrState(gh, url) probes a GitHub PR via gh runner and returns a
// discriminated PR state:
//   'open'              — state is OPEN
//   'merged'            — state is MERGED (regardless of mergedAt)
//   'closed-unmerged'   — state is CLOSED and mergedAt is null
//   'unknown'           — gh throws, stdout unparseable, or state unrecognized

import { describe, it, expect } from 'vitest';

async function loadDeliveryGuard() {
  return import('../../../../src/engine/engineer/intake/delivery-guard.js') as Promise<any>;
}

/** Recorded invocation from the fake runner. */
interface RecordedCall {
  args: string[];
  cwd: string;
}

/** Build a fake gh runner that records calls and returns pre-set stdout. */
function makeFakeGh(stdout: string): {
  runner: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], opts: { cwd: string }) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    return { stdout };
  };
  return { runner, calls };
}

/** Build a fake gh runner that throws. */
function makeFailingGh(): {
  runner: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
} {
  return {
    runner: async () => {
      throw new Error('gh command failed');
    },
  };
}

describe('verifyPrState — PR state probe', () => {
  it('OPEN state → returns "open"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/1');

    expect(result).toBe('open');
  });

  it('MERGED state with mergedAt → returns "merged"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(
      JSON.stringify({ state: 'MERGED', mergedAt: '2026-07-05T10:00:00Z' }),
    );

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/2');

    expect(result).toBe('merged');
  });

  it('CLOSED state with mergedAt null → returns "closed-unmerged"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/3');

    expect(result).toBe('closed-unmerged');
  });

  it('gh runner throws → returns "unknown"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFailingGh();

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/4');

    expect(result).toBe('unknown');
  });

  it('unparseable stdout (invalid JSON) → returns "unknown"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh('not valid json');

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/5');

    expect(result).toBe('unknown');
  });
});
