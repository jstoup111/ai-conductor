import { join } from 'node:path';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewLapId,
  parseBuildReviewRubricResult,
  type BuildReviewInfrastructureFailureReason,
  type BuildReviewLapId,
  type BuildReviewRubricResult,
} from './build-review-domain.js';

const ARTIFACT_VERSION = 2 as const;
const ARTIFACT_DIRECTORY = '.pipeline/build-review';

type BuildReviewArtifactVersion = 1 | typeof ARTIFACT_VERSION;
export type BuildReviewArtifactRubric = BuildReviewRubricId | string;

/**
 * Durable, self-describing provenance for a custom policy judgement.  It is
 * intentionally separate from the current catalog: historical evidence must
 * not need today's configuration in order to remain attributable.
 */
export interface BuildReviewCustomDeclaration {
  readonly version: 'v1';
  readonly rubricId: string;
  readonly semanticSkill: string;
  readonly question: string;
  readonly source?: 'project' | 'global' | 'plugin';
  readonly resources: readonly string[];
}

export interface BuildReviewCustomEvidenceDescriptor {
  readonly version: 'v1';
  readonly semanticSkill: string;
  readonly declaration: BuildReviewCustomDeclaration;
  readonly installation: { readonly source: 'project' | 'global' | 'plugin'; readonly plugin?: { readonly id: string; readonly version?: string } };
  readonly effectivePolicy: { readonly version: 'v1'; readonly bundleDigest: string };
  readonly reviewedInput: { readonly version: 'v1'; readonly contentDigest: string };
  readonly producer: { readonly provider: string; readonly model: string; readonly effort: string };
}

export type BuildReviewCustomInfrastructureFailureReason =
  | BuildReviewInfrastructureFailureReason
  | 'policy-load-failed';

const CUSTOM_INFRASTRUCTURE_FAILURE_REASONS = new Set<BuildReviewCustomInfrastructureFailureReason>([
  'policy-load-failed', 'provider-error', 'retry-exhausted', 'missing-artifact', 'malformed-artifact',
  'stale-artifact', 'identity-mismatch', 'preflight-failed', 'artifact-read-failed',
  'artifact-write-failed', 'scope-incomplete',
]);

export function isBuildReviewCustomInfrastructureFailureReason(
  value: unknown,
): value is BuildReviewCustomInfrastructureFailureReason {
  return typeof value === 'string' && CUSTOM_INFRASTRUCTURE_FAILURE_REASONS.has(value as BuildReviewCustomInfrastructureFailureReason);
}

export type BuildReviewCustomArtifactResult =
  | { readonly kind: 'judged'; readonly contractVersion: 'custom-v1'; readonly rubric: string; readonly lapId: string; readonly declaration: BuildReviewCustomEvidenceDescriptor['declaration']; readonly policy: BuildReviewCustomEvidenceDescriptor['effectivePolicy']; readonly candidate: BuildReviewCustomEvidenceDescriptor['producer']; readonly reviewedInput: BuildReviewCustomEvidenceDescriptor['reviewedInput']; readonly findings: readonly unknown[]; readonly verdict: 'PASS' | 'FAIL'; readonly identity: { readonly id: string; readonly canonicalPayload: unknown; readonly canonicalJson: string } }
  | { readonly kind: 'infrastructure-failure'; readonly rubric: string; readonly reason: BuildReviewCustomInfrastructureFailureReason; readonly detail: string };

export interface BuildReviewCustomArtifactMember {
  /** Present for a judged result; never trusted for an infrastructure failure. */
  readonly descriptor?: BuildReviewCustomEvidenceDescriptor;
  /** A declared policy may fail before effective content or producer provenance exists. */
  readonly declaration?: BuildReviewCustomDeclaration;
  readonly result: BuildReviewCustomArtifactResult;
}

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
  readonly version: BuildReviewArtifactVersion;
  readonly rubric: BuildReviewArtifactRubric;
  readonly lapId: BuildReviewLapId;
  readonly snapshotDigest: string;
  readonly result: BuildReviewRubricResult | BuildReviewCustomArtifactResult;
  readonly provenance: BuildReviewBranchProvenance;
  /** Present only for a current lap that reused an earlier judgement. */
  readonly reuse?: { readonly sourceLapId: BuildReviewLapId; readonly sourceSnapshotDigest: string };
  /** Required for custom judged evidence; forbidden for unjudged failures. */
  readonly descriptor?: BuildReviewCustomEvidenceDescriptor;
  /** Validated declared obligation for a custom failure with unavailable content. */
  readonly declaration?: BuildReviewCustomDeclaration;
}

/** Injected so branch-artifact tests never write to the host filesystem. */
export interface BuildReviewArtifactFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

function isRubric(value: unknown): value is BuildReviewRubricId {
  return value === 'testQuality';
}

function isCustomRubric(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && value !== 'testQuality';
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
    ? ['kind', 'rubric', 'lapId', 'snapshotDigest', 'contractVersion', 'findings', ...(candidate.scopeResolutions === undefined ? [] : ['scopeResolutions']), ...(candidate.relocationAudit === undefined ? [] : ['relocationAudit']), ...(candidate.counterfactualSensitivity === undefined ? [] : ['counterfactualSensitivity']), 'verdict']
    : candidate.kind === 'skipped'
      ? ['kind', 'rubric', 'reason']
      : candidate.kind === 'infrastructure-failure'
        ? ['kind', 'rubric', 'reason', 'detail']
        : [];
  return exactKeys(candidate, expected) ? parseBuildReviewRubricResult(candidate) : undefined;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}

export function parseBuildReviewCustomDeclaration(value: unknown): BuildReviewCustomDeclaration | undefined {
  const declaration = value as Record<string, unknown> | undefined;
  const sourceKeys = declaration?.source === undefined ? ['version', 'rubricId', 'semanticSkill', 'question', 'resources'] : ['version', 'rubricId', 'semanticSkill', 'question', 'source', 'resources'];
  if (!declaration || !exactKeys(declaration, sourceKeys) || declaration.version !== 'v1' || !isCustomRubric(declaration.rubricId) ||
    !isNonEmptyString(declaration.semanticSkill) || !isNonEmptyString(declaration.question) ||
    (declaration.source !== undefined && !['project', 'global', 'plugin'].includes(declaration.source as string)) ||
    !stringArray(declaration.resources) ||
    !declaration.resources.every((resource) => parseBuildReviewCanonicalPathReference(resource) !== undefined)) return undefined;
  return declaration as unknown as BuildReviewCustomDeclaration;
}

function parseCustomDescriptor(value: unknown): BuildReviewCustomEvidenceDescriptor | undefined {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!source || !exactKeys(source, ['version', 'semanticSkill', 'declaration', 'installation', 'effectivePolicy', 'reviewedInput', 'producer']) || source.version !== 'v1' || !isNonEmptyString(source.semanticSkill)) return undefined;
  const installation = source.installation as Record<string, unknown> | undefined;
  const policy = source.effectivePolicy as Record<string, unknown> | undefined;
  const input = source.reviewedInput as Record<string, unknown> | undefined;
  const producer = source.producer as Record<string, unknown> | undefined;
  const declaration = parseBuildReviewCustomDeclaration(source.declaration);
  if (!declaration || !installation || !policy || !input || !producer || declaration.semanticSkill !== source.semanticSkill || !exactKeys(policy, ['version', 'bundleDigest']) || policy.version !== 'v1' || !isNonEmptyString(policy.bundleDigest) || !exactKeys(input, ['version', 'contentDigest']) || input.version !== 'v1' || !isNonEmptyString(input.contentDigest) || !exactKeys(producer, ['provider', 'model', 'effort']) || !isNonEmptyString(producer.provider) || !isNonEmptyString(producer.model) || !isNonEmptyString(producer.effort)) return undefined;
  const plugin = installation.plugin as Record<string, unknown> | undefined;
  const installationKeys = plugin === undefined ? ['source'] : ['source', 'plugin'];
  const pluginKeys = plugin?.version === undefined ? ['id'] : ['id', 'version'];
  if (!exactKeys(installation, installationKeys) || !['project', 'global', 'plugin'].includes(installation.source as string) || (plugin !== undefined && (!exactKeys(plugin, pluginKeys) || !isNonEmptyString(plugin.id) || (plugin.version !== undefined && !isNonEmptyString(plugin.version)))) || (installation.source === 'plugin' && plugin === undefined)) return undefined;
  return source as unknown as BuildReviewCustomEvidenceDescriptor;
}

/** Strictly distinguishes a self-describing custom judgement from an uncovered failure. */
export function parseBuildReviewCustomArtifactMember(value: unknown): BuildReviewCustomArtifactMember | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result = source.result as Record<string, unknown> | undefined;
  if (!result) return undefined;
  if (result.kind === 'infrastructure-failure') {
    const declaration = source.declaration === undefined ? undefined : parseBuildReviewCustomDeclaration(source.declaration);
    if (!exactKeys(source, declaration === undefined ? ['result'] : ['declaration', 'result']) || !exactKeys(result, ['kind', 'rubric', 'reason', 'detail']) || !isCustomRubric(result.rubric) || !isBuildReviewCustomInfrastructureFailureReason(result.reason) || !isNonEmptyString(result.detail) || (declaration !== undefined && declaration.rubricId !== result.rubric)) return undefined;
    return {
      ...(declaration === undefined ? {} : { declaration }),
      result: result as Extract<BuildReviewCustomArtifactResult, { readonly kind: 'infrastructure-failure' }>,
    };
  }
  if (result.kind !== 'judged' || !exactKeys(source, ['descriptor', 'result'])) return undefined;
  const descriptor = parseCustomDescriptor(source.descriptor);
  const expected = ['kind', 'contractVersion', 'rubric', 'lapId', 'declaration', 'policy', 'candidate', 'reviewedInput', 'findings', 'verdict', 'identity'];
  const identity = result.identity as Record<string, unknown> | undefined;
  if (!descriptor || !exactKeys(result, expected) || result.contractVersion !== 'custom-v1' || result.rubric !== descriptor.declaration.rubricId || !isCustomRubric(result.rubric) || !isNonEmptyString(result.lapId) || JSON.stringify(result.declaration) !== JSON.stringify(descriptor.declaration) || JSON.stringify(result.policy) !== JSON.stringify(descriptor.effectivePolicy) || JSON.stringify(result.candidate) !== JSON.stringify(descriptor.producer) || JSON.stringify(result.reviewedInput) !== JSON.stringify(descriptor.reviewedInput) || !Array.isArray(result.findings) || (result.verdict !== 'PASS' && result.verdict !== 'FAIL') || !identity || !exactKeys(identity, ['id', 'canonicalPayload', 'canonicalJson']) || !isNonEmptyString(identity.id) || !isNonEmptyString(identity.canonicalJson)) return undefined;
  return { descriptor, result: result as BuildReviewCustomArtifactResult };
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
  rubric: BuildReviewArtifactRubric,
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
  const isV1 = candidate.version === 1;
  const isV2 = candidate.version === ARTIFACT_VERSION;
  const expected = isV1
    ? ['version', 'rubric', 'lapId', 'snapshotDigest', 'result', 'provenance']
    : ['version', 'rubric', 'lapId', 'snapshotDigest', 'result', 'provenance', ...(candidate.descriptor === undefined ? [] : ['descriptor']), ...(candidate.declaration === undefined ? [] : ['declaration']), ...(candidate.reuse === undefined ? [] : ['reuse'])];
  if (!exactKeys(candidate, expected) || (!isV1 && !isV2) || !isNonEmptyString(candidate.snapshotDigest)) return undefined;
  const lapId = parseBuildReviewLapId(candidate.lapId);
  const provenance = parseProvenance(candidate.provenance);
  if (!lapId || !provenance) return undefined;
  const builtin = isRubric(candidate.rubric) ? strictResult(candidate.result) : undefined;
  const custom = isV2 && isCustomRubric(candidate.rubric) ? parseBuildReviewCustomArtifactMember({
    ...(candidate.descriptor === undefined ? {} : { descriptor: candidate.descriptor }),
    ...(candidate.declaration === undefined ? {} : { declaration: candidate.declaration }),
    result: candidate.result,
  }) : undefined;
  const result = builtin ?? custom?.result;
  if (!result || result.rubric !== candidate.rubric) return undefined;
  if (builtin && builtin.kind === 'judged' && (builtin.lapId !== lapId || builtin.snapshotDigest !== candidate.snapshotDigest)) return undefined;
  if (custom && custom.result.kind === 'judged' && custom.result.lapId !== lapId) return undefined;
  const reuse = candidate.reuse as Record<string, unknown> | undefined;
  if (reuse !== undefined && (!custom || custom.result.kind !== 'judged' || !exactKeys(reuse, ['sourceLapId', 'sourceSnapshotDigest']) || !parseBuildReviewLapId(reuse.sourceLapId) || !isNonEmptyString(reuse.sourceSnapshotDigest))) return undefined;
  return {
    version: candidate.version as BuildReviewArtifactVersion, rubric: candidate.rubric as BuildReviewArtifactRubric, lapId, snapshotDigest: candidate.snapshotDigest,
    result, provenance,
    ...(custom?.descriptor === undefined ? {} : { descriptor: custom.descriptor }),
    ...(custom?.declaration === undefined ? {} : { declaration: custom.declaration }),
    ...(reuse === undefined ? {} : { reuse: { sourceLapId: reuse.sourceLapId as BuildReviewLapId, sourceSnapshotDigest: reuse.sourceSnapshotDigest as string } }),
  };
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
export function readBuildReviewBranchArtifact(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  lapId: BuildReviewLapId,
  snapshotDigest: string,
  fs: BuildReviewArtifactFilesystem,
): Promise<(BuildReviewBranchArtifact & { readonly rubric: BuildReviewRubricId; readonly result: BuildReviewRubricResult }) | undefined>;
export function readBuildReviewBranchArtifact(
  projectRoot: string,
  rubric: BuildReviewArtifactRubric,
  lapId: BuildReviewLapId,
  snapshotDigest: string,
  fs: BuildReviewArtifactFilesystem,
): Promise<BuildReviewBranchArtifact | undefined>;
export async function readBuildReviewBranchArtifact(
  projectRoot: string,
  rubric: BuildReviewArtifactRubric,
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
