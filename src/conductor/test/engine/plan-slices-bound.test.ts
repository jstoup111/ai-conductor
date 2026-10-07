// Covers: task:6, task:8
import { describe, expect, it } from 'vitest';
import { MAX_CHILD_ID } from '../../src/engine/child-context.js';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number): string {
  return `### Task ${id}: Task ${id}\n**Dependencies:** none`;
}

function slicedPlan(rows: string[], taskCount = rows.length): string {
  return [
    '# Plan',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...Array.from({ length: taskCount }, (_, index) => task(index + 1)),
  ].join('\n');
}

function sliceRows(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `| ${index + 1} | Slice ${index + 1} | ${index + 1} |`);
}

describe('plan slice bound', () => {
  it('exports a fixed bound, keeps the validator configuration-free, and enforces that bound', () => {
    expect(MAX_CHILD_ID).toBe(9);
    expect(validatePlanSlices).toHaveLength(1);

    const withinBound = validatePlanSlices(slicedPlan(sliceRows(MAX_CHILD_ID)));
    expect(withinBound).toMatchObject({ kind: 'sliced' });
    expect(withinBound.kind === 'sliced' && withinBound.slices).toHaveLength(9);

    const result = validatePlanSlices(slicedPlan(sliceRows(MAX_CHILD_ID + 1)));
    expect(result).toMatchObject({ kind: 'invalid' });
    expect(result.kind === 'invalid' && result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'max-slices',
        message: expect.stringContaining('plan declares 10 slices and the bound is 9'),
      }),
    ]));
  });

  it('accepts one slice holding every task', () => {
    expect(validatePlanSlices(slicedPlan(['| 1 | Everything | 1, 2, 3, 4, 5, 6 |'], 6))).toMatchObject({ kind: 'sliced' });
  });

  it('aggregates the slice bound and an empty slice into one invalid result', () => {
    const result = validatePlanSlices(slicedPlan([
      ...sliceRows(MAX_CHILD_ID + 1).slice(0, 8),
      '| 9 | Ninth | |',
      '| 10 | Tenth | 10 |',
    ]));

    expect(result).toMatchObject({ kind: 'invalid' });
    expect(result.kind === 'invalid' && result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'max-slices', message: expect.stringContaining('bound is 9') }),
      expect.objectContaining({ code: 'empty-slice', position: 9 }),
    ]));
  });
});
