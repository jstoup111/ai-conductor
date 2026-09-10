import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from './conduct-state-lease.js';
import type {
  RemediationCaseConfidence,
  RemediationCaseDisposition,
  RemediationCasePriority,
  RemediationCaseSourceOutcome,
} from './remediation-case-artifact.js';

/** Envelope format. Feature identity deliberately retains its own version. */
const STORE_VERSION = 'v2' as const;
const LEGACY_STORE_VERSION = 'v1' as const;
const FEATURE_VERSION = 'v1' as const;
const STORE_PATH = '.pipeline/remediation-cases.json';
const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;
const MAX_CASES = 128;
const MAX_SOURCES_PER_CASE = 512;

export interface RemediationCaseFeatureIdentity {
  readonly version: typeof FEATURE_VERSION;
  readonly repository: string;
  readonly feature: string;
}

export interface RemediationCaseSourceLink {
  readonly sourceId: string;
  readonly outcome: RemediationCaseSourceOutcome;
  readonly recordedAt: string;
}

export type RemediationCaseEffect =
  | { readonly kind: 'none' }
  | { readonly id: string; readonly kind: 'action'; readonly status: 'reserved' }
  | { readonly id: string; readonly kind: 'action'; readonly status: 'applied'; readonly workOrderId: string }
  | { readonly id: string; readonly kind: 'action'; readonly status: 'failed'; readonly diagnostic: string }
  | { readonly id: string; readonly kind: 'deferral'; readonly status: 'reserved' }
  | { readonly id: string; readonly kind: 'deferral'; readonly status: 'applied'; readonly issueUrl: string }
  | { readonly id: string; readonly kind: 'deferral'; readonly status: 'failed'; readonly diagnostic: string };

export interface RemediationCaseRecord {
  readonly id: string;
  readonly domain: 'build_review';
  readonly disposition: RemediationCaseDisposition;
  readonly priority: RemediationCasePriority;
  readonly rationale: string;
  readonly confidence: RemediationCaseConfidence;
  readonly resolution: 'open' | 'resolved';
  readonly sources: readonly RemediationCaseSourceLink[];
  readonly effect: RemediationCaseEffect;
}

/** Immutable evidence captured for the finding that opened a PRD case. */
export interface RemediationCasePrdWideningOriginalSourceSnapshot {
  readonly sourceId: string;
  readonly snapshot: string;
}

/** A later PRD finding, retained as evidence instead of replacing the original. */
export interface RemediationCasePrdWideningCurrentSourceLink {
  readonly sourceId: string;
  readonly snapshot: string;
  readonly recordedAt: string;
}

/**
 * A reconciliation result relates findings only.  It intentionally contains
 * neither an operator decision nor a build-review effect/disposition.
 */
export type RemediationCasePrdWideningRelationship =
  | { readonly currentSourceId: string; readonly kind: 'same-case'; readonly caseId: string; readonly reason: string }
  | { readonly currentSourceId: string; readonly kind: 'different'; readonly reason: string }
  | { readonly currentSourceId: string; readonly kind: 'uncertain'; readonly candidateCaseIds: readonly string[]; readonly reason: string };

/** Effect-free PRD widening history, separate from build-review case authority. */
export interface RemediationCasePrdWideningRecord {
  readonly id: string;
  readonly domain: 'prd_widening';
  readonly originalSources: readonly RemediationCasePrdWideningOriginalSourceSnapshot[];
  readonly currentSources: readonly RemediationCasePrdWideningCurrentSourceLink[];
  readonly relationships: readonly RemediationCasePrdWideningRelationship[];
}

/** The tagged case-record vocabulary for the version-two shared envelope. */
export type RemediationCaseDomainRecord = RemediationCaseRecord | RemediationCasePrdWideningRecord;

/** Return only autonomous BUILD-review records from the shared domain vocabulary. */
export function selectBuildReviewRemediationCases(
  records: readonly RemediationCaseDomainRecord[],
): readonly RemediationCaseRecord[] {
  return records.filter((record): record is RemediationCaseRecord => record.domain === 'build_review');
}

/** Return only effect-free PRD widening records from the shared domain vocabulary. */
export function selectPrdWideningRemediationCases(
  records: readonly RemediationCaseDomainRecord[],
): readonly RemediationCasePrdWideningRecord[] {
  return records.filter((record): record is RemediationCasePrdWideningRecord => record.domain === 'prd_widening');
}

/** Engine-owned history of a sub-floor finding; never operator authority. */
export interface RemediationCaseSuppressionEntry {
  readonly findingId: string;
  readonly rubric: string;
  readonly summary: string;
  readonly confidence: number;
  readonly floor: number;
  readonly lastSeenLap: string;
}

/** Predecessor state accepted at the mutation boundary and upgraded before write. */
export interface RemediationCaseStoreV1State {
  readonly version: typeof LEGACY_STORE_VERSION;
  readonly feature: RemediationCaseFeatureIdentity;
  readonly cases: readonly RemediationCaseRecord[];
  readonly suppressions?: readonly RemediationCaseSuppressionEntry[];
}

/** Current shared envelope. */
export interface RemediationCaseStoreV2State {
  readonly version: typeof STORE_VERSION;
  readonly feature: RemediationCaseFeatureIdentity;
  /** Existing autonomous build-review history. */
  readonly cases: readonly RemediationCaseRecord[];
  /** Effect-free PRD widening history, independent of build-review authority. */
  readonly prdWideningCases: readonly RemediationCasePrdWideningRecord[];
  readonly suppressions: readonly RemediationCaseSuppressionEntry[];
}

export type RemediationCaseStoreState = RemediationCaseStoreV1State | RemediationCaseStoreV2State;

export interface RemediationCaseStoreFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface RemediationCaseStoreOptions {
  readonly filesystem?: RemediationCaseStoreFilesystem;
  readonly lock?: ConductStateLease;
  readonly leaseOptions?: ConductStateLeaseOptions;
}

export type RemediationCaseStoreFailureReason =
  | 'unreadable'
  | 'malformed-json'
  | 'unknown-version'
  | 'foreign-feature'
  | 'foreign-domain'
  | 'malformed-state'
  | 'lock-timeout'
  | 'lock-failed'
  | 'atomic-replace-failed'
  | 'lease-operation-failed';

export type RemediationCaseStoreReadResult =
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

/** Durable feature discovery for restart recovery, with absence kept distinct from corruption. */
export type RemediationCaseStoreFeatureReadResult =
  | { readonly ok: true; readonly feature: RemediationCaseFeatureIdentity | undefined }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

/** The atomic-write outcome of the one leased transition seam, `mutate`. */
export type RemediationCaseStoreReplaceResult =
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

/** A leased read/modify/write operation may decline to replace state. */
export interface RemediationCaseStoreMutation<Value> {
  readonly value: Value;
  readonly nextState?: RemediationCaseStoreState;
}

export type RemediationCaseStoreMutationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

const defaultFilesystem: RemediationCaseStoreFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename: (from, to) => rename(from, to).then(() => undefined),
  rm: (path) => rm(path, { force: true }).then(() => undefined),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function boundedString(value: unknown, maxLength = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validTimestamp(value: unknown): value is string {
  return boundedString(value, MAX_REFERENCE_LENGTH) && !Number.isNaN(Date.parse(value));
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function parseFeature(value: unknown): RemediationCaseFeatureIdentity | undefined {
  if (!isRecord(value) || !exactKeys(value, ['version', 'repository', 'feature']) || value.version !== FEATURE_VERSION ||
    !boundedString(value.repository, MAX_REFERENCE_LENGTH) || !boundedString(value.feature, MAX_REFERENCE_LENGTH)) return undefined;
  return { version: FEATURE_VERSION, repository: value.repository, feature: value.feature };
}

function sameFeature(left: RemediationCaseFeatureIdentity, right: RemediationCaseFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
}

function parseSourceLink(value: unknown): RemediationCaseSourceLink | undefined {
  if (!isRecord(value) || !exactKeys(value, ['sourceId', 'outcome', 'recordedAt']) ||
    !boundedString(value.sourceId, MAX_REFERENCE_LENGTH) || !validTimestamp(value.recordedAt) ||
    !oneOf(value.outcome, ['acted', 'deferred', 'rejected', 'merged'] as const)) return undefined;
  return { sourceId: value.sourceId, outcome: value.outcome, recordedAt: value.recordedAt };
}

function parseEffect(value: unknown, disposition: RemediationCaseDisposition): RemediationCaseEffect | undefined {
  if (!isRecord(value)) return undefined;
  if (disposition === 'reject') {
    return exactKeys(value, ['kind']) && value.kind === 'none' ? { kind: 'none' } : undefined;
  }
  const expectedKind = disposition === 'act' ? 'action' : 'deferral';
  if (!boundedString(value.id, MAX_REFERENCE_LENGTH) || value.kind !== expectedKind) return undefined;
  if (value.status === 'reserved' && exactKeys(value, ['id', 'kind', 'status'])) {
    return expectedKind === 'action'
      ? { id: value.id, kind: 'action', status: 'reserved' }
      : { id: value.id, kind: 'deferral', status: 'reserved' };
  }
  if (value.status === 'failed' && exactKeys(value, ['id', 'kind', 'status', 'diagnostic']) && boundedString(value.diagnostic)) {
    return expectedKind === 'action'
      ? { id: value.id, kind: 'action', status: 'failed', diagnostic: value.diagnostic }
      : { id: value.id, kind: 'deferral', status: 'failed', diagnostic: value.diagnostic };
  }
  if (expectedKind === 'action' && value.status === 'applied' && exactKeys(value, ['id', 'kind', 'status', 'workOrderId']) && boundedString(value.workOrderId, MAX_REFERENCE_LENGTH)) {
    return { id: value.id, kind: 'action', status: 'applied', workOrderId: value.workOrderId };
  }
  if (expectedKind === 'deferral' && value.status === 'applied' && exactKeys(value, ['id', 'kind', 'status', 'issueUrl']) && boundedString(value.issueUrl, MAX_TEXT_LENGTH)) {
    return { id: value.id, kind: 'deferral', status: 'applied', issueUrl: value.issueUrl };
  }
  return undefined;
}

function parseCase(value: unknown):
  | { readonly ok: true; readonly record: RemediationCaseRecord }
  | { readonly ok: false; readonly reason: 'foreign-domain' | 'malformed-state' } {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'domain', 'disposition', 'priority', 'rationale', 'confidence', 'resolution', 'sources', 'effect',
  ])) return { ok: false, reason: 'malformed-state' };
  if (value.domain !== 'build_review') return { ok: false, reason: 'foreign-domain' };
  if (!boundedString(value.id, MAX_REFERENCE_LENGTH) ||
    !oneOf(value.disposition, ['act', 'defer', 'reject'] as const) ||
    !oneOf(value.priority, ['critical', 'high', 'medium', 'low'] as const) ||
    !boundedString(value.rationale) || !oneOf(value.confidence, ['high', 'medium', 'low'] as const) ||
    !oneOf(value.resolution, ['open', 'resolved'] as const) || !Array.isArray(value.sources) ||
    value.sources.length === 0 || value.sources.length > MAX_SOURCES_PER_CASE) return { ok: false, reason: 'malformed-state' };
  const sources = value.sources.map(parseSourceLink);
  const effect = parseEffect(value.effect, value.disposition);
  if (sources.some((source) => source === undefined) || effect === undefined) return { ok: false, reason: 'malformed-state' };
  return { ok: true, record: {
    id: value.id,
    domain: 'build_review',
    disposition: value.disposition,
    priority: value.priority,
    rationale: value.rationale,
    confidence: value.confidence,
    resolution: value.resolution,
    sources: sources as RemediationCaseSourceLink[],
    effect,
  } };
}

function parsePrdWideningOriginalSourceSnapshot(
  value: unknown,
): RemediationCasePrdWideningOriginalSourceSnapshot | undefined {
  if (!isRecord(value) || !exactKeys(value, ['sourceId', 'snapshot']) ||
    !boundedString(value.sourceId, MAX_REFERENCE_LENGTH) || !boundedString(value.snapshot)) return undefined;
  return { sourceId: value.sourceId, snapshot: value.snapshot };
}

function parsePrdWideningCurrentSourceLink(
  value: unknown,
): RemediationCasePrdWideningCurrentSourceLink | undefined {
  if (!isRecord(value) || !exactKeys(value, ['sourceId', 'snapshot', 'recordedAt']) ||
    !boundedString(value.sourceId, MAX_REFERENCE_LENGTH) || !boundedString(value.snapshot) || !validTimestamp(value.recordedAt)) return undefined;
  return { sourceId: value.sourceId, snapshot: value.snapshot, recordedAt: value.recordedAt };
}

function parsePrdWideningRelationship(
  value: unknown,
): RemediationCasePrdWideningRelationship | undefined {
  if (!isRecord(value) || !boundedString(value.currentSourceId, MAX_REFERENCE_LENGTH) ||
    !boundedString(value.reason)) return undefined;
  if (value.kind === 'same-case' && exactKeys(value, ['currentSourceId', 'kind', 'caseId', 'reason']) &&
    boundedString(value.caseId, MAX_REFERENCE_LENGTH)) {
    return { currentSourceId: value.currentSourceId, kind: 'same-case', caseId: value.caseId, reason: value.reason };
  }
  if (value.kind === 'different' && exactKeys(value, ['currentSourceId', 'kind', 'reason'])) {
    return { currentSourceId: value.currentSourceId, kind: 'different', reason: value.reason };
  }
  if (value.kind === 'uncertain' && exactKeys(value, ['currentSourceId', 'kind', 'candidateCaseIds', 'reason']) &&
    Array.isArray(value.candidateCaseIds) && value.candidateCaseIds.length > 0 &&
    value.candidateCaseIds.length <= MAX_CASES &&
    value.candidateCaseIds.every((caseId) => boundedString(caseId, MAX_REFERENCE_LENGTH)) &&
    new Set(value.candidateCaseIds).size === value.candidateCaseIds.length) {
    return { currentSourceId: value.currentSourceId, kind: 'uncertain', candidateCaseIds: value.candidateCaseIds, reason: value.reason };
  }
  return undefined;
}

function parsePrdWideningCase(value: unknown): RemediationCasePrdWideningRecord | undefined {
  if (!isRecord(value) || !exactKeys(value, ['id', 'domain', 'originalSources', 'currentSources', 'relationships']) ||
    value.domain !== 'prd_widening' || !boundedString(value.id, MAX_REFERENCE_LENGTH) ||
    !Array.isArray(value.originalSources) || value.originalSources.length === 0 ||
    value.originalSources.length > MAX_SOURCES_PER_CASE || !Array.isArray(value.currentSources) ||
    value.currentSources.length > MAX_SOURCES_PER_CASE || !Array.isArray(value.relationships) ||
    value.relationships.length > MAX_SOURCES_PER_CASE) return undefined;
  const originalSources = value.originalSources.map(parsePrdWideningOriginalSourceSnapshot);
  const currentSources = value.currentSources.map(parsePrdWideningCurrentSourceLink);
  const relationships = value.relationships.map(parsePrdWideningRelationship);
  if (originalSources.some((source) => source === undefined) || currentSources.some((source) => source === undefined) ||
    relationships.some((relationship) => relationship === undefined)) return undefined;
  const originalSourceIds = originalSources.map((source) => source!.sourceId);
  const currentSourceIds = currentSources.map((source) => source!.sourceId);
  const relationshipSourceIds = relationships.map((relationship) => relationship!.currentSourceId);
  if (new Set(originalSourceIds).size !== originalSourceIds.length ||
    new Set(currentSourceIds).size !== currentSourceIds.length ||
    new Set(relationshipSourceIds).size !== relationshipSourceIds.length ||
    !relationshipSourceIds.every((sourceId) => currentSourceIds.includes(sourceId))) return undefined;
  return {
    id: value.id,
    domain: 'prd_widening',
    originalSources: originalSources as RemediationCasePrdWideningOriginalSourceSnapshot[],
    currentSources: currentSources as RemediationCasePrdWideningCurrentSourceLink[],
    relationships: relationships as RemediationCasePrdWideningRelationship[],
  };
}

/**
 * Parses one member of the shared version-two case envelope.  Task 2 owns
 * migration and envelope loading; this contract stays independently usable by
 * the migration and every domain-specific writer.
 */
export function parseRemediationCaseDomainRecord(value: unknown):
  | { readonly ok: true; readonly record: RemediationCaseDomainRecord }
  | { readonly ok: false; readonly reason: 'foreign-domain' | 'malformed-state' } {
  if (!isRecord(value)) return { ok: false, reason: 'malformed-state' };
  if (value.domain === 'build_review') return parseCase(value);
  if (value.domain === 'prd_widening') {
    const record = parsePrdWideningCase(value);
    return record === undefined
      ? { ok: false, reason: 'malformed-state' }
      : { ok: true, record };
  }
  return { ok: false, reason: 'foreign-domain' };
}

function parseSuppression(value: unknown): RemediationCaseSuppressionEntry | undefined {
  if (!isRecord(value) || !exactKeys(value, ['findingId', 'rubric', 'summary', 'confidence', 'floor', 'lastSeenLap']) ||
    !boundedString(value.findingId, MAX_REFERENCE_LENGTH) || !boundedString(value.rubric, MAX_REFERENCE_LENGTH) ||
    !boundedString(value.summary) || !boundedString(value.lastSeenLap, MAX_REFERENCE_LENGTH) ||
    typeof value.confidence !== 'number' || !Number.isInteger(value.confidence) || value.confidence < 0 || value.confidence > 100 ||
    typeof value.floor !== 'number' || !Number.isInteger(value.floor) || value.floor < 0 || value.floor > 100) return undefined;
  return { findingId: value.findingId, rubric: value.rubric, summary: value.summary, confidence: value.confidence, floor: value.floor, lastSeenLap: value.lastSeenLap };
}

type ParsedState =
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: 'unknown-version' | 'foreign-domain' | 'malformed-state' };

function parseSuppressions(value: unknown): RemediationCaseSuppressionEntry[] | undefined {
  const suppressions = value === undefined ? [] : Array.isArray(value) ? value.map(parseSuppression) : undefined;
  return !suppressions || suppressions.some((entry) => entry === undefined) ||
    new Set(suppressions.map((entry) => entry!.findingId)).size !== suppressions.length
    ? undefined
    : suppressions as RemediationCaseSuppressionEntry[];
}

function parseBuildReviewCases(value: unknown):
  | { readonly ok: true; readonly cases: RemediationCaseRecord[] }
  | { readonly ok: false; readonly reason: 'foreign-domain' | 'malformed-state' } {
  if (!Array.isArray(value) || value.length > MAX_CASES) return { ok: false, reason: 'malformed-state' };
  // Canonical identity: one row per case id, one case per durable effect id,
  // one link per source within a case. Downstream readers index by these ids
  // (`new Map(cases.map(...))`), which would silently collapse a duplicate
  // while the array kept both rows — so duplicates are rejected here, before
  // any caller can consume or mutate the state.
  const caseIds = new Set<string>();
  const effectIds = new Set<string>();
  const sourceIds = new Set<string>();
  const cases: RemediationCaseRecord[] = [];
  for (const caseValue of value) {
    const parsed = parseCase(caseValue);
    if (!parsed.ok) return parsed;
    const record = parsed.record;
    if (caseIds.has(record.id)) return { ok: false, reason: 'malformed-state' };
    caseIds.add(record.id);
    if (record.effect.kind !== 'none') {
      if (effectIds.has(record.effect.id)) return { ok: false, reason: 'malformed-state' };
      effectIds.add(record.effect.id);
    }
    for (const source of record.sources) {
      // Global, not per-case: a source id repeated across two canonical cases
      // is ambiguous durable history in exactly the way a repeat within one
      // case is, and both readers index sources back to a single case.
      if (sourceIds.has(source.sourceId)) return { ok: false, reason: 'malformed-state' };
      sourceIds.add(source.sourceId);
    }
    cases.push(record);
  }
  return { ok: true, cases };
}

function parsePrdWideningCases(value: unknown): RemediationCasePrdWideningRecord[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CASES) return undefined;
  const cases = value.map(parsePrdWideningCase);
  if (cases.some((record) => record === undefined)) return undefined;
  const caseIds = new Set<string>();
  const sourceOwners = new Map<string, string>();
  for (const record of cases as RemediationCasePrdWideningRecord[]) {
    if (caseIds.has(record.id)) return undefined;
    caseIds.add(record.id);
    for (const source of [...record.originalSources, ...record.currentSources]) {
      const owner = sourceOwners.get(source.sourceId);
      if (owner !== undefined && owner !== record.id) return undefined;
      sourceOwners.set(source.sourceId, record.id);
    }
  }
  return cases as RemediationCasePrdWideningRecord[];
}

function parseV1State(value: Record<string, unknown>): ParsedState {
  if (!Object.keys(value).every((key) => ['version', 'feature', 'cases', 'suppressions'].includes(key)) ||
    !['version', 'feature', 'cases'].every((key) => Object.hasOwn(value, key))) return { ok: false, reason: 'malformed-state' };
  const feature = parseFeature(value.feature);
  const cases = parseBuildReviewCases(value.cases);
  const suppressions = parseSuppressions(value.suppressions);
  if (!feature || !cases.ok || !suppressions) return !cases.ok ? cases : { ok: false, reason: 'malformed-state' };
  return {
    ok: true,
    state: {
      version: STORE_VERSION,
      feature,
      cases: cases.cases,
      prdWideningCases: [],
      suppressions,
    },
  };
}

function parseV2State(value: Record<string, unknown>): ParsedState {
  if (!exactKeys(value, ['version', 'feature', 'cases', 'prdWideningCases', 'suppressions'])) return { ok: false, reason: 'malformed-state' };
  const feature = parseFeature(value.feature);
  const cases = parseBuildReviewCases(value.cases);
  const prdWideningCases = parsePrdWideningCases(value.prdWideningCases);
  const suppressions = parseSuppressions(value.suppressions);
  if (!feature || !cases.ok || !prdWideningCases || !suppressions) return !cases.ok ? cases : { ok: false, reason: 'malformed-state' };
  return { ok: true, state: { version: STORE_VERSION, feature, cases: cases.cases, prdWideningCases, suppressions } };
}

function parseState(value: unknown): ParsedState {
  if (!isRecord(value)) return { ok: false, reason: 'malformed-state' };
  if (value.version === LEGACY_STORE_VERSION) return parseV1State(value);
  if (value.version === STORE_VERSION) return parseV2State(value);
  return { ok: false, reason: 'unknown-version' };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Stable feature-worktree path for engine-owned remediation case control state. */
export function remediationCaseStorePath(projectRoot: string): string {
  return join(projectRoot, STORE_PATH);
}

/**
 * A feature-local, versioned case store.  The store owns autonomous case state
 * only; it never reads or writes the separate operator disposition collection.
 */
export class RemediationCaseStore {
  private readonly filesystem: RemediationCaseStoreFilesystem;
  private readonly statePath: string;
  private readonly lock: ConductStateLease;

  constructor(
    projectRoot: string,
    private readonly feature: RemediationCaseFeatureIdentity,
    options: RemediationCaseStoreOptions = {},
  ) {
    this.filesystem = options.filesystem ?? defaultFilesystem;
    this.statePath = remediationCaseStorePath(projectRoot);
    this.lock = options.lock ?? createConductStateLease(this.statePath, {
      ...options.leaseOptions,
      label: 'remediation-case-store',
    });
  }

  private async acquire(): Promise<{ readonly ok: true; readonly release: () => Promise<void> } | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason }> {
    const acquired = await this.lock.acquire();
    if (!acquired.ok) {
      return { ok: false, reason: acquired.kind === 'timeout' ? 'lock-timeout' : 'lock-failed' };
    }
    return { ok: true, release: async () => { await acquired.handle.release(); } };
  }

  private async load(): Promise<RemediationCaseStoreReadResult> {
    let serialized: string;
    try {
      serialized = await this.filesystem.readFile(this.statePath);
    } catch (error) {
      return isMissing(error)
        ? { ok: true, state: { version: STORE_VERSION, feature: this.feature, cases: [], prdWideningCases: [], suppressions: [] } }
        : { ok: false, reason: 'unreadable' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      return { ok: false, reason: 'malformed-json' };
    }
    const parsed = parseState(raw);
    if (!parsed.ok) return parsed;
    return sameFeature(parsed.state.feature, this.feature)
      ? parsed
      : { ok: false, reason: 'foreign-feature' };
  }

  private async atomicReplace(state: RemediationCaseStoreState): Promise<RemediationCaseStoreReplaceResult> {
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await this.filesystem.mkdir(dirname(this.statePath));
      await this.filesystem.writeFile(temporaryPath, `${JSON.stringify(state)}\n`);
      await this.filesystem.rename(temporaryPath, this.statePath);
      return { ok: true, state };
    } catch {
      await this.filesystem.rm(temporaryPath).catch(() => undefined);
      return { ok: false, reason: 'atomic-replace-failed' };
    }
  }

  async read(): Promise<RemediationCaseStoreReadResult> {
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      return await this.load();
    } finally {
      await acquired.release();
    }
  }

  /**
   * Runs an admitted state transition under the same lease used for reads.
   * Omitting `nextState` leaves the exact stored bytes intact.
   *
   * This is the store's ONLY write seam. An unconditional `replace` and a bare
   * `withLease` escape hatch both existed here and neither had a production
   * caller: every durable transition already goes through this method, which
   * keeps the read, the admissibility decision, and the atomic write inside one
   * lease. A second public way to write the same file is a second transactional
   * authority, so they were removed rather than left as reachable-by-accident
   * surface.
   */
  async mutate<Value>(
    operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<Value>>,
  ): Promise<RemediationCaseStoreMutationResult<Value>> {
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const mutation = await operation(loaded.state);
      if (!mutation.nextState) return { ok: true, value: mutation.value };

      const parsed = parseState(mutation.nextState);
      if (!parsed.ok) return parsed;
      if (!sameFeature(parsed.state.feature, this.feature)) return { ok: false, reason: 'foreign-feature' };
      const replaced = await this.atomicReplace(parsed.state);
      return replaced.ok
        ? { ok: true, value: mutation.value }
        : replaced;
    } catch {
      return { ok: false, reason: 'lease-operation-failed' };
    } finally {
      await acquired.release();
    }
  }
}

/**
 * The feature identity recorded in the durable case store, without needing to
 * know it first.
 *
 * BUILD-side restart recovery has no in-memory feature and no git available to
 * re-derive one, but the case store and the work order are written as a pair:
 * the store's own identity is the durable one to bind the order against.
 */
export async function readRemediationCaseStoreFeature(
  projectRoot: string,
  filesystem: RemediationCaseStoreFilesystem = defaultFilesystem,
): Promise<RemediationCaseStoreFeatureReadResult> {
  let serialized: string;
  try {
    serialized = await filesystem.readFile(remediationCaseStorePath(projectRoot));
  } catch (error) {
    return isMissing(error)
      ? { ok: true, feature: undefined }
      : { ok: false, reason: 'unreadable' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }
  const parsed = parseState(raw);
  return parsed.ok
    ? { ok: true, feature: parsed.state.feature }
    : parsed;
}
