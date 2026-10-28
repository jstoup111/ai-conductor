// Covers: task:1, task:2, task:3

import { describe, expect, it } from 'vitest';
import {
  type FeatureManifest,
  type ParseFeatureManifestResult,
  featureManifestPath,
  parseFeatureManifest,
  renderFeatureManifest,
} from '../../src/engine/feature-manifest.js';

const asManifest = (value: unknown): FeatureManifest => value as FeatureManifest;

function reasonOf(result: ParseFeatureManifestResult): string {
  if (result.kind !== 'malformed') throw new Error(`expected malformed, got ${result.kind}`);
  return result.reason;
}

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

  it('renders differently ordered entries as byte-identical kind-then-path JSON', () => {
    const entries = [
      { kind: 'stories', path: '.docs/stories/f.md' },
      { kind: 'plan', path: '.docs/plans/z-f.md' },
      { kind: 'plan', path: '.docs/plans/a-f.md' },
    ] as const;
    const manifest = { schemaVersion: 1, slug: 'f', artifacts: entries } as const;
    const reversedManifest = {
      ...manifest,
      artifacts: [...entries].reverse(),
    } as const;

    const rendered = renderFeatureManifest(asManifest(manifest));

    expect(renderFeatureManifest(asManifest(reversedManifest))).toBe(rendered);
    expect(rendered).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slug: 'f',
          artifacts: [
            { kind: 'plan', path: '.docs/plans/a-f.md' },
            { kind: 'plan', path: '.docs/plans/z-f.md' },
            { kind: 'stories', path: '.docs/stories/f.md' },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it('renders only manifest fields that parse back to the same entries', () => {
    const manifest = {
      schemaVersion: 1,
      slug: 'f',
      artifacts: [
        { kind: 'stories', path: '.docs/stories/f.md' },
        { kind: 'plan', path: '.docs/plans/f.md' },
      ],
    } as const;
    const rendered = renderFeatureManifest(asManifest(manifest));

    expect(Object.keys(JSON.parse(rendered))).toEqual(['schemaVersion', 'slug', 'artifacts']);
    expect(parseFeatureManifest(rendered, '.docs/f/manifest.json', 'f')).toEqual({
      kind: 'parsed',
      manifest: {
        ...manifest,
        artifacts: [
          { kind: 'plan', path: '.docs/plans/f.md' },
          { kind: 'stories', path: '.docs/stories/f.md' },
        ],
      },
    });
  });

  it('rejects unsupported schema versions and unknown artifact kinds by name', () => {
    const unsupportedSchema = parseFeatureManifest(
      JSON.stringify({ ...allKindsManifest, schemaVersion: 2 }),
      '.docs/f/manifest.json',
      'f',
    );
    const unknownKind = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [{ kind: 'notes', path: '.docs/f/notes.md' }],
      }),
      '.docs/f/manifest.json',
      'f',
    );

    expect(unsupportedSchema).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(unsupportedSchema)).toContain('2');
    expect(unknownKind).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(unknownKind)).toContain('notes');
  });

  it('rejects unknown top-level and entry fields by name', () => {
    const unknownTopLevelField = parseFeatureManifest(
      JSON.stringify({ ...allKindsManifest, updatedAt: '2026-10-25T00:00:00Z' }),
      '.docs/f/manifest.json',
      'f',
    );
    const unknownEntryField = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [{ kind: 'plan', path: '.docs/plans/f.md', title: 'Plan' }],
      }),
      '.docs/f/manifest.json',
      'f',
    );

    expect(unknownTopLevelField).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(unknownTopLevelField)).toContain('updatedAt');
    expect(unknownEntryField).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(unknownEntryField)).toContain('title');
  });

  it('rejects paths outside .docs and decision paths outside .docs/decisions/', () => {
    const outsideDocs = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [{ kind: 'plan', path: 'src/x.md' }],
      }),
      '.docs/f/manifest.json',
      'f',
    );
    const escapingDocs = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [{ kind: 'plan', path: '.docs/../x.md' }],
      }),
      '.docs/f/manifest.json',
      'f',
    );
    const decisionOutsideAdrFolder = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [
          { kind: 'plan', path: '.docs/plans/f.md' },
          { kind: 'decision', path: '.docs/plans/x.md' },
        ],
      }),
      '.docs/f/manifest.json',
      'f',
    );

    expect(outsideDocs).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(outsideDocs)).toMatch(/outside .docs/);
    expect(escapingDocs).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(escapingDocs)).toMatch(/outside .docs/);
    expect(decisionOutsideAdrFolder).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(decisionOutsideAdrFolder)).toMatch(/outside .docs\/decisions/);
  });

  it('rejects folder-slug mismatch and plan entry counts other than one', () => {
    const mismatchedSlug = parseFeatureManifest(
      JSON.stringify({ ...allKindsManifest, slug: 'g' }),
      '.docs/f/manifest.json',
      'f',
    );
    const noPlanEntry = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [{ kind: 'stories', path: '.docs/stories/f.md' }],
      }),
      '.docs/f/manifest.json',
      'f',
    );
    const twoPlanEntries = parseFeatureManifest(
      JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: [
          { kind: 'plan', path: '.docs/plans/f.md' },
          { kind: 'plan', path: '.docs/plans/f-second.md' },
        ],
      }),
      '.docs/f/manifest.json',
      'f',
    );

    expect(mismatchedSlug).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(mismatchedSlug)).toContain('f');
    expect(reasonOf(mismatchedSlug)).toContain('g');
    expect(noPlanEntry).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(noPlanEntry)).toContain('0');
    expect(twoPlanEntries).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(twoPlanEntries)).toContain('2');
  });

  it('names the manifest path when JSON is invalid', () => {
    const result = parseFeatureManifest('{ not valid JSON', '.docs/f/manifest.json', 'f');

    expect(result).toMatchObject({ kind: 'malformed' });
    expect(reasonOf(result)).toContain('.docs/f/manifest.json');
  });
});
