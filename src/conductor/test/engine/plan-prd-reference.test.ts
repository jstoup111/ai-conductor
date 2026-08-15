import { describe, expect, it } from 'vitest';
import { resolvePlanPrdPath } from '../../src/engine/plan-prd-reference.js';

describe('resolvePlanPrdPath', () => {
  it.each([
    ['a bare path', '.docs/specs/older-prd.md', '.docs/specs/older-prd.md'],
    ['an inline-code path', '`.docs/specs/older-prd.md`', '.docs/specs/older-prd.md'],
    [
      'a Markdown link',
      '[older prd](../specs/older-prd.md)',
      '.docs/specs/older-prd.md',
    ],
    ['an annotated POSIX-absolute path', '`/outside/prd.md` (note)', null],
    ['an annotated Windows drive-absolute path', '`C:\\outside\\prd.md` (note)', null],
    ['an annotated traversal path', '`../../../outside.md` (note)', null],
    ['an annotated path outside the docs tree', '../../outside.md (annotated)', null],
    ['a path outside .docs/specs', '.docs/stories/feature.md', null],
    ['a non-path first token', 'not-a-path (note)', null],
    ['an empty reference', '', null],
  ])('preserves the result for %s', (_description, reference, expected) => {
    const planContent = `**PRD:** ${reference}`;

    expect(resolvePlanPrdPath('.docs/plans/feature.md', planContent)).toBe(expected);
  });

  it('returns null when the plan has no PRD line', () => {
    expect(resolvePlanPrdPath('.docs/plans/feature.md', '# Plan')).toBeNull();
  });

  it('resolves a backticked PRD path with a parenthetical annotation', () => {
    const result = resolvePlanPrdPath(
      '.docs/plans/feature.md',
      '**PRD:** `.docs/specs/older-prd.md` (amends this feature)',
    );

    expect(result).toBe('.docs/specs/older-prd.md');
  });

  it('resolves a Markdown PRD link with an em-dash annotation', () => {
    const result = resolvePlanPrdPath(
      '.docs/plans/feature.md',
      '**PRD:** [older prd](../specs/older-prd.md) — amended',
    );

    expect(result).toBe('.docs/specs/older-prd.md');
  });
});
