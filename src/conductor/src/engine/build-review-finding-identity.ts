import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  normalizeBuildReviewFindingVocabularyMember,
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
  parseBuildReviewRubricContractVersion,
  parseBuildReviewCustomReviewerPayload,
  type BuildReviewFindingAnchor,
  type BuildReviewCandidateScopeSourceRegion,
  type BuildReviewCustomFinding,
  type BuildReviewCustomFindingReferenceContext,
  type BuildReviewFindingReferenceContext,
  type BuildReviewRubricContractVersion,
} from './build-review-domain.js';

export interface BuildReviewFindingIdentityInput { readonly rubric: BuildReviewRubricId; readonly contractVersion: BuildReviewRubricContractVersion; readonly concernKind: string; readonly anchor: BuildReviewFindingAnchor; }
type BuildReviewFindingCanonicalAnchor = { readonly rubric: 'testQuality'; readonly locus: { readonly path: string; readonly contentHash: string; readonly occurrence?: number } };
export interface BuildReviewFindingCanonicalPayload { readonly rubric: BuildReviewRubricId; readonly contractVersion: BuildReviewRubricContractVersion; readonly concernKind: string; readonly anchor: BuildReviewFindingCanonicalAnchor; }
export interface BuildReviewFindingIdentity { readonly id: string; readonly canonicalPayload: BuildReviewFindingCanonicalPayload; readonly canonicalJson: string; }
function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function sort(value: unknown): unknown { if (Array.isArray(value)) return value.map(sort); const source = object(value); return source ? Object.fromEntries(Object.keys(source).sort().map((key) => [key, sort(source[key])])) : value; }
export function canonicalBuildReviewFindingJson(payload: BuildReviewFindingCanonicalPayload): string { return JSON.stringify(sort(payload)); }
function identity(canonicalPayload: BuildReviewFindingCanonicalPayload): BuildReviewFindingIdentity { const canonicalJson = canonicalBuildReviewFindingJson(canonicalPayload); return Object.freeze({ id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`, canonicalPayload: Object.freeze(canonicalPayload), canonicalJson }); }
function canonicalAnchor(anchor: BuildReviewFindingAnchor): BuildReviewFindingCanonicalAnchor { return { rubric: 'testQuality', locus: { path: anchor.locus.path, contentHash: anchor.locus.contentHash, ...(anchor.locus.occurrence === undefined ? {} : { occurrence: anchor.locus.occurrence }) } }; }
function parseCanonicalAnchor(value: unknown): BuildReviewFindingCanonicalAnchor | undefined { const source = object(value); const locus = source && object(source.locus); const path = locus && parseBuildReviewCanonicalPathReference(locus.path); const hash = locus && typeof locus.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(locus.contentHash); const occurrence = locus?.occurrence; return source?.rubric === 'testQuality' && locus && exact(source, ['rubric', 'locus']) && exact(locus, occurrence === undefined ? ['path', 'contentHash'] : ['path', 'contentHash', 'occurrence']) && path && hash && (occurrence === undefined || (typeof occurrence === 'number' && Number.isInteger(occurrence) && occurrence > 0)) ? { rubric: 'testQuality', locus: { path, contentHash: locus.contentHash as string, ...(occurrence === undefined ? {} : { occurrence: occurrence as number }) } } : undefined; }
export function parseBuildReviewFindingCanonicalPayload(value: unknown): BuildReviewFindingCanonicalPayload | undefined { const source = object(value); if (!source || !exact(source, ['rubric', 'contractVersion', 'concernKind', 'anchor']) || source.rubric !== 'testQuality') return undefined; const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion); const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, 'testQuality'); const anchor = parseCanonicalAnchor(source.anchor); return contractVersion && concernKind && anchor ? { rubric: 'testQuality', contractVersion, concernKind: normalizeBuildReviewFindingVocabularyMember(concernKind), anchor } : undefined; }
export function rehydrateBuildReviewFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined { const payload = parseBuildReviewFindingCanonicalPayload(value); return payload ? identity(payload) : undefined; }
/** A reference context carries fresh target authority; absent context preserves legacy identity reads. */
export function canonicalizeBuildReviewFindingIdentity(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewFindingIdentity | undefined { const source = object(value); if (!source || source.rubric !== 'testQuality') return undefined; const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion); const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, 'testQuality'); const anchor = parseBuildReviewFindingAnchor(source.anchor, references); return contractVersion && concernKind && anchor ? identity({ rubric: 'testQuality', contractVersion, concernKind, anchor: canonicalAnchor(anchor) }) : undefined; }
export function canonicalizeBuildReviewFindingSet(value: unknown, references?: BuildReviewFindingReferenceContext): readonly BuildReviewFindingIdentity[] | undefined { if (!Array.isArray(value)) return undefined; const entries = value.map((entry) => canonicalizeBuildReviewFindingIdentity(entry, references)); if (entries.some((entry) => !entry)) return undefined; const identities = entries as BuildReviewFindingIdentity[]; return new Set(identities.map((entry) => entry.id)).size === identities.length ? Object.freeze(identities) : undefined; }

// Custom policies are deliberately a separate, self-describing identity
// grammar.  Extending testQuality's closed vocabulary would let a custom
// declaration alter built-in disposition matching and historical reads.
export interface BuildReviewCustomDeclarationIdentity {
  readonly version: 'v1';
  readonly rubricId: string;
  readonly semanticSkill: string;
  readonly question: string;
  readonly source?: 'project' | 'global' | 'plugin';
  readonly resources: readonly string[];
}
export interface BuildReviewCustomEffectivePolicyIdentity {
  readonly version: 'v1';
  readonly bundleDigest: string;
}
export interface BuildReviewCustomCandidateIdentity {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
}
export interface BuildReviewCustomReviewedInputIdentity {
  readonly version: 'v1';
  readonly contentDigest: string;
}
export interface BuildReviewCustomResultStamp {
  readonly rubric: string;
  readonly lapId: string;
  readonly declaration: BuildReviewCustomDeclarationIdentity;
  readonly policy: BuildReviewCustomEffectivePolicyIdentity;
  readonly candidate: BuildReviewCustomCandidateIdentity;
  readonly reviewedInput: BuildReviewCustomReviewedInputIdentity;
}
export interface BuildReviewCustomFindingCanonicalPayload {
  readonly version: 'v1';
  readonly rubric: string;
  readonly declaration: BuildReviewCustomDeclarationIdentity;
  readonly policy: BuildReviewCustomEffectivePolicyIdentity;
  readonly candidate: BuildReviewCustomCandidateIdentity;
  readonly reviewedInput: BuildReviewCustomReviewedInputIdentity;
  readonly concernId: string;
  readonly sourceRegions: readonly BuildReviewCustomCanonicalSourceRegion[];
}
export interface BuildReviewCustomCanonicalSourceRegion {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly contentHash: string;
}
export interface BuildReviewCustomFindingIdentity {
  readonly id: string;
  readonly canonicalPayload: BuildReviewCustomFindingCanonicalPayload;
  readonly canonicalJson: string;
}
export interface BuildReviewStampedCustomFinding extends BuildReviewCustomFinding {
  readonly sourceRegions: readonly BuildReviewCandidateScopeSourceRegion[];
  readonly identity: BuildReviewCustomFindingIdentity;
}
export interface BuildReviewCustomEnvelopeCanonicalPayload {
  readonly version: 'v1';
  readonly rubric: string;
  readonly declaration: BuildReviewCustomDeclarationIdentity;
  readonly policy: BuildReviewCustomEffectivePolicyIdentity;
  readonly candidate: BuildReviewCustomCandidateIdentity;
  readonly reviewedInput: BuildReviewCustomReviewedInputIdentity;
  readonly findingIds: readonly string[];
}
export interface BuildReviewCustomEnvelopeIdentity {
  readonly id: string;
  readonly canonicalPayload: BuildReviewCustomEnvelopeCanonicalPayload;
  readonly canonicalJson: string;
}
export interface BuildReviewCustomJudgedResult {
  readonly kind: 'judged';
  readonly contractVersion: 'custom-v1';
  readonly rubric: string;
  readonly lapId: string;
  readonly declaration: BuildReviewCustomDeclarationIdentity;
  readonly policy: BuildReviewCustomEffectivePolicyIdentity;
  readonly candidate: BuildReviewCustomCandidateIdentity;
  readonly reviewedInput: BuildReviewCustomReviewedInputIdentity;
  readonly findings: readonly BuildReviewStampedCustomFinding[];
  readonly verdict: 'PASS' | 'FAIL';
  readonly identity: BuildReviewCustomEnvelopeIdentity;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CUSTOM_RUBRIC = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CUSTOM_SEMANTIC_NAME = /^[A-Za-z][A-Za-z0-9:_.-]{0,127}$/;
const CUSTOM_CONCERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const LOCATION = /^(.*):([1-9][0-9]*)$/;
function nonEmptyText(value: unknown, max = 4_096): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function hash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function sameSourceRegion(left: BuildReviewCandidateScopeSourceRegion, right: BuildReviewCandidateScopeSourceRegion): boolean {
  return left.path === right.path && left.startLine === right.startLine && left.endLine === right.endLine && left.contentHash === right.contentHash;
}
function canonicalSourceRegion(region: BuildReviewCandidateScopeSourceRegion): BuildReviewCustomCanonicalSourceRegion {
  return { path: region.path, startLine: region.startLine, endLine: region.endLine, contentHash: region.contentHash };
}
function sortedSourceRegions(regions: readonly BuildReviewCandidateScopeSourceRegion[]): readonly BuildReviewCustomCanonicalSourceRegion[] {
  return Object.freeze(regions.map(canonicalSourceRegion).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))));
}
function canonicalJson(value: unknown): string { return JSON.stringify(sort(value)); }
function customIdentity<T extends object>(canonicalPayload: T): { readonly id: string; readonly canonicalPayload: T; readonly canonicalJson: string } {
  const canonicalJsonValue = canonicalJson(canonicalPayload);
  return Object.freeze({
    id: `sha256:${createHash('sha256').update(canonicalJsonValue).digest('hex')}`,
    canonicalPayload: Object.freeze(canonicalPayload),
    canonicalJson: canonicalJsonValue,
  });
}
function validDeclaration(value: BuildReviewCustomDeclarationIdentity): boolean {
  if (value.version !== 'v1' || !CUSTOM_RUBRIC.test(value.rubricId) || !CUSTOM_SEMANTIC_NAME.test(value.semanticSkill) || !nonEmptyText(value.question) || (value.source !== undefined && !['project', 'global', 'plugin'].includes(value.source))) return false;
  return Array.isArray(value.resources) && value.resources.every((resource) => typeof resource === 'string' && parseBuildReviewCanonicalPathReference(resource) !== undefined) && new Set(value.resources).size === value.resources.length;
}
function validStamp(stamp: BuildReviewCustomResultStamp): boolean {
  return CUSTOM_RUBRIC.test(stamp.rubric) && nonEmptyText(stamp.lapId, 128) &&
    validDeclaration(stamp.declaration) && stamp.declaration.rubricId === stamp.rubric &&
    stamp.policy.version === 'v1' && hash(stamp.policy.bundleDigest) &&
    nonEmptyText(stamp.candidate.provider, 64) && nonEmptyText(stamp.candidate.model, 256) && nonEmptyText(stamp.candidate.effort, 64) &&
    stamp.reviewedInput.version === 'v1' && hash(stamp.reviewedInput.contentDigest);
}
/** Every location must name a one-based line inside one admitted frozen source region. */
function locationsAreAdmitted(locations: readonly string[], references: BuildReviewCustomFindingReferenceContext): boolean {
  return locations.every((location) => {
    const match = LOCATION.exec(location);
    if (!match) return false;
    const path = parseBuildReviewCanonicalPathReference(match[1]);
    const line = Number(match[2]);
    return path !== undefined && Number.isSafeInteger(line) && references.sourceRegions.some((region) =>
      region.path === path && line >= region.startLine && line <= region.endLine,
    );
  });
}
function bindSourceRegions(
  finding: BuildReviewCustomFinding,
  references: BuildReviewCustomFindingReferenceContext,
): readonly BuildReviewCandidateScopeSourceRegion[] | undefined {
  const bound = finding.sourceRegions.map((provided) => references.sourceRegions.find((admitted) => sameSourceRegion(admitted, provided)));
  if (bound.some((region) => !region)) return undefined;
  const regions = bound as BuildReviewCandidateScopeSourceRegion[];
  const unique = new Set(regions.map((region) => canonicalJson(canonicalSourceRegion(region))));
  return unique.size === regions.length ? Object.freeze(regions) : undefined;
}

/**
 * Converts the strictly parsed reviewer payload into a self-describing,
 * engine-owned custom judgement.  The reviewer cannot mint envelope fields,
 * choose an identity, or point at mutable/out-of-input source material.
 */
export function stampBuildReviewCustomJudgedResult(
  value: unknown,
  stamp: BuildReviewCustomResultStamp,
  references: BuildReviewCustomFindingReferenceContext,
): BuildReviewCustomJudgedResult | undefined {
  if (!validStamp(stamp) || !Array.isArray(references.sourceRegions) || references.sourceRegions.length === 0) return undefined;
  const payload = parseBuildReviewCustomReviewerPayload(value);
  if (!payload || payload.kind !== 'custom-findings') return undefined;
  const findings = payload.findings.map((finding): BuildReviewStampedCustomFinding | undefined => {
    if (!CUSTOM_CONCERN.test(finding.concernId) || !locationsAreAdmitted(finding.evidenceLocations, references)) return undefined;
    const sourceRegions = bindSourceRegions(finding, references);
    if (!sourceRegions) return undefined;
    const identity = customIdentity<BuildReviewCustomFindingCanonicalPayload>({
      version: 'v1', rubric: stamp.rubric, declaration: stamp.declaration, policy: stamp.policy,
      candidate: stamp.candidate, reviewedInput: stamp.reviewedInput, concernId: finding.concernId,
      sourceRegions: sortedSourceRegions(sourceRegions),
    });
    return Object.freeze({ ...finding, sourceRegions, identity });
  });
  if (findings.some((finding) => !finding)) return undefined;
  const stampedFindings = findings as BuildReviewStampedCustomFinding[];
  if (new Set(stampedFindings.map((finding) => finding.identity.id)).size !== stampedFindings.length) return undefined;
  const frozenFindings = Object.freeze(stampedFindings);
  const identity = customIdentity<BuildReviewCustomEnvelopeCanonicalPayload>({
    version: 'v1', rubric: stamp.rubric, declaration: stamp.declaration, policy: stamp.policy,
    candidate: stamp.candidate, reviewedInput: stamp.reviewedInput,
    findingIds: Object.freeze(frozenFindings.map((finding) => finding.identity.id).sort()),
  });
  return Object.freeze({
    kind: 'judged', contractVersion: 'custom-v1', rubric: stamp.rubric, lapId: stamp.lapId,
    declaration: stamp.declaration, policy: stamp.policy, candidate: stamp.candidate,
    reviewedInput: stamp.reviewedInput, findings: frozenFindings,
    verdict: frozenFindings.length === 0 ? 'PASS' : 'FAIL', identity,
  });
}
