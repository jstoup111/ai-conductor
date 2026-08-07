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

  it.each([
    ['treeBefore is null', null, 'after-tree'],
    ['treeAfter is null', 'before-tree', null],
    ['both tree hashes are null', null, null],
  ] as const)('returns no-movement when %s', (_description, treeBefore, treeAfter) => {
    expect(
      classifyBuildSettle({ treeBefore, treeAfter, resolvedBefore: 2, resolvedAfter: 3 }),
    ).toBe('no-movement');
  });
});
