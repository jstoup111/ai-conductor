// Covers: task:4

import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KINDS,
  buildFeatureManifest,
  MANIFEST_KIND_LOCATIONS,
} from '../../src/engine/feature-manifest.js';

describe('buildFeatureManifest', () => {
  it('classifies feature artifacts and changed ADRs by manifest kind', () => {
    expect(
      buildFeatureManifest(
        'f',
        new Set([
          '.docs/plans/f.md',
          '.docs/stories/f.md',
          '.docs/track/f.md',
          '.docs/complexity/f.md',
          '.docs/conflicts/f.md',
          '.docs/coherence/f.md',
          '.docs/architecture/f.md',
          '.docs/intake/f.md',
        ]),
        new Set(['.docs/decisions/adr-x.md']),
      ),
    ).toEqual({
      schemaVersion: 1,
      slug: 'f',
      artifacts: [
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'stories', path: '.docs/stories/f.md' },
        { kind: 'track', path: '.docs/track/f.md' },
        { kind: 'complexity', path: '.docs/complexity/f.md' },
        { kind: 'conflicts', path: '.docs/conflicts/f.md' },
        { kind: 'coherence', path: '.docs/coherence/f.md' },
        { kind: 'architecture', path: '.docs/architecture/f.md' },
        { kind: 'intake', path: '.docs/intake/f.md' },
        { kind: 'decision', path: '.docs/decisions/adr-x.md' },
      ],
    });
  });

  it('omits untracked repository records and its own manifest', () => {
    const manifest = buildFeatureManifest(
      'f',
      new Set([
        '.docs/plans/f.md',
        '.docs/plan-review/f.md',
        '.docs/shipped/f.md',
        '.docs/halted/f.md',
        '.docs/release-waivers/f.md',
        '.docs/f/manifest.json',
        '.docs/other/unmatched.md',
      ]),
      new Set(),
    );

    expect(manifest.artifacts).toEqual([{ kind: 'plan', path: '.docs/plans/f.md' }]);
  });

  it('defines exactly one manifest-kind location for every artifact kind', () => {
    expect(Object.keys(MANIFEST_KIND_LOCATIONS).sort()).toEqual([...ARTIFACT_KINDS].sort());
  });
});
