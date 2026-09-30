// Covers: task:1
import { describe, expect, it } from 'vitest';

import { extractCitedPaths } from '../../src/engine/engineer/intake/cited-paths.js';
import { intersectFiles } from '../../src/engine/overlap-scan.js';

describe('engineer/intake/cited-paths', () => {
  it('extracts normalized cited paths, filters known paths, and keeps matching exact', () => {
    expect(extractCitedPaths('Evidence: `src/engine/foo.ts:41`.')).toEqual(['src/engine/foo.ts']);
    expect([...extractCitedPaths('bin/tool'), ...extractCitedPaths('./docs/guide.md#L10')]).toEqual([
      'bin/tool',
      'docs/guide.md',
    ]);
    expect(
      extractCitedPaths(
        'See src/engine/foo.ts:41, and/or, and https://github.com/o/r/pull/5.',
        new Set(['src/engine/foo.ts']),
      ),
    ).toEqual(['src/engine/foo.ts']);
    expect(extractCitedPaths('lib/gone.rb', new Set(['lib/present.rb']))).toEqual([]);
    expect(extractCitedPaths('No evidence cited here.')).toEqual([]);
    expect(intersectFiles(['helper.ts'], ['helperx.ts'])).toEqual([]);
  });
});
