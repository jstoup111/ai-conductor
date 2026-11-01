// Covers: task:1
import { describe, expect, it } from 'vitest';

import { citedRepositoryPaths } from '../../../src/engine/routing/cited-repository-paths.js';

describe('citedRepositoryPaths', () => {
  it('strips parentheses that wrap a cited filename', () => {
    const paths = citedRepositoryPaths('rotation (register-artifact-cli.ts) audit');

    expect(paths).toEqual(['register-artifact-cli.ts']);
    expect(paths).not.toContain(expect.stringMatching(/^\(/));
  });

  it('strips square brackets and angle brackets that wrap cited paths', () => {
    expect(citedRepositoryPaths('see [src/engine/a.ts] and <restack/restack-sync.ts>'))
      .toEqual(['src/engine/a.ts', 'restack/restack-sync.ts']);
  });

  it('preserves existing line-suffix and trailing-punctuation cleanup', () => {
    expect(citedRepositoryPaths('see src/engine/a.ts:41.')).toEqual(['src/engine/a.ts']);
  });
});
