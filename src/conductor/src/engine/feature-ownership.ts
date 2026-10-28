import type { ArtifactKind } from '../types/feature-manifest.js';
import {
  featureManifestPath,
  MANIFEST_KIND_LOCATIONS,
  parseFeatureManifest,
  type DocsPath,
} from './feature-manifest.js';
import { worktreeManifestSource, type ManifestSource } from './feature-manifest-source.js';
import { makeGitRunner, type GitRunner } from './rebase.js';

export interface FeatureOwnershipSource extends ManifestSource {
  featureAddedPaths(baseRef: string): Promise<readonly string[]>;
}

export type OwnershipDriftReason = 'missing' | 'unlisted';

export interface OwnershipDrift {
  readonly path: string;
  readonly reason: OwnershipDriftReason;
}

export type FeatureOwnership =
  | { readonly kind: 'legacy' }
  | {
    readonly kind: 'manifest';
    readonly manifestPath: DocsPath;
    readonly ownedPaths: readonly DocsPath[];
    readonly protectedPaths: readonly DocsPath[];
  }
  | { readonly kind: 'malformed'; readonly manifestPath: DocsPath; readonly reason: string }
  | { readonly kind: 'drift'; readonly manifestPath: DocsPath; readonly drift: readonly OwnershipDrift[] };

export type OwnershipRefusal = Extract<FeatureOwnership, { readonly kind: 'malformed' | 'drift' }>;

const PROTECTED_KINDS = new Set<ArtifactKind>(['plan', 'stories', 'prd', 'architecture', 'decision']);

/**
 * Creates the worktree source used at BUILD and SHIP boundaries. Keeping the
 * diff behind the source lets callers with prefetched trees provide their own
 * feature-added path view without teaching ownership policy about storage.
 */
export function worktreeFeatureOwnershipSource(
  root: string,
  git: GitRunner = makeGitRunner(root),
): FeatureOwnershipSource {
  const manifests = worktreeManifestSource(root);
  return {
    ...manifests,
    async featureAddedPaths(baseRef) {
      const mergeBase = await git(['merge-base', baseRef, 'HEAD']);
      const mergeBaseSha = mergeBase.stdout.trim();
      if (mergeBase.exitCode !== 0 || !mergeBaseSha) {
        throw new Error(`Could not resolve merge base of HEAD and ${baseRef}: ${mergeBase.stderr.trim() || 'no merge base found'}`);
      }

      const [added, untracked] = await Promise.all([
        git(['diff', '--name-only', '--diff-filter=A', `${mergeBaseSha}..HEAD`]),
        git(['ls-files', '--others', '--exclude-standard']),
      ]);
      if (added.exitCode !== 0) {
        throw new Error(`Could not list feature-added paths: ${added.stderr.trim() || `git exited ${added.exitCode}`}`);
      }
      if (untracked.exitCode !== 0) {
        throw new Error(`Could not list untracked paths: ${untracked.stderr.trim() || `git exited ${untracked.exitCode}`}`);
      }

      return [...parseGitPaths(added.stdout), ...parseGitPaths(untracked.stdout)];
    },
  };
}

/**
 * Reads the one manifest-backed ownership result every path policy consumes.
 * Legacy features intentionally return before any Git comparison, preserving
 * their existing folder-and-stem policy paths.
 */
export async function computeFeatureOwnership(
  source: FeatureOwnershipSource,
  slug: string,
  baseRef: string,
): Promise<FeatureOwnership> {
  const manifestPath = featureManifestPath(slug);
  if (!await source.exists(manifestPath)) return { kind: 'legacy' };

  const rawManifest = await source.readFile(manifestPath);
  if (rawManifest === null) return { kind: 'legacy' };

  const parsed = parseFeatureManifest(rawManifest, manifestPath, slug);
  if (parsed.kind === 'malformed') {
    return { kind: 'malformed', manifestPath: parsed.manifestPath, reason: parsed.reason };
  }

  const ownedPaths = parsed.manifest.artifacts.map((entry) => entry.path);
  const present = await Promise.all(ownedPaths.map((path) => source.exists(path)));
  const drift: OwnershipDrift[] = ownedPaths
    .filter((_, index) => !present[index])
    .map((path) => ({ path, reason: 'missing' }));
  const listed = new Set(ownedPaths);
  const seenUnlisted = new Set<string>();

  for (const rawPath of await source.featureAddedPaths(baseRef)) {
    const path = normalizeRepoPath(rawPath);
    if (!isInScope(path, slug, manifestPath) || listed.has(path as DocsPath) || seenUnlisted.has(path)) continue;
    seenUnlisted.add(path);
    drift.push({ path, reason: 'unlisted' });
  }

  if (drift.length > 0) return { kind: 'drift', manifestPath, drift };

  return {
    kind: 'manifest',
    manifestPath,
    ownedPaths,
    protectedPaths: parsed.manifest.artifacts
      .filter((entry) => PROTECTED_KINDS.has(entry.kind))
      .map((entry) => entry.path),
  };
}

export function renderOwnershipRefusal(ownership: OwnershipRefusal): string {
  if (ownership.kind === 'malformed') {
    return `Feature artifact manifest is malformed:\n${ownership.reason}\nFix the manifest file before continuing.`;
  }

  return [
    'Feature artifact manifest drift:',
    ...ownership.drift.map(({ path, reason }) => reason === 'missing'
      ? `${path}: missing — restore the file.`
      : `${path}: unlisted — register it with ai-conductor register-artifact.`),
  ].join('\n');
}

function parseGitPaths(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(normalizeRepoPath).filter(Boolean);
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isInScope(path: string, slug: string, manifestPath: DocsPath): boolean {
  if (path === manifestPath
    || path.startsWith('.docs/plan-review/')
    || path.startsWith('.docs/shipped/')
    || path.startsWith('.docs/halted/')
    || path.startsWith('.docs/release-waivers/')) {
    return false;
  }
  if (path.startsWith(`.docs/${slug}/`)) return true;

  return Object.values(MANIFEST_KIND_LOCATIONS).some((location) => {
    if (!path.startsWith(location.directory)) return false;
    return location.filePattern.test(path.slice(location.directory.length));
  });
}
