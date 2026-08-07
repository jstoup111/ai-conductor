import { describe, expect, it } from 'vitest';
import {
  evaluateScopeContainment,
  type ScopeContainmentInput,
} from '../../src/engine/plan-scope-containment.js';

describe('evaluateScopeContainment', () => {
  const task = {
    id: '3',
    status: 'in_progress',
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
        task: { id: '3', status: 'in_progress', files: ['engine/config.ts'] },
      }),
    ).toEqual({ allowed: true });
  });

  it('does not over-accept a filename that merely ends in the declared path', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: ['src/conductor/src/engine/audit-trail.ts'],
        task: {
          id: '4',
          status: 'in_progress',
          files: ['src/conductor/src/engine/trail.ts'],
        },
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
        task: {
          id: '4',
          status: 'in_progress',
          files: ['src/conductor/src/engine/plan-scope-containment.ts'],
        },
      }),
    ).toEqual({ allowed: true });
  });

  it('allows a path widened by a Scope trailer for this commit', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: ['src/conductor/src/index.ts'],
        task: { id: '6', status: 'in_progress', files: ['src/conductor/src/engine/scope-trailer.ts'] },
        scopeTrailers: [
          {
            path: 'src/conductor/src/index.ts',
            rationale: 'registers the command',
          },
        ],
      }),
    ).toEqual({ allowed: true });
  });

  it('refuses only an undeclared staged path when another staged path is widened', () => {
    expect(
      evaluateScopeContainment({
        stagedPaths: [
          'src/conductor/src/index.ts',
          'src/conductor/src/engine/artifacts.ts',
        ],
        task: {
          id: '6',
          status: 'in_progress',
          files: ['src/conductor/src/engine/scope-trailer.ts'],
        },
        scopeTrailers: [
          {
            path: 'src/conductor/src/index.ts',
            rationale: 'registers the command',
          },
        ],
      }),
    ).toEqual({
      allowed: false,
      taskId: '6',
      offendingPaths: ['src/conductor/src/engine/artifacts.ts'],
    });
  });

  it.each([
    {
      name: 'no task declares Files anywhere',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        taskId: '3',
        tasks: [{ id: '3', status: 'in_progress' }],
      },
    },
    {
      name: 'no row exists for the stamped task id',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        taskId: '3',
        tasks: [{ id: '4', status: 'in_progress', files: ['src/conductor/src/engine/config.ts'] }],
      },
    },
    {
      name: 'the stamped row has no Files declaration',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        taskId: '3',
        tasks: [
          { id: '3', status: 'in_progress' },
          { id: '4', status: 'pending', files: ['src/conductor/src/engine/config.ts'] },
        ],
      },
    },
    {
      name: 'the stamped row declares no files',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        taskId: '3',
        tasks: [{ id: '3', status: 'in_progress', files: [] }],
      },
    },
    {
      name: 'no task id is supplied',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        tasks: [{ id: '3', status: 'in_progress', files: ['src/conductor/src/engine/config.ts'] }],
      },
    },
    {
      name: 'the stamped row is not in progress',
      input: {
        stagedPaths: ['src/conductor/src/engine/artifacts.ts'],
        taskId: '3',
        tasks: [{ id: '3', status: 'completed', files: ['src/conductor/src/engine/config.ts'] }],
      },
    },
  ] as Array<{ name: string; input: ScopeContainmentInput }>)('abstains when $name', ({ input }) => {
    expect(evaluateScopeContainment(input)).toEqual({ allowed: true });
  });
});
