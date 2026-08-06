import { describe, expect, it } from 'vitest';
import { resolvePlanStoriesPath } from '../../src/engine/plan-stories-reference.js';

describe('resolvePlanStoriesPath', () => {
  it.each([
    ['a bare path', '.docs/stories/feature.md', '.docs/stories/feature.md'],
    ['an inline-code path', '`.docs/stories/feature.md`', '.docs/stories/feature.md'],
    [
      'a Markdown link',
      '[feature stories](../stories/feature.md)',
      '.docs/stories/feature.md',
    ],
    ['an annotated POSIX-absolute path', '`/outside/stories.md` (note)', null],
    ['an annotated Windows drive-absolute path', '`C:\\outside\\stories.md` (note)', null],
    ['an annotated Windows UNC path', '`\\\\server\\share\\stories.md` (note)', null],
    ['an annotated traversal path', '`../../../outside.md` (note)', null],
    ['a non-path first token', 'not-a-path (note)', null],
    ['an empty reference', '', null],
    ['no Stories line', undefined, '.docs/stories/feature.md'],
  ])('preserves the result for %s', (_description, reference, expected) => {
    const planContent = reference === undefined ? '# Plan' : `**Stories:** ${reference}`;

    expect(resolvePlanStoriesPath('.docs/plans/feature.md', planContent)).toBe(expected);
  });

  it('resolves a backticked Stories path with a parenthetical annotation', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** `.docs/stories/feature.md` (accepted)',
    );

    expect(result).toBe('.docs/stories/feature.md');
  });

  it('resolves a bare Stories path with a parenthetical annotation', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** .docs/stories/feature.md (accepted)',
    );

    expect(result).toBe('.docs/stories/feature.md');
  });

  it('resolves a Markdown Stories link with an em-dash annotation', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** [feature stories](../stories/feature.md) — accepted',
    );

    expect(result).toBe('.docs/stories/feature.md');
  });

  it('resolves a backticked Stories path with an unbalanced trailing parenthesis', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** `.docs/stories/feature.md` (accepted',
    );

    expect(result).toBe('.docs/stories/feature.md');
  });

});
