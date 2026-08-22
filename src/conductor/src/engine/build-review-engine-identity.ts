import { versionIdFromEngineDir } from './engine-version-id.js';

/** A validated engine-and-skill identity for cached build-review verdicts. */
export type BuildReviewEngineIdentity = {
  readonly engineStamp: string;
  readonly skillDigest: string;
} & { readonly __brand: 'BuildReviewEngineIdentity' };

/**
 * Return the content-hash portion of a published engine version, or `dev`
 * when the engine directory does not identify a published version.
 */
export function engineStampFromEngineDir(engineDir: string): string {
  const versionId = versionIdFromEngineDir(engineDir);
  if (versionId === undefined) {
    return 'dev';
  }

  return versionId.slice(versionId.lastIndexOf('-') + 1);
}

/** Parse an untrusted cached build-review engine identity. */
export function parseBuildReviewEngineIdentity(
  value: unknown,
): BuildReviewEngineIdentity | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const { engineStamp, skillDigest } = value as Record<string, unknown>;
  if (
    typeof engineStamp !== 'string' ||
    engineStamp.length === 0 ||
    typeof skillDigest !== 'string' ||
    skillDigest.length === 0
  ) {
    return undefined;
  }

  return { engineStamp, skillDigest } as BuildReviewEngineIdentity;
}
