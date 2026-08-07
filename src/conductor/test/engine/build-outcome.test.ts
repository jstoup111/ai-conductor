import { describe, expect, it } from 'vitest';
import { classifyBuildSettle } from '../../src/engine/build-outcome.js';

describe('classifyBuildSettle', () => {
  it.each([
    ['moved when non-null tree hashes differ', 'before-tree', 'after-tree', 2, 2, 'moved'],
    ['no-movement when tree hashes match', 'same-tree', 'same-tree', 2, 2, 'no-movement'],
    ['moved when resolved work increases despite matching trees', 'same-tree', 'same-tree', 2, 3, 'moved'],
  ] as const)('%s', (_description, treeBefore, treeAfter, resolvedBefore, resolvedAfter, expected) => {
    expect(
      classifyBuildSettle({ treeBefore, treeAfter, resolvedBefore, resolvedAfter }),
    ).toBe(expected);
  });
});
