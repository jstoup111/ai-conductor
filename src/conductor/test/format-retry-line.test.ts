import { describe, it, expect } from 'vitest';
import { displayBuildPosition } from '../src/engine/format-retry-line';

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
