import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BuildReviewRubricId } from '../types/config.js';
import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from './conduct-state-lease.js';
import {
  parseBuildReviewLapId,
  type BuildReviewInfrastructureFailureReason,
  type BuildReviewLapId,
} from './build-review-domain.js';
import {
  rehydrateBuildReviewFindingIdentity,
  type BuildReviewFindingIdentity,
} from './build-review-finding-identity.js';

const STORE_VERSION = 'v1' as const;
const STORE_PATH = '.pipeline/build-review-dispositions.json';

export interface BuildReviewFeatureIdentity {
  readonly version: typeof STORE_VERSION;
  readonly repository: string;
  readonly feature: string;
}

export interface BuildReviewDispositionRecord {
  readonly version: typeof STORE_VERSION;
  readonly feature: BuildReviewFeatureIdentity;
  readonly finding: BuildReviewFindingIdentity;
  readonly sourceLapId: BuildReviewLapId;
  readonly summary: string;
  readonly rationale: string;
  readonly operator: string;
  readonly acceptedAt: string;
}

/** The closed, durable subject of a reduced-coverage decision. */
export interface BuildReviewReducedCoverageIdentity {
  readonly rubric: BuildReviewRubricId;
  readonly reason: BuildReviewInfrastructureFailureReason;
}

/**
 * A distinct stored record, rather than an optional extension of a finding
 * acceptance. Its identity intentionally excludes all report-only fields.
 */
export interface BuildReviewReducedCoverageDispositionRecord {
  readonly kind: 'reduced-coverage';
  readonly version: typeof STORE_VERSION;
  readonly feature: BuildReviewFeatureIdentity;
  readonly identity: BuildReviewReducedCoverageIdentity;
  readonly rationale: string;
  readonly operator: string;
  readonly acceptedAt: string;
}

export type BuildReviewBeyondStatus = 'unfiled' | 'filed';

/** Durable intake bookkeeping for a finding judged outside the plan boundary. */
export interface BuildReviewBeyondDispositionRecord {
  readonly kind: 'beyond';
  readonly version: typeof STORE_VERSION;
  readonly feature: BuildReviewFeatureIdentity;
  readonly findingId: string;
  readonly rubric: BuildReviewRubricId;
  readonly summary: string;
  readonly evidenceLocations: readonly string[];
  readonly status: BuildReviewBeyondStatus;
  readonly issueUrl?: string;
  readonly recordedAt: string;
  readonly filedAt?: string;
}

type BuildReviewStoredDispositionRecord =
  | BuildReviewDispositionRecord
  | BuildReviewReducedCoverageDispositionRecord
  | BuildReviewBeyondDispositionRecord;

export interface BuildReviewDispositionInput {
  readonly feature: BuildReviewFeatureIdentity;
  readonly finding: BuildReviewFindingIdentity;
  readonly sourceLapId: BuildReviewLapId;
  readonly summary: string;
  readonly rationale: string;
  readonly operator: string;
}

export interface BuildReviewReducedCoverageInput {
  readonly feature: BuildReviewFeatureIdentity;
  readonly rubric: BuildReviewRubricId;
  readonly reason: BuildReviewInfrastructureFailureReason;
  readonly rationale: string;
  readonly operator: string;
}

export interface BuildReviewBeyondInput {
  readonly feature: BuildReviewFeatureIdentity;
  readonly findingId: string;
  readonly rubric: BuildReviewRubricId;
  readonly summary: string;
  readonly evidenceLocations: readonly string[];
}

export interface BuildReviewDispositionFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface BuildReviewDispositionStoreOptions {
  readonly filesystem?: BuildReviewDispositionFilesystem;
  readonly clock?: () => number;
  readonly lock?: ConductStateLease;
  readonly leaseOptions?: Omit<ConductStateLeaseOptions, 'now'>;
}

export type BuildReviewDispositionStoreFailure = {
  readonly ok: false;
  readonly kind: 'lock' | 'unreadable' | 'filesystem' | 'invalid';
  readonly message: string;
};

export type BuildReviewDispositionAppendResult =
  | { readonly ok: true; readonly record: BuildReviewDispositionRecord }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewReducedCoverageAppendResult =
  | { readonly ok: true; readonly record: BuildReviewReducedCoverageDispositionRecord }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewBeyondAppendResult =
  | { readonly ok: true; readonly record: BuildReviewBeyondDispositionRecord }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewDispositionListResult =
  | { readonly ok: true; readonly records: readonly BuildReviewDispositionRecord[] }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewReducedCoverageListResult =
  | { readonly ok: true; readonly records: readonly BuildReviewReducedCoverageDispositionRecord[] }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewBeyondListResult =
  | { readonly ok: true; readonly records: readonly BuildReviewBeyondDispositionRecord[] }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewDispositionLeaseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | BuildReviewDispositionStoreFailure;

interface BuildReviewDispositionState {
  readonly version: typeof STORE_VERSION;
  readonly records: readonly BuildReviewStoredDispositionRecord[];
}

const REDUCED_COVERAGE_RUBRICS = new Set<BuildReviewRubricId>(['tautology', 'scope', 'rootCause', 'completeness']);
const REDUCED_COVERAGE_REASONS = new Set<BuildReviewInfrastructureFailureReason>([
  'provider-error', 'retry-exhausted', 'missing-artifact', 'malformed-artifact', 'stale-artifact',
  'identity-mismatch', 'preflight-failed', 'artifact-read-failed', 'artifact-write-failed',
]);

const defaultFilesystem: BuildReviewDispositionFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseFeatureIdentity(value: unknown): BuildReviewFeatureIdentity | undefined {
  const source = record(value);
  return source && exactKeys(source, ['version', 'repository', 'feature']) && source.version === STORE_VERSION &&
    nonEmptyString(source.repository) && nonEmptyString(source.feature)
    ? { version: STORE_VERSION, repository: source.repository, feature: source.feature }
    : undefined;
}

/**
 * Re-derives a finding identity from its own canonical payload. The payload is
 * validated by the canonical-schema parser, never by the grader-facing anchor
 * parser: those are two different schemas, and putting one on top of the other
 * made every non-scope identity the engine produced unstorable (#1769).
 */
function parseFindingIdentity(value: unknown): BuildReviewFindingIdentity | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, ['id', 'canonicalPayload', 'canonicalJson']) || typeof source.id !== 'string' || typeof source.canonicalJson !== 'string') {
    return undefined;
  }
  const canonical = rehydrateBuildReviewFindingIdentity(source.canonicalPayload);
  return canonical && canonical.id === source.id && canonical.canonicalJson === source.canonicalJson ? canonical : undefined;
}

function parseDispositionRecord(value: unknown): BuildReviewDispositionRecord | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, [
    'version', 'feature', 'finding', 'sourceLapId', 'summary', 'rationale', 'operator', 'acceptedAt',
  ]) || source.version !== STORE_VERSION) return undefined;
  const feature = parseFeatureIdentity(source.feature);
  const finding = parseFindingIdentity(source.finding);
  const sourceLapId = parseBuildReviewLapId(source.sourceLapId);
  if (!feature || !finding || !sourceLapId || !nonEmptyString(source.summary) || !nonEmptyString(source.rationale) ||
    !nonEmptyString(source.operator) || !nonEmptyString(source.acceptedAt) || Number.isNaN(Date.parse(source.acceptedAt))) return undefined;
  return {
    version: STORE_VERSION, feature, finding, sourceLapId, summary: source.summary, rationale: source.rationale,
    operator: source.operator, acceptedAt: source.acceptedAt,
  };
}

function parseReducedCoverageIdentity(value: unknown): BuildReviewReducedCoverageIdentity | undefined {
  const source = record(value);
  return source && exactKeys(source, ['rubric', 'reason']) &&
    typeof source.rubric === 'string' && REDUCED_COVERAGE_RUBRICS.has(source.rubric as BuildReviewRubricId) &&
    typeof source.reason === 'string' && REDUCED_COVERAGE_REASONS.has(source.reason as BuildReviewInfrastructureFailureReason)
    ? { rubric: source.rubric as BuildReviewRubricId, reason: source.reason as BuildReviewInfrastructureFailureReason }
    : undefined;
}

function parseReducedCoverageDispositionRecord(value: unknown): BuildReviewReducedCoverageDispositionRecord | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, [
    'kind', 'version', 'feature', 'identity', 'rationale', 'operator', 'acceptedAt',
  ]) || source.kind !== 'reduced-coverage' || source.version !== STORE_VERSION) return undefined;
  const feature = parseFeatureIdentity(source.feature);
  const identity = parseReducedCoverageIdentity(source.identity);
  if (!feature || !identity || !nonEmptyString(source.rationale) || !nonEmptyString(source.operator) ||
    !nonEmptyString(source.acceptedAt) || Number.isNaN(Date.parse(source.acceptedAt))) return undefined;
  return {
    kind: 'reduced-coverage', version: STORE_VERSION, feature, identity,
    rationale: source.rationale, operator: source.operator, acceptedAt: source.acceptedAt,
  };
}

function parseBeyondDispositionRecord(value: unknown): BuildReviewBeyondDispositionRecord | undefined {
  const source = record(value);
  if (!source || source.kind !== 'beyond' || source.version !== STORE_VERSION ||
    !nonEmptyString(source.findingId) || typeof source.rubric !== 'string' ||
    !REDUCED_COVERAGE_RUBRICS.has(source.rubric as BuildReviewRubricId) || !nonEmptyString(source.summary) ||
    !Array.isArray(source.evidenceLocations) || source.evidenceLocations.length === 0 ||
    source.evidenceLocations.some((location) => !nonEmptyString(location)) ||
    !nonEmptyString(source.recordedAt) || Number.isNaN(Date.parse(source.recordedAt))) return undefined;
  const feature = parseFeatureIdentity(source.feature);
  if (!feature) return undefined;
  if (source.status === 'unfiled' && exactKeys(source, [
    'kind', 'version', 'feature', 'findingId', 'rubric', 'summary', 'evidenceLocations', 'status', 'recordedAt',
  ])) {
    return {
      kind: 'beyond', version: STORE_VERSION, feature, findingId: source.findingId,
      rubric: source.rubric as BuildReviewRubricId, summary: source.summary,
      evidenceLocations: Object.freeze([...source.evidenceLocations]), status: 'unfiled', recordedAt: source.recordedAt,
    };
  }
  if (source.status === 'filed' && exactKeys(source, [
    'kind', 'version', 'feature', 'findingId', 'rubric', 'summary', 'evidenceLocations', 'status', 'issueUrl', 'recordedAt', 'filedAt',
  ]) && nonEmptyString(source.issueUrl) && nonEmptyString(source.filedAt) && !Number.isNaN(Date.parse(source.filedAt))) {
    return {
      kind: 'beyond', version: STORE_VERSION, feature, findingId: source.findingId,
      rubric: source.rubric as BuildReviewRubricId, summary: source.summary,
      evidenceLocations: Object.freeze([...source.evidenceLocations]), status: 'filed', issueUrl: source.issueUrl,
      recordedAt: source.recordedAt, filedAt: source.filedAt,
    };
  }
  return undefined;
}

function parseStoredDispositionRecord(value: unknown): BuildReviewStoredDispositionRecord | undefined {
  switch (record(value)?.kind) {
    case 'reduced-coverage': return parseReducedCoverageDispositionRecord(value);
    case 'beyond': return parseBeyondDispositionRecord(value);
    default: return parseDispositionRecord(value);
  }
}

function isFindingDispositionRecord(value: BuildReviewStoredDispositionRecord): value is BuildReviewDispositionRecord {
  return !('kind' in value);
}

function isBeyondDispositionRecord(value: BuildReviewStoredDispositionRecord): value is BuildReviewBeyondDispositionRecord {
  return 'kind' in value && value.kind === 'beyond';
}

function parseState(value: unknown): BuildReviewDispositionState | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, ['version', 'records']) || source.version !== STORE_VERSION || !Array.isArray(source.records)) return undefined;
  const records = source.records.map(parseStoredDispositionRecord);
  return records.every((entry): entry is BuildReviewStoredDispositionRecord => entry !== undefined)
    ? { version: STORE_VERSION, records }
    : undefined;
}

function sameFeature(left: BuildReviewFeatureIdentity, right: BuildReviewFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
}

/**
 * Matches a disposition only when its feature and complete recomputed
 * canonical payload agree. Matching an ID alone would make a theoretical hash
 * collision or forged in-memory record capable of suppressing a new concern.
 */
export function matchesBuildReviewDisposition(
  feature: BuildReviewFeatureIdentity,
  finding: BuildReviewFindingIdentity,
  dispositions: readonly BuildReviewDispositionRecord[],
): boolean {
  const canonicalFinding = parseFindingIdentity(finding);
  if (!canonicalFinding) return false;
  return dispositions.some((disposition) => {
    const accepted = parseFindingIdentity(disposition.finding);
    return sameFeature(disposition.feature, feature) && accepted !== undefined &&
      accepted.id === canonicalFinding.id && accepted.canonicalJson === canonicalFinding.canonicalJson;
  });
}

/**
 * A reduced-coverage decision is confined to the feature and complete closed
 * identity it was recorded for. It cannot weaken another rubric or cause.
 */
export function matchesBuildReviewReducedCoverageDisposition(
  feature: BuildReviewFeatureIdentity,
  identity: BuildReviewReducedCoverageIdentity,
  dispositions: readonly BuildReviewReducedCoverageDispositionRecord[],
): boolean {
  const canonicalIdentity = parseReducedCoverageIdentity(identity);
  if (!canonicalIdentity) return false;
  return dispositions.some((disposition) => {
    // Keep this reducer fail-closed even when a caller has decoded an older
    // state file into an unrecognised record shape.  Such a record is never
    // authority to reduce a current review.
    if (disposition.kind !== 'reduced-coverage') return false;
    const recordedIdentity = parseReducedCoverageIdentity(disposition.identity);
    return recordedIdentity !== undefined &&
      sameFeature(disposition.feature, feature) &&
      recordedIdentity.rubric === canonicalIdentity.rubric &&
      recordedIdentity.reason === canonicalIdentity.reason;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Stable location for the versioned, feature-scoped disposition collection. */
export function buildReviewDispositionStorePath(projectRoot: string): string {
  return join(projectRoot, STORE_PATH);
}

/**
 * Durable accepted-risk state. Every read and mutation takes the same bounded
 * lease; state is written through a same-directory temporary file and rename.
 */
export class BuildReviewDispositionStore {
  private readonly filesystem: BuildReviewDispositionFilesystem;
  private readonly clock: () => number;
  private readonly statePath: string;
  private readonly lock: ConductStateLease;

  constructor(projectRoot: string, options: BuildReviewDispositionStoreOptions = {}) {
    this.filesystem = options.filesystem ?? defaultFilesystem;
    this.clock = options.clock ?? Date.now;
    this.statePath = buildReviewDispositionStorePath(projectRoot);
    this.lock = options.lock ?? createConductStateLease(this.statePath, {
      ...options.leaseOptions,
      now: this.clock,
    });
  }

  private async acquire(): Promise<BuildReviewDispositionStoreFailure | { readonly ok: true; readonly release: () => Promise<void> }> {
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return { ok: false, kind: 'lock', message: acquired.message };
    return {
      ok: true,
      release: async () => {
        await acquired.handle.release();
      },
    };
  }

  private async load(): Promise<{ readonly ok: true; readonly state: BuildReviewDispositionState } | BuildReviewDispositionStoreFailure> {
    try {
      const parsed = parseState(JSON.parse(await this.filesystem.readFile(this.statePath)));
      return parsed
        ? { ok: true, state: parsed }
        : { ok: false, kind: 'unreadable', message: 'build-review disposition state is malformed' };
    } catch (error) {
      return isMissing(error)
        ? { ok: true, state: { version: STORE_VERSION, records: [] } }
        : { ok: false, kind: 'unreadable', message: `unable to read build-review disposition state: ${errorMessage(error)}` };
    }
  }

  private async replace(state: BuildReviewDispositionState): Promise<BuildReviewDispositionStoreFailure | { readonly ok: true }> {
    const tempPath = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await this.filesystem.mkdir(dirname(this.statePath));
      await this.filesystem.writeFile(tempPath, `${JSON.stringify(state)}\n`);
      await this.filesystem.rename(tempPath, this.statePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: 'filesystem', message: `unable to atomically write build-review disposition state: ${errorMessage(error)}` };
    }
  }

  /**
   * One feature-local bounded transaction for the raw aggregate and durable
   * accepted-risk state.  Aggregate publishers and finding acceptance share
   * this exact lease, so a lap replacement cannot pass between acceptance's
   * current-lap reread and its append.
   */
  async withLease<Value>(operation: () => Promise<Value>): Promise<BuildReviewDispositionLeaseResult<Value>> {
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      return { ok: false, kind: 'filesystem', message: `build-review lease operation failed: ${errorMessage(error)}` };
    } finally {
      await acquired.release();
    }
  }

  async list(featureInput: unknown): Promise<BuildReviewDispositionListResult> {
    const feature = parseFeatureIdentity(featureInput);
    if (!feature) return { ok: false, kind: 'invalid', message: 'build-review feature identity is invalid' };
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      return loaded.ok
        ? { ok: true, records: Object.freeze(loaded.state.records.filter(isFindingDispositionRecord).filter((entry) => sameFeature(entry.feature, feature))) }
        : loaded;
    } finally {
      await acquired.release();
    }
  }

  async listReducedCoverage(featureInput: unknown): Promise<BuildReviewReducedCoverageListResult> {
    const feature = parseFeatureIdentity(featureInput);
    if (!feature) return { ok: false, kind: 'invalid', message: 'build-review feature identity is invalid' };
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      return loaded.ok
        ? { ok: true, records: Object.freeze(loaded.state.records.filter((entry): entry is BuildReviewReducedCoverageDispositionRecord =>
          'kind' in entry && entry.kind === 'reduced-coverage' && sameFeature(entry.feature, feature))) }
        : loaded;
    } finally {
      await acquired.release();
    }
  }

  async listBeyond(featureInput: unknown): Promise<BuildReviewBeyondListResult> {
    const feature = parseFeatureIdentity(featureInput);
    if (!feature) return { ok: false, kind: 'invalid', message: 'build-review feature identity is invalid' };
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      return loaded.ok
        ? { ok: true, records: Object.freeze(loaded.state.records.filter(isBeyondDispositionRecord).filter((entry) => sameFeature(entry.feature, feature))) }
        : loaded;
    } finally {
      await acquired.release();
    }
  }

  async appendBeyondIfAbsent(input: BuildReviewBeyondInput): Promise<BuildReviewBeyondAppendResult> {
    const feature = parseFeatureIdentity(input.feature);
    if (!feature || !nonEmptyString(input.findingId) || !REDUCED_COVERAGE_RUBRICS.has(input.rubric) ||
      !nonEmptyString(input.summary) || input.evidenceLocations.length === 0 || input.evidenceLocations.some((location) => !nonEmptyString(location))) {
      return { ok: false, kind: 'invalid', message: 'build-review beyond input is invalid' };
    }
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const existing = loaded.state.records.filter(isBeyondDispositionRecord)
        .find((entry) => sameFeature(entry.feature, feature) && entry.findingId === input.findingId);
      if (existing) return { ok: true, record: existing };
      const disposition: BuildReviewBeyondDispositionRecord = {
        kind: 'beyond', version: STORE_VERSION, feature, findingId: input.findingId, rubric: input.rubric,
        summary: input.summary, evidenceLocations: Object.freeze([...input.evidenceLocations]), status: 'unfiled',
        recordedAt: new Date(this.clock()).toISOString(),
      };
      const replaced = await this.replace({ version: STORE_VERSION, records: [...loaded.state.records, disposition] });
      return replaced.ok ? { ok: true, record: disposition } : replaced;
    } finally {
      await acquired.release();
    }
  }

  async markBeyondFiled(featureInput: unknown, findingId: string, issueUrl: string): Promise<BuildReviewBeyondAppendResult> {
    const feature = parseFeatureIdentity(featureInput);
    if (!feature || !nonEmptyString(findingId) || !nonEmptyString(issueUrl)) {
      return { ok: false, kind: 'invalid', message: 'build-review beyond filing input is invalid' };
    }
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const existing = loaded.state.records.filter(isBeyondDispositionRecord)
        .find((entry) => sameFeature(entry.feature, feature) && entry.findingId === findingId);
      if (!existing) return { ok: false, kind: 'invalid', message: 'build-review beyond record does not exist for this feature' };
      if (existing.status === 'filed') return { ok: true, record: existing };
      const filed: BuildReviewBeyondDispositionRecord = {
        ...existing, status: 'filed', issueUrl, filedAt: new Date(this.clock()).toISOString(),
      };
      const records = loaded.state.records.map((entry) => entry === existing ? filed : entry);
      const replaced = await this.replace({ version: STORE_VERSION, records });
      return replaced.ok ? { ok: true, record: filed } : replaced;
    } finally {
      await acquired.release();
    }
  }

  async append(input: BuildReviewDispositionInput): Promise<BuildReviewDispositionAppendResult> {
    const feature = parseFeatureIdentity(input.feature);
    const finding = parseFindingIdentity(input.finding);
    const sourceLapId = parseBuildReviewLapId(input.sourceLapId);
    if (!feature || !finding || !sourceLapId || !nonEmptyString(input.summary) || !nonEmptyString(input.rationale) || !nonEmptyString(input.operator)) {
      return { ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' };
    }
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      if (loaded.state.records.some((entry) => isFindingDispositionRecord(entry) && sameFeature(entry.feature, feature) && entry.finding.id === finding.id)) {
        return { ok: false, kind: 'invalid', message: 'build-review finding is already accepted for this feature' };
      }
      const disposition: BuildReviewDispositionRecord = {
        version: STORE_VERSION, feature, finding, sourceLapId, summary: input.summary, rationale: input.rationale,
        operator: input.operator, acceptedAt: new Date(this.clock()).toISOString(),
      };
      const replaced = await this.replace({ version: STORE_VERSION, records: [...loaded.state.records, disposition] });
      return replaced.ok ? { ok: true, record: disposition } : replaced;
    } finally {
      await acquired.release();
    }
  }

  /**
   * Validates a reduced-coverage decision against current caller-owned state
   * and appends it under the aggregate publisher's shared lease.
   */
  async appendReducedCoverageIfCurrent(
    input: BuildReviewReducedCoverageInput,
    validate: (records: readonly BuildReviewReducedCoverageDispositionRecord[]) => Promise<boolean>,
  ): Promise<BuildReviewReducedCoverageAppendResult> {
    const feature = parseFeatureIdentity(input.feature);
    const identity = parseReducedCoverageIdentity({ rubric: input.rubric, reason: input.reason });
    if (!feature || !identity || !nonEmptyString(input.rationale) || !nonEmptyString(input.operator)) {
      return { ok: false, kind: 'invalid', message: 'build-review reduced-coverage input is invalid' };
    }
    const transaction = await this.withLease(async (): Promise<BuildReviewReducedCoverageAppendResult> => {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const records = loaded.state.records.filter((entry): entry is BuildReviewReducedCoverageDispositionRecord =>
        !isFindingDispositionRecord(entry) && sameFeature(entry.feature, feature));
      if (!await validate(Object.freeze(records))) {
        return { ok: false, kind: 'invalid', message: 'current reduced-coverage state is invalid' };
      }
      if (records.some((record) => record.identity.rubric === identity.rubric && record.identity.reason === identity.reason)) {
        return { ok: false, kind: 'invalid', message: 'reduced coverage is already recorded for this rubric and cause' };
      }
      const disposition: BuildReviewReducedCoverageDispositionRecord = {
        kind: 'reduced-coverage', version: STORE_VERSION, feature, identity,
        rationale: input.rationale, operator: input.operator, acceptedAt: new Date(this.clock()).toISOString(),
      };
      const replaced = await this.replace({ version: STORE_VERSION, records: [...loaded.state.records, disposition] });
      return replaced.ok ? { ok: true, record: disposition } : replaced;
    });
    return transaction.ok ? transaction.value : transaction;
  }

  /**
   * Runs caller validation and the disposition append under the one bounded
   * state lease.  Callers use this when their validation also reads a sibling
   * aggregate whose lap must not change between observation and acceptance.
   */
  async appendIfCurrent(
    input: BuildReviewDispositionInput,
    validate: (records: readonly BuildReviewDispositionRecord[]) => Promise<boolean>,
  ): Promise<BuildReviewDispositionAppendResult> {
    const feature = parseFeatureIdentity(input.feature);
    const finding = parseFindingIdentity(input.finding);
    const sourceLapId = parseBuildReviewLapId(input.sourceLapId);
    if (!feature || !finding || !sourceLapId || !nonEmptyString(input.summary) || !nonEmptyString(input.rationale) || !nonEmptyString(input.operator)) {
      return { ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' };
    }
    const transaction = await this.withLease(async (): Promise<BuildReviewDispositionAppendResult> => {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const records = loaded.state.records.filter(isFindingDispositionRecord).filter((entry) => sameFeature(entry.feature, feature));
      if (!await validate(Object.freeze(records))) return { ok: false, kind: 'invalid', message: 'current build-review lap or finding is invalid' };
      if (records.some((entry) => entry.finding.id === finding.id)) return { ok: false, kind: 'invalid', message: 'build-review finding is already accepted for this feature' };
      const disposition: BuildReviewDispositionRecord = {
        version: STORE_VERSION, feature, finding, sourceLapId, summary: input.summary, rationale: input.rationale,
        operator: input.operator, acceptedAt: new Date(this.clock()).toISOString(),
      };
      const replaced = await this.replace({ version: STORE_VERSION, records: [...loaded.state.records, disposition] });
      return replaced.ok ? { ok: true, record: disposition } : replaced;
    });
    return transaction.ok ? transaction.value : transaction;
  }
}
