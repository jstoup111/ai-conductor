// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  parsePlanDependencyGraph,
  transitiveDependencies,
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
