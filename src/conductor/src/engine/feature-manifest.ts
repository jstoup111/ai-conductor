export const ARTIFACT_KINDS = [
  'plan',
  'stories',
  'prd',
  'track',
  'complexity',
  'conflicts',
  'coherence',
  'coherence-waiver',
  'architecture',
  'intake',
  'applicability',
  'decision',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type FeatureScopedKind = Exclude<ArtifactKind, 'architecture' | 'decision'>;

declare const featureSlugBrand: unique symbol;
export type FeatureSlug = string & { readonly [featureSlugBrand]: 'FeatureSlug' };

declare const docsPathBrand: unique symbol;
export type DocsPath = string & { readonly [docsPathBrand]: 'DocsPath' };

export interface FeatureManifestEntry {
  readonly kind: ArtifactKind;
  readonly path: DocsPath;
}

export interface FeatureManifest {
  readonly schemaVersion: 1;
  readonly slug: FeatureSlug;
  readonly artifacts: readonly FeatureManifestEntry[];
}

export type ParseFeatureManifestResult =
  | { readonly kind: 'parsed'; readonly manifest: FeatureManifest }
  | { readonly kind: 'malformed'; readonly manifestPath: DocsPath; readonly reason: string };

export function featureManifestPath(slug: string): DocsPath {
  return `.docs/${slug}/manifest.json` as DocsPath;
}

export function renderFeatureManifest(manifest: FeatureManifest): string {
  const artifacts = [...manifest.artifacts].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind < right.kind ? -1 : 1;
    }

    if (left.path === right.path) {
      return 0;
    }

    return left.path < right.path ? -1 : 1;
  });

  return `${JSON.stringify(
    {
      schemaVersion: manifest.schemaVersion,
      slug: manifest.slug,
      artifacts,
    },
    null,
    2,
  )}\n`;
}

/**
 * Task 1 intentionally accepts only the established valid manifest shape.
 * Validation and malformed-result branches are added by Task 3.
 */
export function parseFeatureManifest(
  raw: string,
  _manifestPath: string,
  _folderSlug: string,
): ParseFeatureManifestResult {
  return {
    kind: 'parsed',
    manifest: JSON.parse(raw) as FeatureManifest,
  };
}
