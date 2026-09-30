// Covers: task:5
import { describe, expect, it } from 'vitest';
import { validatePlanSlices } from '../../src/engine/plan-slices.js';

function task(id: number): string {
  return `### Task ${id}: Task ${id}\n**Dependencies:** none`;
}

function planWithManifest(manifest: string, suffix = task(1)): string {
  return ['# Plan', '', manifest, '', suffix].join('\n');
}

function invalidMessage(plan: string): string {
  const result = validatePlanSlices(plan);
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected invalid plan slices');
  return result.violations.map(({ message }) => message).join('; ');
}

const VALID_TABLE = [
  '## Slices',
  '',
  '| Slice | Title | Tasks |',
  '| --- | --- | --- |',
  '| 1 | First | 1 |',
].join('\n');

describe('validatePlanSlices manifest grammar', () => {
  it('rejects a Slices section after the first task heading', () => {
    const message = invalidMessage(['# Plan', '', task(1), '', VALID_TABLE].join('\n'));

    expect(message).toMatch(/Slices section.*before.*first task/i);
  });

  it('rejects header columns other than Slice, Title, Tasks', () => {
    const message = invalidMessage(planWithManifest(VALID_TABLE.replace('| Slice | Title | Tasks |', '| Slice | Name | Tasks |')));

    expect(message).toContain('Slice, Title, Tasks');
  });

  it('rejects a non-delimiter second table line and names it', () => {
    const delimiter = '| a | b | c |';
    const message = invalidMessage(planWithManifest(VALID_TABLE.replace('| --- | --- | --- |', delimiter)));

    expect(message).toContain(delimiter);
  });

  it('rejects a pipe row with more than three cells after complete assignments', () => {
    const row = '| 3 | Extra | 4 | x |';
    const message = invalidMessage(planWithManifest(`${VALID_TABLE}\n${row}`));

    expect(message).toContain(row);
  });

  it('rejects an empty Title cell and names its slice position', () => {
    const message = invalidMessage(planWithManifest(VALID_TABLE.replace('| 1 | First | 1 |', '| 1 |  | 1 |')));

    expect(message).toMatch(/slice 1.*empty.*Title/i);
  });

  it('rejects a non-positive-integer Slice cell', () => {
    const message = invalidMessage(planWithManifest(VALID_TABLE.replace('| 1 | First | 1 |', '| two | First | 1 |')));

    expect(message).toMatch(/positive integer/i);
  });

  it('rejects a second Slices section', () => {
    const message = invalidMessage(planWithManifest(`${VALID_TABLE}\n\n${VALID_TABLE.replace('| 1 | First | 1 |', '| 2 | Second | 1 |')}`));

    expect(message).toMatch(/at most one Slices section/i);
  });

  it('rejects a Tasks cell with an empty segment and names the slice', () => {
    const message = invalidMessage(planWithManifest(VALID_TABLE.replace('| 1 | First | 1 |', '| 1 | First | 1,,2 |'), [task(1), task(2)].join('\n')));

    expect(message).toMatch(/slice 1.*malformed Tasks cell/i);
  });
});
