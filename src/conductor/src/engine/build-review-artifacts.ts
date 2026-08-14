import { join } from 'node:path';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  parseBuildReviewLapId,
  parseBuildReviewRubricResult,
  type BuildReviewLapId,
  type BuildReviewRubricResult,
} from './build-review-domain.js';

const ARTIFACT_VERSION = 1 as const;
const ARTIFACT_DIRECTORY = '.pipeline/build-review';

export type BuildReviewBranchProvenance =
  | { readonly kind: 'fresh' }
  | {
      readonly kind: 'cache-hit';
      readonly cachedLapId: BuildReviewLapId;
      readonly cachedSnapshotDigest: string;
      readonly projectionDigest: string;
      readonly policyFingerprint: string;
    };

/** Engine-stamped, branch-local evidence for exactly one current rubric lap. */
export interface BuildReviewBranchArtifact {
  readonly version: typeof ARTIFACT_VERSION;
  readonly rubric: BuildReviewRubricId;
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly result: BuildReviewRubricResult;
  readonly provenance: BuildReviewBranchProvenance;
}

/** Injected so branch-artifact tests never write to the host filesystem. */
export interface BuildReviewArtifactFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

function isRubric(value: unknown): value is BuildReviewRubricId {
  return value === 'tautology' || value === 'scope' || value === 'rootCause' || value === 'completeness' || value === 'wiring';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function strictResult(value: unknown): BuildReviewRubricResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const expected = candidate.kind === 'judged'
    ? ['kind', 'rubric', 'lapId', 'snapshotDigest', 'contractVersion', 'findings', 'verdict']
    : candidate.kind === 'skipped'
      ? ['kind', 'rubric', 'reason']
      : candidate.kind === 'infrastructure-failure'
        ? ['kind', 'rubric', 'reason', 'detail']
        : [];
  return exactKeys(candidate, expected) ? parseBuildReviewRubricResult(candidate) : undefined;
}

function parseProvenance(value: unknown): BuildReviewBranchProvenance | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'fresh' && exactKeys(candidate, ['kind'])) return { kind: 'fresh' };
  if (candidate.kind !== 'cache-hit' || !exactKeys(candidate, [
    'kind', 'cachedLapId', 'cachedSnapshotDigest', 'projectionDigest', 'policyFingerprint',
  ])) return undefined;
  const cachedLapId = parseBuildReviewLapId(candidate.cachedLapId);
  return cachedLapId && isNonEmptyString(candidate.cachedSnapshotDigest) &&
    isNonEmptyString(candidate.projectionDigest) && isNonEmptyString(candidate.policyFingerprint)
    ? {
        kind: 'cache-hit', cachedLapId, cachedSnapshotDigest: candidate.cachedSnapshotDigest,
        projectionDigest: candidate.projectionDigest, policyFingerprint: candidate.policyFingerprint,
      }
    : undefined;
}

/** The path has one owner: a rubric may write only its own current-lap file. */
export function buildReviewBranchArtifactPath(
  projectRoot: string,
  lapId: BuildReviewLapId,
  rubric: BuildReviewRubricId,
): string {
  return join(projectRoot, ARTIFACT_DIRECTORY, lapId, `${rubric}.json`);
}

function artifactDirectory(projectRoot: string, lapId: BuildReviewLapId): string {
  return join(projectRoot, ARTIFACT_DIRECTORY, lapId);
}

/** Strictly parses an envelope and verifies provider output against engine identity. */
export function parseBuildReviewBranchArtifact(value: unknown): BuildReviewBranchArtifact | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, ['version', 'rubric', 'lapId', 'snapshotDigest', 'result', 'provenance']) ||
    candidate.version !== ARTIFACT_VERSION || !isRubric(candidate.rubric) || !isNonEmptyString(candidate.snapshotDigest)) return undefined;
  const lapId = parseBuildReviewLapId(candidate.lapId);
  const result = strictResult(candidate.result);
  const provenance = parseProvenance(candidate.provenance);
  if (!lapId || !result || !provenance || result.rubric !== candidate.rubric) return undefined;
  if (result.kind === 'judged' && (result.lapId !== lapId || result.snapshotDigest !== candidate.snapshotDigest)) return undefined;
  return { version: ARTIFACT_VERSION, rubric: candidate.rubric, lapId, snapshotDigest: candidate.snapshotDigest, result, provenance };
}

/** Atomically writes a validated artifact to the single branch-local location. */
export async function writeBuildReviewBranchArtifact(
  projectRoot: string,
  artifact: Omit<BuildReviewBranchArtifact, 'version'>,
  fs: BuildReviewArtifactFilesystem,
): Promise<BuildReviewBranchArtifact> {
  const validated = parseBuildReviewBranchArtifact({ version: ARTIFACT_VERSION, ...artifact });
  if (!validated) throw new Error('build-review branch artifact must carry matching engine identity');
  const path = buildReviewBranchArtifactPath(projectRoot, validated.lapId, validated.rubric);
  await fs.mkdir(artifactDirectory(projectRoot, validated.lapId));
  await fs.writeFile(`${path}.tmp`, JSON.stringify(validated));
  await fs.rename(`${path}.tmp`, path);
  return validated;
}

/** Reads only the requested branch path and rejects stale/mismatched evidence. */
export async function readBuildReviewBranchArtifact(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  lapId: BuildReviewLapId,
  snapshotDigest: string,
  fs: BuildReviewArtifactFilesystem,
): Promise<BuildReviewBranchArtifact | undefined> {
  try {
    const artifact = parseBuildReviewBranchArtifact(JSON.parse(await fs.readFile(buildReviewBranchArtifactPath(projectRoot, lapId, rubric))));
    return artifact && artifact.rubric === rubric && artifact.lapId === lapId && artifact.snapshotDigest === snapshotDigest
      ? artifact
      : undefined;
  } catch {
    return undefined;
  }
}
