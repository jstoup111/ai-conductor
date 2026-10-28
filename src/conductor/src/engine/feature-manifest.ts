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

export type ManifestKindIdentity = 'normalized-stem' | 'plan-stem' | 'repository';

export interface ManifestKindLocation {
  readonly directory: string;
  readonly identity: ManifestKindIdentity;
  readonly filePattern: RegExp;
}

/**
 * The legacy home and identity convention for every manifest kind. Keeping the
 * closed kind set as the key makes a new kind impossible to add without first
 * declaring how it maps back to the pre-manifest layout.
 */
export const MANIFEST_KIND_LOCATIONS = {
  plan: { directory: '.docs/plans/', identity: 'plan-stem', filePattern: /\.md$/i },
  stories: { directory: '.docs/stories/', identity: 'normalized-stem', filePattern: /\.md$/i },
  prd: { directory: '.docs/specs/', identity: 'normalized-stem', filePattern: /\.md$/i },
  track: { directory: '.docs/track/', identity: 'plan-stem', filePattern: /\.md$/i },
  complexity: { directory: '.docs/complexity/', identity: 'plan-stem', filePattern: /\.md$/i },
  conflicts: { directory: '.docs/conflicts/', identity: 'normalized-stem', filePattern: /\.md$/i },
  coherence: { directory: '.docs/coherence/', identity: 'plan-stem', filePattern: /\.md$/i },
  'coherence-waiver': { directory: '.docs/coherence-waivers/', identity: 'plan-stem', filePattern: /\.md$/i },
  architecture: { directory: '.docs/architecture/', identity: 'repository', filePattern: /\.md$/i },
  intake: { directory: '.docs/intake/', identity: 'plan-stem', filePattern: /\.md$/i },
  applicability: { directory: '.docs/applicability/', identity: 'plan-stem', filePattern: /\.md$/i },
  decision: { directory: '.docs/decisions/', identity: 'repository', filePattern: /^adr-.*\.md$/i },
} as const satisfies Record<ArtifactKind, ManifestKindLocation>;

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

/**
 * Turn the authored feature change set into the manifest land will write.
 * Repository-wide records and the current manifest are deliberately excluded:
 * they are either transient indexes or the output being rebuilt.
 */
export function buildFeatureManifest(
  slug: string,
  featureFiles: Iterable<string>,
  changedAdrPaths: Iterable<string>,
): FeatureManifest {
  const artifacts: FeatureManifestEntry[] = [];
  const seen = new Set<string>();
  const manifestPath = featureManifestPath(slug);
  const add = (rawPath: string): void => {
    const path = rawPath.replaceAll('\\', '/');
    if (isExcludedManifestPath(path, manifestPath)) return;

    const kind = manifestKindForPath(path);
    if (kind === undefined) return;

    const key = `${kind}\u0000${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    artifacts.push({ kind, path: path as DocsPath });
  };

  for (const path of featureFiles) add(path);
  for (const path of changedAdrPaths) add(path);

  return {
    schemaVersion: 1,
    slug: slug as FeatureSlug,
    artifacts,
  };
}

function isExcludedManifestPath(path: string, manifestPath: DocsPath): boolean {
  return path === manifestPath
    || path.startsWith('.docs/plan-review/')
    || path.startsWith('.docs/shipped/')
    || path.startsWith('.docs/halted/')
    || path.startsWith('.docs/release-waivers/');
}

function manifestKindForPath(path: string): ArtifactKind | undefined {
  for (const kind of ARTIFACT_KINDS) {
    const location = MANIFEST_KIND_LOCATIONS[kind];
    if (!path.startsWith(location.directory)) continue;

    const fileName = path.slice(location.directory.length);
    if (location.filePattern.test(fileName)) return kind;
  }

  return undefined;
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

export function parseFeatureManifest(
  raw: string,
  manifestPath: string,
  folderSlug: string,
): ParseFeatureManifestResult {
  const malformed = (reason: string): ParseFeatureManifestResult => ({
    kind: 'malformed',
    manifestPath: manifestPath as DocsPath,
    reason,
  });

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return malformed(`${manifestPath} is not valid JSON: ${detail}`);
  }

  if (!isRecord(value)) {
    return malformed(`${manifestPath} must contain a JSON object`);
  }

  for (const field of Object.keys(value)) {
    if (field !== 'schemaVersion' && field !== 'slug' && field !== 'artifacts') {
      return malformed(`${manifestPath} has unknown top-level field "${field}"`);
    }
  }

  if (value.schemaVersion !== 1) {
    return malformed(`${manifestPath} has unsupported schema version ${String(value.schemaVersion)}`);
  }

  if (typeof value.slug !== 'string') {
    return malformed(`${manifestPath} must name a string slug`);
  }

  if (value.slug !== folderSlug) {
    return malformed(`${manifestPath} slug "${value.slug}" does not match folder slug "${folderSlug}"`);
  }

  if (!Array.isArray(value.artifacts)) {
    return malformed(`${manifestPath} must contain an artifacts array`);
  }

  const artifacts: FeatureManifestEntry[] = [];
  for (const entry of value.artifacts) {
    if (!isRecord(entry)) {
      return malformed(`${manifestPath} has an artifact entry that is not an object`);
    }

    for (const field of Object.keys(entry)) {
      if (field !== 'kind' && field !== 'path') {
        return malformed(`${manifestPath} has unknown artifact field "${field}"`);
      }
    }

    if (!isArtifactKind(entry.kind)) {
      return malformed(`${manifestPath} has unknown artifact kind "${String(entry.kind)}"`);
    }

    if (typeof entry.path !== 'string') {
      return malformed(`${manifestPath} artifact ${entry.kind} must have a string path`);
    }

    const pathError = validateArtifactPath(entry.kind, entry.path);
    if (pathError !== undefined) {
      return malformed(`${manifestPath} ${pathError}`);
    }

    artifacts.push({ kind: entry.kind, path: entry.path as DocsPath });
  }

  const planCount = artifacts.filter((entry) => entry.kind === 'plan').length;
  if (planCount !== 1) {
    return malformed(`${manifestPath} has ${planCount} plan entries; expected exactly one`);
  }

  return {
    kind: 'parsed',
    manifest: {
      schemaVersion: 1,
      slug: value.slug as FeatureSlug,
      artifacts,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && ARTIFACT_KINDS.some((kind) => kind === value);
}

function validateArtifactPath(kind: ArtifactKind, path: string): string | undefined {
  if (!path.startsWith('.docs/') || path.split('/').includes('..')) {
    return `artifact path "${path}" is outside .docs/`;
  }

  switch (kind) {
    case 'plan':
    case 'stories':
    case 'prd':
    case 'track':
    case 'complexity':
    case 'conflicts':
    case 'coherence':
    case 'coherence-waiver':
    case 'architecture':
    case 'intake':
    case 'applicability':
      return undefined;
    case 'decision':
      return path.startsWith('.docs/decisions/')
        ? undefined
        : `decision path "${path}" is outside .docs/decisions/`;
  }

  const exhaustiveKind: never = kind;
  return exhaustiveKind;
}
