import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from './conduct-state-lease.js';
import { parseBuildReviewLapId, type BuildReviewLapId } from './build-review-domain.js';
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

export interface BuildReviewDispositionInput {
  readonly feature: BuildReviewFeatureIdentity;
  readonly finding: BuildReviewFindingIdentity;
  readonly sourceLapId: BuildReviewLapId;
  readonly summary: string;
  readonly rationale: string;
  readonly operator: string;
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

export type BuildReviewDispositionListResult =
  | { readonly ok: true; readonly records: readonly BuildReviewDispositionRecord[] }
  | BuildReviewDispositionStoreFailure;

export type BuildReviewDispositionLeaseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | BuildReviewDispositionStoreFailure;

interface BuildReviewDispositionState {
  readonly version: typeof STORE_VERSION;
  readonly records: readonly BuildReviewDispositionRecord[];
}

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

function parseState(value: unknown): BuildReviewDispositionState | undefined {
  const source = record(value);
  if (!source || !exactKeys(source, ['version', 'records']) || source.version !== STORE_VERSION || !Array.isArray(source.records)) return undefined;
  const records = source.records.map(parseDispositionRecord);
  return records.every((entry): entry is BuildReviewDispositionRecord => entry !== undefined)
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
        ? { ok: true, records: Object.freeze(loaded.state.records.filter((entry) => sameFeature(entry.feature, feature))) }
        : loaded;
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
      if (loaded.state.records.some((entry) => sameFeature(entry.feature, feature) && entry.finding.id === finding.id)) {
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
      const records = loaded.state.records.filter((entry) => sameFeature(entry.feature, feature));
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
