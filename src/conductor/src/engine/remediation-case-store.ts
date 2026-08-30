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
  RemediationCaseDomain,
  RemediationCasePriority,
  RemediationCaseSourceOutcome,
} from './remediation-case-artifact.js';

const STORE_VERSION = 'v1' as const;
const STORE_PATH = '.pipeline/remediation-cases.json';
const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;
const MAX_CASES = 128;
const MAX_SOURCES_PER_CASE = 512;

export interface RemediationCaseFeatureIdentity {
  readonly version: typeof STORE_VERSION;
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
  readonly domain: RemediationCaseDomain;
  readonly disposition: RemediationCaseDisposition;
  readonly priority: RemediationCasePriority;
  readonly rationale: string;
  readonly confidence: RemediationCaseConfidence;
  readonly resolution: 'open' | 'resolved';
  readonly sources: readonly RemediationCaseSourceLink[];
  readonly effect: RemediationCaseEffect;
}

export interface RemediationCaseStoreState {
  readonly version: typeof STORE_VERSION;
  readonly feature: RemediationCaseFeatureIdentity;
  readonly cases: readonly RemediationCaseRecord[];
}

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
  | 'malformed-state'
  | 'lock-timeout'
  | 'lock-failed'
  | 'atomic-replace-failed'
  | 'lease-operation-failed';

export type RemediationCaseStoreReadResult =
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

export type RemediationCaseStoreReplaceResult =
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason };

export type RemediationCaseStoreLeaseResult<Value> =
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
  if (!isRecord(value) || !exactKeys(value, ['version', 'repository', 'feature']) || value.version !== STORE_VERSION ||
    !boundedString(value.repository, MAX_REFERENCE_LENGTH) || !boundedString(value.feature, MAX_REFERENCE_LENGTH)) return undefined;
  return { version: STORE_VERSION, repository: value.repository, feature: value.feature };
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

function parseCase(value: unknown): RemediationCaseRecord | undefined {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'domain', 'disposition', 'priority', 'rationale', 'confidence', 'resolution', 'sources', 'effect',
  ]) || !boundedString(value.id, MAX_REFERENCE_LENGTH) || value.domain !== 'build_review' ||
    !oneOf(value.disposition, ['act', 'defer', 'reject'] as const) ||
    !oneOf(value.priority, ['critical', 'high', 'medium', 'low'] as const) ||
    !boundedString(value.rationale) || !oneOf(value.confidence, ['high', 'medium', 'low'] as const) ||
    !oneOf(value.resolution, ['open', 'resolved'] as const) || !Array.isArray(value.sources) ||
    value.sources.length === 0 || value.sources.length > MAX_SOURCES_PER_CASE) return undefined;
  const sources = value.sources.map(parseSourceLink);
  const effect = parseEffect(value.effect, value.disposition);
  if (sources.some((source) => source === undefined) || effect === undefined) return undefined;
  return {
    id: value.id,
    domain: 'build_review',
    disposition: value.disposition,
    priority: value.priority,
    rationale: value.rationale,
    confidence: value.confidence,
    resolution: value.resolution,
    sources: sources as RemediationCaseSourceLink[],
    effect,
  };
}

function parseState(value: unknown):
  | { readonly ok: true; readonly state: RemediationCaseStoreState }
  | { readonly ok: false; readonly reason: 'unknown-version' | 'malformed-state' } {
  if (!isRecord(value) || !exactKeys(value, ['version', 'feature', 'cases'])) return { ok: false, reason: 'malformed-state' };
  if (value.version !== STORE_VERSION) return { ok: false, reason: 'unknown-version' };
  const feature = parseFeature(value.feature);
  if (!feature || !Array.isArray(value.cases) || value.cases.length > MAX_CASES) return { ok: false, reason: 'malformed-state' };
  const cases = value.cases.map(parseCase);
  return cases.some((entry) => entry === undefined)
    ? { ok: false, reason: 'malformed-state' }
    : { ok: true, state: { version: STORE_VERSION, feature, cases: cases as RemediationCaseRecord[] } };
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
        ? { ok: true, state: { version: STORE_VERSION, feature: this.feature, cases: [] } }
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

  async replace(stateInput: unknown): Promise<RemediationCaseStoreReplaceResult> {
    const parsed = parseState(stateInput);
    if (!parsed.ok) return parsed;
    if (!sameFeature(parsed.state.feature, this.feature)) return { ok: false, reason: 'foreign-feature' };
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      return await this.atomicReplace(parsed.state);
    } finally {
      await acquired.release();
    }
  }

  /** Runs a caller-owned read/modify/write sequence under this store's lease. */
  async withLease<Value>(operation: () => Promise<Value>): Promise<RemediationCaseStoreLeaseResult<Value>> {
    const acquired = await this.acquire();
    if (!acquired.ok) return acquired;
    try {
      return { ok: true, value: await operation() };
    } catch {
      return { ok: false, reason: 'lease-operation-failed' };
    } finally {
      await acquired.release();
    }
  }
}
