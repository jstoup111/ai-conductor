import { describe, it, expect } from 'vitest';
import {
  displayBuildPosition,
  formatCommitAge,
  formatRetryCounter,
} from '../src/engine/format-retry-line';

describe('formatRetryCounter', () => {
  it.each([
    {
      name: 'fixed-only input',
      progressAttempt: undefined,
      progressAttemptCeiling: undefined,
      expected: '1/3',
    },
    {
      name: 'complete progress allowance pair',
      progressAttempt: 2,
      progressAttemptCeiling: 30,
      expected: '1/3 (progress allowance: attempt 2 of 30)',
    },
    {
      name: 'progress attempt without its ceiling',
      progressAttempt: 2,
      progressAttemptCeiling: undefined,
      expected: '1/3',
    },
    {
      name: 'progress ceiling without its consumed attempt',
      progressAttempt: undefined,
      progressAttemptCeiling: 30,
      expected: '1/3',
    },
  ])('renders $name without undefined output', ({ progressAttempt, progressAttemptCeiling, expected }) => {
    expect(formatRetryCounter(1, 3, progressAttempt, progressAttemptCeiling)).toBe(expected);
  });
});

describe('displayBuildPosition', () => {
  it('returns 1 for the first in-progress task', () => {
    expect(displayBuildPosition(0, 18, true)).toBe(1);
  });

  it('returns k+1 for a mid-build in-progress task', () => {
    const N = 18;
    for (let k = 1; k < N; k++) {
      expect(displayBuildPosition(k, N, true)).toBe(k + 1);
    }
  });

  it('returns N for the last task in progress', () => {
    const N = 18;
    expect(displayBuildPosition(N - 1, N, true)).toBe(N);
  });

  it('returns N when all done and no in-progress task', () => {
    const N = 18;
    expect(displayBuildPosition(N, N, false)).toBe(N);
  });

  it('clamps to N even in the impossible transient of resolved===total with hasCurrent', () => {
    const N = 18;
    expect(displayBuildPosition(N, N, true)).toBe(N);
  });

  it('returns k (completed count) when there is no in-progress task', () => {
    expect(displayBuildPosition(5, 18, false)).toBe(5);
  });

  it('returns 0 for empty/no-data build', () => {
    expect(displayBuildPosition(0, 0, false)).toBe(0);
  });
});

describe('formatCommitAge', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z');

  it('returns an empty fragment when no commit timestamp is available', () => {
    expect(formatCommitAge(undefined, now)).toBe('');
  });

  it('renders commits younger than one minute', () => {
    expect(formatCommitAge(now - 30_000, now)).toBe('<1m ago');
  });

  it('renders commits younger than one hour in minutes', () => {
    expect(formatCommitAge(now - 7 * 60_000, now)).toBe('7m ago');
  });

  it('renders commits one hour or older in hours and minutes', () => {
    expect(formatCommitAge(now - 125 * 60_000, now)).toBe('2h 5m ago');
  });

  it('clamps future timestamps to a zero-length age', () => {
    expect(formatCommitAge(now + 5 * 60_000, now)).toBe('<1m ago');
  });
});
