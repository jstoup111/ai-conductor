import { describe, expect, it } from 'vitest';

import { resolvePrivateGhObserverPassthrough } from '../../src/execution/gh-observer.js';

describe('resolvePrivateGhObserverPassthrough', () => {
  it('accepts only a provisioned absolute executable and otherwise retains ordinary gh resolution', () => {
    expect(resolvePrivateGhObserverPassthrough({ CONDUCT_GH_REAL_EXECUTABLE: '/private/real-gh' })).toBe('/private/real-gh');
    expect(resolvePrivateGhObserverPassthrough({ CONDUCT_GH_REAL_EXECUTABLE: 'gh' })).toBe('gh');
    expect(resolvePrivateGhObserverPassthrough({})).toBe('gh');
  });
});
