// Covers: task:2
import { describe, expect, it } from 'vitest';
import { deriveStoryOwnership, type PlanSlice } from '../../src/engine/plan-slices.js';

function task(id: number | string, story?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    ...(story === undefined ? [] : [`**Story:** ${story}`]),
    '**Dependencies:** none',
  ].join('\n');
}

function plan(tasks: string[]): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    '| 1 | First | 1, 2, 3 |',
    '| 2 | Second | 4, 5, 6 |',
    '',
    ...tasks,
  ].join('\n');
}

const slices: PlanSlice[] = [
  { position: 1, title: 'First', taskIds: ['1', '2', '3'] },
  { position: 2, title: 'Second', taskIds: ['4', '5', '6'] },
];

function ownership(result: ReturnType<typeof deriveStoryOwnership>) {
  expect(result.kind).toBe('owned');
  if (result.kind !== 'owned') throw new Error('expected owned stories');
  return result.ownership;
}

function violations(result: ReturnType<typeof deriveStoryOwnership>) {
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected ownership violations');
  return result.violations;
}

describe('deriveStoryOwnership', () => {
  it('assigns each story to the slice containing its tasks', () => {
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1'), task(2, '1'), task(3), task(4, '2'), task(5, '2'), task(6),
    ]), slices))).toEqual({ '1': 1, '2': 2 });
  });

  it('does not assign a task without a Story line or with n/a', () => {
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1'), task(2), task(3), task(4, '2'), task(5, 'n/a'), task(6),
    ]), slices))).toEqual({ '1': 1, '2': 2 });
  });

  it('reports each story cited from more than one slice', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1'), task(2, '2'), task(3, '3'), task(4, '1'), task(5, '2'), task(6, '3'),
    ]), slices));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'story-spans-children', message: expect.stringMatching(/story 1.*1.*2/i) }),
      expect.objectContaining({ code: 'story-spans-children', message: expect.stringMatching(/story 2.*1.*2/i) }),
      expect.objectContaining({ code: 'story-spans-children', message: expect.stringMatching(/story 3.*1.*2/i) }),
    ]));
  });

  it('ignores an engine-appended remediation task in a later slice', () => {
    const remediationSlices: PlanSlice[] = [
      { position: 1, title: 'First', taskIds: ['1'] },
      { position: 2, title: 'Second', taskIds: ['rem-test-1'] },
    ];
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1'),
      task('rem-test-1', '1'),
    ]), remediationSlices))).toEqual({ '1': 1 });
  });

  it('reports every multi-id Story line without dropping its ids', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1, 2'), task(2, '1'), task(3), task(4, 'FR-1 and FR-2'), task(5, 'FR-1'), task(6),
    ]), slices));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'multi-story-line', taskId: '1', message: expect.stringContaining('1, 2') }),
      expect.objectContaining({ code: 'multi-story-line', taskId: '4', message: expect.stringContaining('FR-1 and FR-2') }),
    ]));
  });
});
