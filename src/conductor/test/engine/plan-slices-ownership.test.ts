// Covers: task:2, task:18
import { describe, expect, it } from 'vitest';
import { deriveStoryOwnership, type PlanSlice } from '../../src/engine/plan-slices.js';

function task(id: number | string, story?: string, type?: string): string {
  return [
    `### Task ${id}: Task ${id}`,
    ...(story === undefined ? [] : [`**Story:** ${story}`]),
    ...(type === undefined ? [] : [`**Type:** ${type}`]),
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

const declaredStories = (ids: string[]) => new Set(ids);

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
    ]), slices, declaredStories(['1', '2'])))).toEqual({ '1': 1, '2': 2 });
  });

  it('does not assign a task without a Story line or with n/a', () => {
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1'), task(2), task(3), task(4, '2'), task(5, 'n/a'), task(6),
    ]), slices, declaredStories(['1', '2'])))).toEqual({ '1': 1, '2': 2 });
  });

  it('reports each story cited from more than one slice', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1'), task(2, '2'), task(3, '3'), task(4, '1'), task(5, '2'), task(6, '3'),
    ]), slices, declaredStories(['1', '2', '3'])));

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
    ]), remediationSlices, declaredStories(['1'])))).toEqual({ '1': 1 });
  });

  it('reports every multi-id Story line without dropping its ids', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1, 2'), task(2, '1'), task(3), task(4, 'FR-1 and FR-2'), task(5, 'FR-1'), task(6),
    ]), slices, declaredStories(['1', '2', 'FR-1', 'FR-2'])));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'multi-story-line', taskId: '1', message: expect.stringContaining('1, 2') }),
      expect.objectContaining({ code: 'multi-story-line', taskId: '4', message: expect.stringContaining('FR-1 and FR-2') }),
    ]));
  });

  it('rejects an undeclared token on a happy-path task', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1-3', 'happy-path'), task(2, '1'), task(3), task(4, '2'), task(5), task(6),
    ]), slices, declaredStories(['1', '2'])));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unknown-story-id', taskId: '1', message: expect.stringMatching(/task 1.*1-3/i),
      }),
    ]));
  });

  it('treats unrecognized supporting-purpose Story lines as non-owning', () => {
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1'),
      task(2, 'repo release gate (shared helper)', 'infrastructure'),
      task(3, 'repo release gate (shared helper)', 'refactor'),
      task(4, '2'), task(5), task(6),
    ]), slices, declaredStories(['1', '2'])))).toEqual({ '1': 1, '2': 2 });

    const result = violations(deriveStoryOwnership(plan([
      task(1, '1'), task(2), task(3),
      task(4, 'repo release gate (shared helper)', 'happy-path'), task(5, '2'), task(6),
    ]), slices, declaredStories(['1', '2'])));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown-story-id', taskId: '4' }),
    ]));
  });

  it('reports declared stories that no task owns while ignoring infrastructure purpose text', () => {
    const result = violations(deriveStoryOwnership(plan([
      task(1, '1'), task(2, 'release gate and config', 'infrastructure'), task(3),
      task(4, '2'), task(5), task(6),
    ]), slices, declaredStories(['1', '2', '3'])));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'story-unowned', message: expect.stringMatching(/story 3/i) }),
    ]));
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: '2' }),
    ]));
  });

  it('keeps annotated single ids but rejects split happy-path Story lines', () => {
    expect(ownership(deriveStoryOwnership(plan([
      task(1, '1 (source=a, status=b) — happy path'), task(2), task(3),
      task(4, '2'), task(5), task(6),
    ]), slices, declaredStories(['1', '2'])))).toEqual({ '1': 1, '2': 2 });

    const result = violations(deriveStoryOwnership(plan([
      task(1, '1, n/a', 'happy-path'), task(2), task(3), task(4, '2'), task(5), task(6),
    ]), slices, declaredStories(['1', '2'])));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'multi-story-line', taskId: '1' }),
      expect.objectContaining({ code: 'unknown-story-id', taskId: '1', message: expect.stringMatching(/n\/a/i) }),
    ]));
  });
});
