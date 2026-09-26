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
type BuildReviewFindingCanonicalAnchor =
  | { readonly rubric: 'testQuality'; readonly locus: { readonly path: string; readonly contentHash: string; readonly occurrence?: number } }
  | { readonly rubric: 'security'; readonly locus: { readonly path: string; readonly contentHash: string; readonly occurrence?: number } };
export interface BuildReviewFindingCanonicalPayload { readonly rubric: BuildReviewRubricId; readonly contractVersion: BuildReviewRubricContractVersion; readonly concernKind: string; readonly anchor: BuildReviewFindingCanonicalAnchor; }
export interface BuildReviewFindingIdentity { readonly id: string; readonly canonicalPayload: BuildReviewFindingCanonicalPayload; readonly canonicalJson: string; }
function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function sort(value: unknown): unknown { if (Array.isArray(value)) return value.map(sort); const source = object(value); return source ? Object.fromEntries(Object.keys(source).sort().map((key) => [key, sort(source[key])])) : value; }
export function canonicalBuildReviewFindingJson(payload: BuildReviewFindingCanonicalPayload): string { return JSON.stringify(sort(payload)); }
function identity(canonicalPayload: BuildReviewFindingCanonicalPayload): BuildReviewFindingIdentity { const canonicalJson = canonicalBuildReviewFindingJson(canonicalPayload); return Object.freeze({ id: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`, canonicalPayload: Object.freeze(canonicalPayload), canonicalJson }); }
function canonicalAnchor(anchor: BuildReviewFindingAnchor): BuildReviewFindingCanonicalAnchor { return { rubric: anchor.rubric, locus: { path: anchor.locus.path, contentHash: anchor.locus.contentHash, ...(anchor.locus.occurrence === undefined ? {} : { occurrence: anchor.locus.occurrence }) } }; }
function parseCanonicalAnchor(value: unknown): BuildReviewFindingCanonicalAnchor | undefined { const source = object(value); const locus = source && object(source.locus); const path = locus && parseBuildReviewCanonicalPathReference(locus.path); const hash = locus && typeof locus.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(locus.contentHash); const occurrence = locus?.occurrence; const rubric = source?.rubric; return (rubric === 'testQuality' || rubric === 'security') && locus && exact(source, ['rubric', 'locus']) && exact(locus, occurrence === undefined ? ['path', 'contentHash'] : ['path', 'contentHash', 'occurrence']) && path && hash && (occurrence === undefined || (typeof occurrence === 'number' && Number.isInteger(occurrence) && occurrence > 0)) ? { rubric, locus: { path, contentHash: locus.contentHash as string, ...(occurrence === undefined ? {} : { occurrence: occurrence as number }) } } : undefined; }
export function parseBuildReviewFindingCanonicalPayload(value: unknown): BuildReviewFindingCanonicalPayload | undefined { const source = object(value); if (!source || !exact(source, ['rubric', 'contractVersion', 'concernKind', 'anchor']) || (source.rubric !== 'testQuality' && source.rubric !== 'security')) return undefined; const rubric = source.rubric; const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion); const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, rubric); const anchor = parseCanonicalAnchor(source.anchor); return contractVersion && concernKind && anchor?.rubric === rubric ? { rubric, contractVersion, concernKind: normalizeBuildReviewFindingVocabularyMember(concernKind), anchor } : undefined; }
export function rehydrateBuildReviewFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined { const payload = parseBuildReviewFindingCanonicalPayload(value); return payload ? identity(payload) : undefined; }
/** A reference context carries fresh target authority; absent context preserves legacy identity reads. */
export function canonicalizeBuildReviewFindingIdentity(value: unknown, references?: BuildReviewFindingReferenceContext): BuildReviewFindingIdentity | undefined { const source = object(value); if (!source || (source.rubric !== 'testQuality' && source.rubric !== 'security')) return undefined; const rubric = source.rubric; const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion); const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, rubric); const anchor = parseBuildReviewFindingAnchor(source.anchor, references); return contractVersion && concernKind && anchor?.rubric === rubric ? identity({ rubric, contractVersion, concernKind, anchor: canonicalAnchor(anchor) }) : undefined; }
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
const POLICY_BUNDLE_DIGEST = /^sha256-v1:[a-f0-9]{64}$/;
const CUSTOM_RUBRIC = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CUSTOM_SEMANTIC_NAME = /^[A-Za-z][A-Za-z0-9:_.-]{0,127}$/;
const CUSTOM_CONCERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const LOCATION = /^(.*):([1-9][0-9]*)(?:-([1-9][0-9]*))?$/;
function nonEmptyText(value: unknown, max = 4_096): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && (SHA256.test(value) || POLICY_BUNDLE_DIGEST.test(value));
}
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

function parseBuildReviewCustomCanonicalDeclaration(value: unknown): BuildReviewCustomDeclarationIdentity | undefined {
  const source = object(value);
  const resources = source?.resources;
  const declarationSource = source?.source;
  if (!source || !Array.isArray(resources) || typeof source.rubricId !== 'string' || typeof source.semanticSkill !== 'string' || typeof source.question !== 'string' || (declarationSource !== undefined && declarationSource !== 'project' && declarationSource !== 'global' && declarationSource !== 'plugin')) return undefined;
  const declaration: BuildReviewCustomDeclarationIdentity = {
    version: 'v1', rubricId: source.rubricId, semanticSkill: source.semanticSkill, question: source.question,
    ...(declarationSource === undefined ? {} : { source: declarationSource }),
    resources: Object.freeze(resources.filter((resource): resource is string => typeof resource === 'string')),
  };
  return declaration.resources.length === resources.length && validDeclaration(declaration) ? declaration : undefined;
}

function parseBuildReviewCustomFindingCanonicalPayload(value: unknown): BuildReviewCustomFindingCanonicalPayload | undefined {
  const source = object(value);
  if (!source || !exact(source, ['version', 'rubric', 'declaration', 'policy', 'candidate', 'reviewedInput', 'concernId', 'sourceRegions']) || source.version !== 'v1' || typeof source.rubric !== 'string' || !CUSTOM_RUBRIC.test(source.rubric) || typeof source.concernId !== 'string' || !CUSTOM_CONCERN.test(source.concernId) || !Array.isArray(source.sourceRegions)) return undefined;
  const declaration = parseBuildReviewCustomCanonicalDeclaration(source.declaration);
  const policy = object(source.policy);
  const candidate = object(source.candidate);
  const reviewedInput = object(source.reviewedInput);
  const sourceRegions = source.sourceRegions.map((entry): BuildReviewCustomCanonicalSourceRegion | undefined => {
    const region = object(entry);
    const path = region?.path;
    const startLine = region?.startLine;
    const endLine = region?.endLine;
    const contentHash = region?.contentHash;
    return region && exact(region, ['path', 'startLine', 'endLine', 'contentHash']) && typeof path === 'string' && parseBuildReviewCanonicalPathReference(path) !== undefined && typeof startLine === 'number' && Number.isInteger(startLine) && startLine > 0 && typeof endLine === 'number' && Number.isInteger(endLine) && endLine >= startLine && hash(contentHash)
      ? { path, startLine, endLine, contentHash }
      : undefined;
  });
  const policyDigest = policy?.version === 'v1' && hash(policy.bundleDigest) ? policy.bundleDigest : undefined;
  const provider = candidate && nonEmptyText(candidate.provider, 64) ? candidate.provider : undefined;
  const model = candidate && nonEmptyText(candidate.model, 256) ? candidate.model : undefined;
  const effort = candidate && nonEmptyText(candidate.effort, 64) ? candidate.effort : undefined;
  const inputDigest = reviewedInput?.version === 'v1' && hash(reviewedInput.contentDigest) ? reviewedInput.contentDigest : undefined;
  if (!declaration || !policyDigest || !provider || !model || !effort || !inputDigest || sourceRegions.some((region) => !region)) return undefined;
  const regions = Object.freeze(sourceRegions.filter((region): region is BuildReviewCustomCanonicalSourceRegion => region !== undefined));
  const customPolicy: BuildReviewCustomEffectivePolicyIdentity = { version: 'v1', bundleDigest: policyDigest };
  const customCandidate: BuildReviewCustomCandidateIdentity = { provider, model, effort };
  const customReviewedInput: BuildReviewCustomReviewedInputIdentity = { version: 'v1', contentDigest: inputDigest };
  return Object.freeze({
    version: 'v1', rubric: source.rubric, declaration,
    policy: customPolicy, candidate: customCandidate, reviewedInput: customReviewedInput,
    concernId: source.concernId, sourceRegions: regions,
  });
}

/**
 * Custom reviewer findings only acquire identity after engine stamping. The
 * descriptor therefore accepts that stamped finding (or its identity) and
 * rehydrates it only when its stored digest still matches its canonical form.
 */
export function canonicalizeBuildReviewCustomFindingIdentity(value: unknown): BuildReviewCustomFindingIdentity | undefined {
  const source = object(value);
  const stored = object(source?.identity) ?? source;
  const canonicalPayload = stored && parseBuildReviewCustomFindingCanonicalPayload(stored.canonicalPayload);
  if (!stored || !canonicalPayload || typeof stored.id !== 'string' || typeof stored.canonicalJson !== 'string') return undefined;
  const rehydrated = customIdentity(canonicalPayload);
  return stored.id === rehydrated.id && stored.canonicalJson === rehydrated.canonicalJson
    ? rehydrated
    : undefined;
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
/** Every location's entire inclusive range must lie inside one admitted frozen source region. */
function locationsAreAdmitted(locations: readonly string[], references: BuildReviewCustomFindingReferenceContext): boolean {
  return locations.every((location) => {
    const match = LOCATION.exec(location);
    if (!match) return false;
    const path = parseBuildReviewCanonicalPathReference(match[1]);
    const startLine = Number(match[2]);
    const endLine = match[3] === undefined ? startLine : Number(match[3]);
    return path !== undefined && Number.isSafeInteger(startLine) && Number.isSafeInteger(endLine) && endLine >= startLine && references.sourceRegions.some((region) =>
      region.path === path && startLine >= region.startLine && endLine <= region.endLine,
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
  // A PASS has no reviewer-owned locations to bind.  Findings still require
  // at least one frozen source region through `bindSourceRegions` below.
  if (!validStamp(stamp) || !Array.isArray(references.sourceRegions)) return undefined;
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
