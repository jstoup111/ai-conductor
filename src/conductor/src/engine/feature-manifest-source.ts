import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BacklogTreeSource } from './backlog-tree-source.js';
import {
  featureManifestPath,
  parseFeatureManifest,
  type FeatureScopedKind,
} from './feature-manifest.js';

const execFile = promisify(execFileCallback);

export interface ManifestSource {
  readFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

export class MalformedFeatureManifestError extends Error {}

export function worktreeManifestSource(root: string): ManifestSource {
  return filesystemManifestSource((path) => join(root, path));
}

export function gitRefManifestSource(
  root: string,
  ref: string,
): ManifestSource {
  const object = (path: string) => `${ref}:${path}`;
  return {
    async readFile(path) {
      try {
        return (await execFile('git', ['show', object(path)], { cwd: root })).stdout;
      } catch (error) {
        if (isMissingGitPathError(error)) return null;
        // A ref source is advisory only while selecting the manifest rung.
        // The caller's established legacy read still owns errors for the
        // selected artifact; an unavailable probe therefore means no manifest.
        return null;
      }
    },
    async exists(path) {
      try {
        await execFile('git', ['rev-parse', '--verify', `${ref}^{tree}`], { cwd: root });
        await execFile('git', ['cat-file', '-e', object(path)], { cwd: root });
        return true;
      } catch (error) {
        if (isMissingGitPathError(error)) return false;
        return false;
      }
    },
  };
}

export function backlogTreeManifestSource(tree: BacklogTreeSource): ManifestSource {
  return {
    readFile: (path) => tree.readFile(path),
    async exists(path) {
      return (await tree.readFile(path)) !== null;
    },
  };
}

function filesystemManifestSource(resolve: (path: string) => string): ManifestSource {
  return {
    async readFile(path) {
      try {
        return await readFile(resolve(path), 'utf8');
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return null;
        throw error;
      }
    },
    async exists(path) {
      try {
        await access(resolve(path));
        return true;
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return false;
        throw error;
      }
    },
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code;
}

function isMissingGitPathError(error: unknown): boolean {
  return error instanceof Error && /path '.*' does not exist in /.test(error.message);
}

export async function resolveFeatureArtifact(
  source: ManifestSource,
  slug: string,
  kind: FeatureScopedKind,
  legacy: () => Promise<readonly string[]>,
): Promise<
  | { readonly origin: 'legacy'; readonly paths: readonly string[] }
  | { readonly origin: 'manifest'; readonly paths: readonly string[]; readonly missing: readonly string[] }
> {
  const manifestPath = featureManifestPath(slug);
  if (!await source.exists(manifestPath)) {
    return { origin: 'legacy', paths: await legacy() };
  }

  const rawManifest = await source.readFile(manifestPath);
  if (rawManifest === null) return { origin: 'legacy', paths: await legacy() };

  const parsed = parseFeatureManifest(rawManifest, manifestPath, slug);
  if (parsed.kind === 'malformed') {
    throw new MalformedFeatureManifestError(parsed.reason);
  }

  const paths = parsed.manifest.artifacts
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.path);
  const existing = await Promise.all(paths.map((path) => source.exists(path)));

  return {
    origin: 'manifest',
    paths,
    missing: paths.filter((_, index) => !existing[index]),
  };
}
