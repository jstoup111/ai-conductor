import { describe, expect, it } from 'vitest';
import { evaluateScopeContainment } from '../../src/engine/plan-scope-containment.js';

describe('evaluateScopeContainment', () => {
  const task = {
    id: '3',
    files: [
      'src/conductor/src/engine/config.ts',
      'src/conductor/test/engine/config.test.ts',
    ],
  };

  it('allows staged paths declared by the active task', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: [...task.files],
        task,
      }),
    ).toEqual({ allowed: true });
  });

  it('reports only undeclared staged paths with the active task id', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: [
          'src/conductor/src/engine/config.ts',
          'src/conductor/src/engine/artifacts.ts',
        ],
        task,
      }),
    ).toEqual({
      allowed: false,
      taskId: '3',
      offendingPaths: ['src/conductor/src/engine/artifacts.ts'],
    });
  });

  it('accepts a segment-anchored suffix match', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: ['src/conductor/src/engine/config.ts'],
        task: { id: '3', files: ['engine/config.ts'] },
      }),
    ).toEqual({ allowed: true });
  });
});
