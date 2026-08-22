import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { versionIdFromEngineDir } from './engine-version-id.js';

/** A validated engine-and-skill identity for cached build-review verdicts. */
export type BuildReviewEngineIdentity = {
  readonly engineStamp: string;
  readonly skillDigest: string;
} & { readonly __brand: 'BuildReviewEngineIdentity' };

/** An injected byte reader for rubric skill content. */
export type RubricSkillFileReader = (path: string) => Promise<Uint8Array>;

/** Raised when the rubric skill bytes required for cache identity are unavailable. */
export class SkillDigestUnavailable extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Unable to read rubric skill for cache identity: ${path}`);
    this.name = 'SkillDigestUnavailable';
    this.path = path;
  }
}

/**
 * Digest the exact, un-normalized bytes of a rubric skill's source text.
 *
 * The filesystem seam intentionally returns bytes rather than text: changing even
 * whitespace in a rubric changes cache identity.
 */
export async function digestRubricSkill({
  harnessRoot,
  skillName,
  readFile,
}: {
  harnessRoot: string;
  skillName: string;
  readFile: RubricSkillFileReader;
}): Promise<string> {
  const path = join(harnessRoot, 'skills', skillName, 'SKILL.md');
  let bytes: Uint8Array;

  try {
    bytes = await readFile(path);
  } catch {
    throw new SkillDigestUnavailable(path);
  }

  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

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
