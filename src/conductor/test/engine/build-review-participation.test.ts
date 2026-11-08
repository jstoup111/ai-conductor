// Covers: task:3
import { describe, expect, it } from 'vitest';

import { resolveBuildReviewLapParticipation } from '../../src/engine/build-review-inputs.js';
import type { ChangedFileReference } from '../../src/engine/build-review-projections.js';
import type { ResolvedBuildReviewCatalogEntry, ResolvedBuildReviewCustomCatalogEntry, ResolvedBuildReviewRubricPolicy } from '../../src/engine/resolved-config.js';

const policy = {
  enabled: true,
  max_projection_bytes: 1,
  llm_provider: 'codex',
  model: 'gpt-5',
  effort: 'low',
  model_fallback_ladder: [],
  max_retries: 0,
  escalate: false,
  min_confidence: 0,
} as const satisfies ResolvedBuildReviewRubricPolicy;

function builtin(id: 'security' | 'implementationQuality'): ResolvedBuildReviewCatalogEntry {
  return { id, kind: 'builtin', policy };
}

function custom(id: string, paths?: readonly string[]): ResolvedBuildReviewCustomCatalogEntry {
  return {
    id,
    kind: 'custom',
    skill: 'build-review-dependency-hygiene',
    question: 'Review dependency changes.',
    resources: [],
    ...(paths === undefined ? {} : { paths }),
    policy,
    contract: {} as ResolvedBuildReviewCustomCatalogEntry['contract'],
  };
}

function changed(path: string, patch: Partial<ChangedFileReference> = {}): ChangedFileReference {
  return { path, changeKind: 'modified', hunks: [], ...patch };
}

describe('resolveBuildReviewLapParticipation', () => {
  it('withholds unmatched path-triggered custom entries', () => {
    const dependency = custom('dependencyHygiene', ['**/package.json']);

    expect(resolveBuildReviewLapParticipation(
      [dependency],
      [changed('src/a.ts'), changed('test/a.test.ts')],
    )).toEqual({ participating: [], withheld: ['dependencyHygiene'] });
  });

  it('participates for modified, previous rename, and deleted matching paths', () => {
    const manifest = custom('manifest', ['**/package.json']);
    const legacy = custom('legacy', ['old/package.json']);

    expect(resolveBuildReviewLapParticipation(
      [manifest, legacy],
      [
        changed('src/conductor/package.json'),
        changed('new/manifest.json', { changeKind: 'renamed', previousPath: 'old/package.json' }),
        changed('tools/package.json', { changeKind: 'deleted' }),
      ],
    )).toEqual({ participating: [manifest, legacy], withheld: [] });
  });

  it('treats a root-only glob as unrelated to a nested path', () => {
    const rootManifest = custom('rootManifest', ['package.json']);

    expect(resolveBuildReviewLapParticipation(
      [rootManifest],
      [changed('src/conductor/package.json')],
    )).toEqual({ participating: [], withheld: ['rootManifest'] });
  });

  it('keeps built-ins and path-less custom entries active for empty changed files', () => {
    const security = builtin('security');
    const always = custom('always');
    const dependency = custom('dependencyHygiene', ['**/package.json']);

    expect(resolveBuildReviewLapParticipation(
      [security, always, dependency],
      [],
    )).toEqual({ participating: [security, always], withheld: ['dependencyHygiene'] });
  });

  it('preserves catalog order in active and paths-unmatched partitions', () => {
    const first = custom('first', ['**/package.json']);
    const security = builtin('security');
    const second = custom('second', ['**/package-lock.json']);
    const always = custom('always');

    expect(resolveBuildReviewLapParticipation(
      [first, security, second, always],
      [changed('src/a.ts')],
    )).toEqual({
      participating: [security, always],
      withheld: ['first', 'second'],
    });
  });
});
