// Covers: task:3
import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number, dependencies = 'none'): string {
  return `### Task ${id}: Task ${id}\n**Dependencies:** ${dependencies}`;
}

function validPlan(rows: string[], tasks = Array.from({ length: 8 }, (_, index) => index + 1)): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...tasks.map((id) => task(id)),
  ].join('\n');
}

describe('validatePlanSlices', () => {
  it('returns unsliced when the plan has no Slices section', () => {
    expect(validatePlanSlices(task(1))).toEqual({ kind: 'unsliced' });
  });

  it('returns unsliced when the only Slices table is fenced', () => {
    const plan = [
      '# Plan',
      '```markdown',
      '## Slices',
      '| Slice | Title | Tasks |',
      '| --- | --- | --- |',
      '| 1 | Example | 1 |',
      '```',
      '',
      task(1),
    ].join('\n');

    expect(validatePlanSlices(plan)).toEqual({ kind: 'unsliced' });
  });

  it('returns the eight-task manifest in slice position order', () => {
    const result = validatePlanSlices(validPlan([
      '| 1 | Config flag | 1, 2, 3 |',
      '| 2 | Land validation | 4, 5, 6 |',
      '| 3 | Re-validation | 7, 8 |',
    ]));

    expect(result).toEqual({
      kind: 'sliced',
      slices: [
        { position: 1, title: 'Config flag', taskIds: ['1', '2', '3'] },
        { position: 2, title: 'Land validation', taskIds: ['4', '5', '6'] },
        { position: 3, title: 'Re-validation', taskIds: ['7', '8'] },
      ],
    });
  });

  it('resolves annotations in Tasks cells', () => {
    const result = validatePlanSlices(validPlan([
      '| 1 | First | 1, 2, 3 |',
      '| 2 | Second | 4 (landed), 5 |',
      '| 3 | Third | 6, 7, 8 |',
    ]));

    expect(result).toEqual({
      kind: 'sliced',
      slices: [
        { position: 1, title: 'First', taskIds: ['1', '2', '3'] },
        { position: 2, title: 'Second', taskIds: ['4', '5'] },
        { position: 3, title: 'Third', taskIds: ['6', '7', '8'] },
      ],
    });
  });

  it('collapses repeated task ids in a Tasks cell', () => {
    const result = validatePlanSlices(validPlan([
      '| 1 | First | 1 |',
      '| 2 | Second | 2, 2, 3 |',
      '| 3 | Third | 4, 5, 6, 7, 8 |',
    ]));

    expect(result).toEqual({
      kind: 'sliced',
      slices: [
        { position: 1, title: 'First', taskIds: ['1'] },
        { position: 2, title: 'Second', taskIds: ['2', '3'] },
        { position: 3, title: 'Third', taskIds: ['4', '5', '6', '7', '8'] },
      ],
    });
  });

  it('orders gap-separated positions numerically', () => {
    const result = validatePlanSlices(validPlan([
      '| 7 | Third | 6, 7, 8 |',
      '| 1 | First | 1, 2, 3 |',
      '| 3 | Second | 4, 5 |',
    ]));

    expect(result).toEqual({
      kind: 'sliced',
      slices: [
        { position: 1, title: 'First', taskIds: ['1', '2', '3'] },
        { position: 3, title: 'Second', taskIds: ['4', '5'] },
        { position: 7, title: 'Third', taskIds: ['6', '7', '8'] },
      ],
    });
  });
});
