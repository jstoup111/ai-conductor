import { createHash } from 'node:crypto';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  normalizeBuildReviewFindingVocabularyMember,
  parseBuildReviewCanonicalPathReference,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
  parseBuildReviewRubricContractVersion,
  type BuildReviewFindingAnchor,
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
export function canonicalizeBuildReviewFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined { const source = object(value); if (!source || source.rubric !== 'testQuality') return undefined; const contractVersion = parseBuildReviewRubricContractVersion(source.contractVersion); const concernKind = parseBuildReviewFindingConcernKind(source.concernKind, 'testQuality'); const anchor = parseBuildReviewFindingAnchor(source.anchor); return contractVersion && concernKind && anchor ? identity({ rubric: 'testQuality', contractVersion, concernKind, anchor: canonicalAnchor(anchor) }) : undefined; }
export function canonicalizeBuildReviewFindingSet(value: unknown): readonly BuildReviewFindingIdentity[] | undefined { if (!Array.isArray(value)) return undefined; const entries = value.map(canonicalizeBuildReviewFindingIdentity); if (entries.some((entry) => !entry)) return undefined; const identities = entries as BuildReviewFindingIdentity[]; return new Set(identities.map((entry) => entry.id)).size === identities.length ? Object.freeze(identities) : undefined; }
