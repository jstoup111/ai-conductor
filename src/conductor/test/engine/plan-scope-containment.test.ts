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

  it('does not over-accept a filename that merely ends in the declared path', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: ['src/conductor/src/engine/audit-trail.ts'],
        task: { id: '4', files: ['src/conductor/src/engine/trail.ts'] },
      }),
    ).toEqual({
      allowed: false,
      taskId: '4',
      offendingPaths: ['src/conductor/src/engine/audit-trail.ts'],
    });
  });

  it('allows machinery-authored paths alongside task-declared paths', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: [
          'src/conductor/src/engine/plan-scope-containment.ts',
          '.pipeline/task-status.json',
          '.docs/shipped/pipeline-commits-files-outside-the-active-plan-bef.md',
        ],
        task: { id: '4', files: ['src/conductor/src/engine/plan-scope-containment.ts'] },
      }),
    ).toEqual({ allowed: true });
  });
});
