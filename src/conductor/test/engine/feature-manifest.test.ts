// Covers: task:1

import { describe, expect, it } from 'vitest';
import { featureManifestPath, parseFeatureManifest } from '../../src/engine/feature-manifest.js';

const allKindsManifest = {
  schemaVersion: 1,
  slug: 'f',
  artifacts: [
    { kind: 'plan', path: '.docs/plans/f.md' },
    { kind: 'stories', path: '.docs/stories/f.md' },
    { kind: 'prd', path: '.docs/specs/f.md' },
    { kind: 'track', path: '.docs/track/f.md' },
    { kind: 'complexity', path: '.docs/complexity/f.md' },
    { kind: 'conflicts', path: '.docs/conflicts/f.md' },
    { kind: 'coherence', path: '.docs/coherence/f.md' },
    { kind: 'coherence-waiver', path: '.docs/coherence-waivers/f.md' },
    { kind: 'architecture', path: '.docs/architecture/f.md' },
    { kind: 'intake', path: '.docs/intake/f.md' },
    { kind: 'applicability', path: '.docs/applicability/f.md' },
    { kind: 'decision', path: '.docs/decisions/adr-f.md' },
  ],
} as const;

describe('feature manifest', () => {
  it('parses every artifact kind into typed entries', () => {
    expect(
      parseFeatureManifest(
        JSON.stringify(allKindsManifest),
        '.docs/f/manifest.json',
        'f',
      ),
    ).toEqual({
      kind: 'parsed',
      manifest: allKindsManifest,
    });
  });

  it('preserves multiple decision entries', () => {
    const manifest = {
      ...allKindsManifest,
      artifacts: [
        ...allKindsManifest.artifacts,
        { kind: 'decision', path: '.docs/decisions/adr-f-amendment.md' },
      ],
    } as const;

    expect(
      parseFeatureManifest(JSON.stringify(manifest), '.docs/f/manifest.json', 'f'),
    ).toEqual({
      kind: 'parsed',
      manifest,
    });
  });

  it('builds the manifest path from a feature slug', () => {
    expect(featureManifestPath('f')).toBe('.docs/f/manifest.json');
  });
});
