// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import {
  findDependencyCycles,
  parsePlanDependencyGraph,
  transitiveDependencies,
  validatePlanDependencies,
} from '../../src/engine/plan-dependencies.js';

function task(id: number, dependencies?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    ...(dependencies === undefined ? [] : [`**Dependencies:** ${dependencies}`]),
  ].join('\n');
}

function plan(dependencies: Record<number, string | undefined>): string {
  return Array.from({ length: 4 }, (_, index) => {
    const id = index + 1;
    return task(id, Object.hasOwn(dependencies, id) ? dependencies[id] : 'none');
  }).join('\n\n');
}

describe('parsePlanDependencyGraph', () => {
  it('returns each task\'s direct dependencies', () => {
    expect(parsePlanDependencyGraph(plan({
      1: 'none',
      2: 'Task 1',
      3: 'Tasks 1, 2',
      4: 'none',
    }))).toEqual({
      dependenciesByTaskId: new Map([
        ['1', []],
        ['2', ['1']],
        ['3', ['1', '2']],
        ['4', []],
      ]),
      violations: [],
    });
  });

  it.each([
    ['missing line', plan({ 2: undefined }), 'dependencies-line', '2'],
    ['malformed value', plan({ 2: 'all prior.' }), 'malformed-dependencies', '2'],
    ['unknown id', plan({ 2: 'Task 99' }), 'unknown-dependency', '2'],
  ])('reports %s with its task id', (_name, planText, code, taskId) => {
    expect(parsePlanDependencyGraph(planText)).toEqual({
      dependenciesByTaskId: expect.any(Map),
      violations: [expect.objectContaining({ code, taskId })],
    });
  });
});

describe('transitiveDependencies', () => {
  it('returns the full three-hop closure', () => {
    const graph = parsePlanDependencyGraph(plan({
      1: 'none',
      2: 'Task 1',
      3: 'Task 2',
      4: 'Task 3',
    }));
    expect(transitiveDependencies(graph.dependenciesByTaskId, '4')).toEqual(new Set(['3', '2', '1']));
  });
});

describe('findDependencyCycles', () => {
  it('returns a two-task dependency cycle', () => {
    expect(findDependencyCycles(new Map([
      ['1', ['2']],
      ['2', ['1']],
    ]))).toEqual([['1', '2']]);
  });

  it('returns a three-task cycle without its independent task', () => {
    expect(findDependencyCycles(new Map([
      ['1', []],
      ['3', ['5']],
      ['5', ['7']],
      ['7', ['3']],
    ]))).toEqual([['3', '5', '7']]);
  });

  it('returns a self-dependency as a one-task cycle', () => {
    expect(findDependencyCycles(new Map([
      ['1', []],
      ['2', ['2']],
    ]))).toEqual([['2']]);
  });

  it('returns no cycles for an acyclic diamond', () => {
    expect(findDependencyCycles(new Map([
      ['1', []],
      ['2', ['1']],
      ['3', ['1']],
      ['4', ['2', '3']],
    ]))).toEqual([]);
  });
});

describe('validatePlanDependencies', () => {
  it('accepts an acyclic plan and ignores engine-appended remediation tasks without Dependencies', () => {
    const planText = [
      task(1, 'none'),
      task(2, 'Task 1'),
      task(3, 'Task 2'),
      '### Task rem-1: Engine remediation',
      'Remediation tasks do not require authored dependency metadata.',
    ].join('\n\n');

    expect(validatePlanDependencies(planText)).toEqual([]);
  });

  it('reports a two-task dependency cycle', () => {
    const violations = validatePlanDependencies([task(1, 'Task 2'), task(2, 'Task 1')].join('\n\n'));

    expect(violations).toEqual([{
      code: 'dependency-cycle',
      taskId: '1',
      message: 'Tasks 1, 2 form a dependency cycle and cannot be ordered',
    }]);
  });

  it('reports a three-task dependency cycle without its independent task', () => {
    const violations = validatePlanDependencies([
      task(1, 'none'),
      task(3, 'Task 5'),
      task(5, 'Task 7'),
      task(7, 'Task 3'),
    ].join('\n\n'));

    expect(violations).toEqual([{
      code: 'dependency-cycle',
      taskId: '3',
      message: 'Tasks 3, 5, 7 form a dependency cycle and cannot be ordered',
    }]);
  });

  it('reports a self-dependency cycle', () => {
    const violations = validatePlanDependencies([task(1, 'none'), task(2, 'Task 2')].join('\n\n'));

    expect(violations).toEqual([{
      code: 'dependency-cycle',
      taskId: '2',
      message: 'Tasks 2 form a dependency cycle and cannot be ordered',
    }]);
  });

  it('reports unknown dependency task ids with their citing task', () => {
    const violations = validatePlanDependencies([task(1, 'none'), task(2, 'Task 99')].join('\n\n'));

    expect(violations).toEqual([expect.objectContaining({
      code: 'unknown-dependency',
      taskId: '2',
      message: expect.stringContaining('Task 99'),
    })]);
    expect(violations[0].message).toContain('Task 2');
  });

  it('reports missing Dependencies lines for every authored task', () => {
    const planText = [
      task(1),
      task(2),
      '### Task rem-1: Engine remediation',
      '## Task Dependency Graph',
      '```text',
      'Task 1 --> Task 2',
      '```',
    ].join('\n\n');

    expect(validatePlanDependencies(planText)).toEqual([
      expect.objectContaining({ code: 'dependencies-line', taskId: '1', message: expect.stringContaining('Task 1') }),
      expect.objectContaining({ code: 'dependencies-line', taskId: '2', message: expect.stringContaining('Task 2') }),
    ]);
  });

  it('reports range Dependencies as malformed', () => {
    const violations = validatePlanDependencies([task(1, 'none'), task(2, 'Tasks 1–9')].join('\n\n'));

    expect(violations).toEqual([expect.objectContaining({
      code: 'malformed-dependencies',
      taskId: '2',
      message: expect.stringContaining('expected "none" or comma-separated task references'),
    })]);
    expect(violations[0].message).toContain('Task 2');
  });

  it('reports free-prose Dependencies as malformed', () => {
    const violations = validatePlanDependencies([task(1, 'none'), task(2, 'all prior')].join('\n\n'));

    expect(violations).toEqual([expect.objectContaining({
      code: 'malformed-dependencies',
      taskId: '2',
      message: expect.stringContaining('expected "none" or comma-separated task references'),
    })]);
    expect(violations[0].message).toContain('Task 2');
  });
});
