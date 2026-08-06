import { describe, expect, it } from 'vitest';
import { resolvePlanStoriesPath } from '../../src/engine/plan-stories-reference.js';

describe('resolvePlanStoriesPath', () => {
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

  it('rejects a Windows drive-absolute Stories reference on every host OS', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** C:\\outside\\stories.md',
    );

    expect(result).toBeNull();
  });

  it('rejects a Windows UNC Stories reference on every host OS', () => {
    const result = resolvePlanStoriesPath(
      '.docs/plans/feature.md',
      '**Stories:** \\\\server\\share\\stories.md',
    );

    expect(result).toBeNull();
  });
});
