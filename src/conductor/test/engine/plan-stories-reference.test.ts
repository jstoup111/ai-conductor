import { describe, expect, it } from 'vitest';
import { resolvePlanStoriesPath } from '../../src/engine/plan-stories-reference.js';

describe('resolvePlanStoriesPath', () => {
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
