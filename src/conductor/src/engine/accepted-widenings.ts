import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from './conduct-state-lease.js';

export const ACCEPTED_WIDENINGS_PATH = '.pipeline/accepted-widenings.json';

const ACCEPTED_WIDENINGS_STORE_VERSION = 2 as const;
const MAX_DECISION_REFERENCE_LENGTH = 256;
const MAX_DECISION_TEXT_LENGTH = 8_000;
const MAX_DECISIONS = 512;

/** The separately versioned feature identity that decision authority belongs to. */
export interface AcceptedWideningFeatureIdentity {
  readonly version: 1;
  readonly repository: string;
  readonly feature: string;
}

/** Evidence stamped before an operator can make a finding-level decision. */
export interface AcceptedWideningOriginalSource {
  readonly id: string;
  readonly snapshot: string;
}

/** An engine-ordered reference to the decision an explicit reversal replaces. */
export interface AcceptedWideningDecisionReference {
  readonly id: string;
  readonly revision: number;
}

/** Immutable row evidence retained when a legacy authority document is migrated. */
export interface AcceptedWideningLegacyRowEvidence {
  readonly summary: string;
  readonly decidedAt?: string;
}

/**
 * An immutable operator decision. Criterion decisions deliberately omit source
 * references; NC decisions carry the original offer's source and case rather
 * than a lap-local ordinal or later reviewer wording.
 */
export interface AcceptedWideningDecision {
  readonly id: string;
  readonly criterion: string;
  readonly authority: 'accept' | 'refuse';
  readonly rationale: string;
  readonly operator: string;
  readonly revision: number;
  readonly originalSource?: AcceptedWideningOriginalSource;
  readonly originalCaseId?: string;
  /** Immutable identity of the editable offer entry that created this decision. */
  readonly offerEntryId?: string;
  /** Original row evidence and attribution retained from v1 migration. */
  readonly legacyRow?: AcceptedWideningLegacyRowEvidence;
  readonly supersedes?: AcceptedWideningDecisionReference;
}

export interface AcceptedWideningDecisionState {
  readonly version: typeof ACCEPTED_WIDENINGS_STORE_VERSION;
  readonly feature: AcceptedWideningFeatureIdentity;
  readonly decisions: readonly AcceptedWideningDecision[];
}

export interface AcceptedWideningDecisionInput {
  readonly criterion: string;
  readonly authority: 'accept' | 'refuse';
  readonly rationale: string;
  readonly operator: string;
  readonly originalSource?: AcceptedWideningOriginalSource;
  readonly originalCaseId?: string;
  readonly offerEntryId?: string;
  readonly legacyRow?: AcceptedWideningLegacyRowEvidence;
  readonly supersedes?: AcceptedWideningDecisionReference;
}

export interface AcceptedWideningDecisionStoreFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface AcceptedWideningDecisionStoreOptions {
  readonly filesystem?: AcceptedWideningDecisionStoreFilesystem;
  readonly lock?: ConductStateLease;
  readonly leaseOptions?: ConductStateLeaseOptions;
  readonly newDecisionId?: () => string;
}

/** No invalid storage outcome is ever an empty successful authority history. */
export type AcceptedWideningDecisionReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly state: AcceptedWideningDecisionState }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unsupported'; readonly version: unknown }
  | { readonly kind: 'foreign-feature' }
  | { readonly kind: 'lease-failed'; readonly reason: 'lock-timeout' | 'lock-failed' | 'unreadable' };

export type AcceptedWideningDecisionAppendResult =
  | { readonly ok: true; readonly decision: AcceptedWideningDecision }
  | { readonly ok: false; readonly reason: 'invalid-decision' | 'malformed-state' | 'unsupported-version' | 'foreign-feature' | 'lock-timeout' | 'lock-failed' | 'unreadable' | 'atomic-replace-failed' | 'lease-operation-failed' };

/** A version-one authority row retained only long enough to migrate it safely. */
export interface LegacyOverScopeDecision {
  readonly criterion: string;
  readonly summary: string;
  readonly decision: 'accept' | 'refuse';
  readonly rationale: string;
  readonly operator: string;
  readonly decidedAt: string;
}

/** The digest binds deterministic migration identities to this exact legacy input. */
export interface LegacyOverScopeDecisionDocument {
  readonly version: 1;
  readonly documentId: string;
  readonly decisions: readonly LegacyOverScopeDecision[];
}

export type LegacyOverScopeDecisionReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'legacy'; readonly document: LegacyOverScopeDecisionDocument }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unsupported'; readonly version: unknown }
  | { readonly kind: 'unreadable' };

export type AcceptedWideningLegacyMigrationResult =
  | { readonly ok: true; readonly kind: 'migrated' | 'already-migrated' }
  | { readonly ok: false; readonly reason: 'legacy-changed' | 'malformed-state' | 'unsupported-version' | 'foreign-feature' | 'lock-timeout' | 'lock-failed' | 'unreadable' | 'atomic-replace-failed' | 'lease-operation-failed' };

const decisionStoreFilesystem: AcceptedWideningDecisionStoreFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename: (from, to) => rename(from, to).then(() => undefined),
  rm: (path) => rm(path, { force: true }).then(() => undefined),
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function boundedDecisionString(value: unknown, maxLength = MAX_DECISION_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function parseDecisionFeature(value: unknown): AcceptedWideningFeatureIdentity | undefined {
  if (!isObjectRecord(value) || !hasExactKeys(value, ['version', 'repository', 'feature']) || value.version !== 1 ||
    !boundedDecisionString(value.repository, MAX_DECISION_REFERENCE_LENGTH) ||
    !boundedDecisionString(value.feature, MAX_DECISION_REFERENCE_LENGTH)) return undefined;
  return { version: 1, repository: value.repository, feature: value.feature };
}

function sameDecisionFeature(left: AcceptedWideningFeatureIdentity, right: AcceptedWideningFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
}

function parseOriginalSource(value: unknown): AcceptedWideningOriginalSource | undefined {
  if (!isObjectRecord(value) || !hasExactKeys(value, ['id', 'snapshot']) ||
    !boundedDecisionString(value.id, MAX_DECISION_REFERENCE_LENGTH) || !boundedDecisionString(value.snapshot)) return undefined;
  return { id: value.id, snapshot: value.snapshot };
}

function parseDecisionReference(value: unknown): AcceptedWideningDecisionReference | undefined {
  if (!isObjectRecord(value) || !hasExactKeys(value, ['id', 'revision']) ||
    !boundedDecisionString(value.id, MAX_DECISION_REFERENCE_LENGTH) ||
    typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1) return undefined;
  return { id: value.id, revision: value.revision };
}

function parseLegacyRowEvidence(value: unknown): AcceptedWideningLegacyRowEvidence | undefined {
  if (!isObjectRecord(value) || !hasExactKeys(value, [
    'summary',
    ...(Object.hasOwn(value, 'decidedAt') ? ['decidedAt'] : []),
  ]) || !boundedDecisionString(value.summary) ||
    (Object.hasOwn(value, 'decidedAt') && !boundedDecisionString(value.decidedAt, MAX_DECISION_REFERENCE_LENGTH))) return undefined;
  return {
    summary: value.summary,
    ...(Object.hasOwn(value, 'decidedAt') ? { decidedAt: value.decidedAt as string } : {}),
  };
}

function sameDecisionCase(
  left: Pick<AcceptedWideningDecision, 'originalCaseId' | 'originalSource'>,
  right: Pick<AcceptedWideningDecision, 'originalCaseId' | 'originalSource'>,
): boolean {
  return left.originalCaseId !== undefined && right.originalCaseId !== undefined &&
    left.originalCaseId === right.originalCaseId && left.originalSource?.id === right.originalSource?.id &&
    left.originalSource?.snapshot === right.originalSource?.snapshot;
}

function hasValidDecisionRelationships(decisions: readonly AcceptedWideningDecision[]): boolean {
  const offerEntries = new Set<string>();
  for (const decision of decisions) {
    const prior = decisions.slice(0, decision.revision - 1).filter((candidate) => sameDecisionCase(candidate, decision)).at(-1);
    if (decision.offerEntryId !== undefined && offerEntries.has(decision.offerEntryId)) {
      // A rendered revision names the immutable offer that produced the
      // immediately preceding decision.  No other offer-id reuse is valid.
      if (!prior || prior.offerEntryId !== decision.offerEntryId || decision.supersedes?.id !== prior.id ||
        decision.supersedes.revision !== prior.revision) return false;
    }
    if (decision.offerEntryId !== undefined) offerEntries.add(decision.offerEntryId);
    if (decision.supersedes === undefined) {
      if (prior !== undefined) return false;
      continue;
    }
    // A legacy row with the same authority retains distinct attribution but
    // does not change the effective authority.
    if (decision.offerEntryId === undefined || !prior || decision.supersedes.id !== prior.id ||
      decision.supersedes.revision !== prior.revision) return false;
  }
  return true;
}

function parseDecision(value: unknown): AcceptedWideningDecision | undefined {
  if (!isObjectRecord(value)) return undefined;
  const hasSource = Object.hasOwn(value, 'originalSource');
  const hasCase = Object.hasOwn(value, 'originalCaseId');
  if (hasSource !== hasCase) return undefined;
  const keys = [
    'id', 'criterion', 'authority', 'rationale', 'operator', 'revision',
    ...(hasSource ? ['originalSource', 'originalCaseId'] : []),
    ...(Object.hasOwn(value, 'offerEntryId') ? ['offerEntryId'] : []),
    ...(Object.hasOwn(value, 'legacyRow') ? ['legacyRow'] : []),
    ...(Object.hasOwn(value, 'supersedes') ? ['supersedes'] : []),
  ];
  if (!hasExactKeys(value, keys) || !boundedDecisionString(value.id, MAX_DECISION_REFERENCE_LENGTH) ||
    !boundedDecisionString(value.criterion, MAX_DECISION_REFERENCE_LENGTH) ||
    (value.authority !== 'accept' && value.authority !== 'refuse') ||
    !boundedDecisionString(value.rationale) || !boundedDecisionString(value.operator, MAX_DECISION_REFERENCE_LENGTH) ||
    typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1 ||
    (Object.hasOwn(value, 'offerEntryId') && !boundedDecisionString(value.offerEntryId, MAX_DECISION_REFERENCE_LENGTH))) return undefined;
  const originalSource = hasSource ? parseOriginalSource(value.originalSource) : undefined;
  const legacyRow = Object.hasOwn(value, 'legacyRow') ? parseLegacyRowEvidence(value.legacyRow) : undefined;
  const supersedes = Object.hasOwn(value, 'supersedes') ? parseDecisionReference(value.supersedes) : undefined;
  if (hasSource && (!originalSource || !boundedDecisionString(value.originalCaseId, MAX_DECISION_REFERENCE_LENGTH)) ||
    (Object.hasOwn(value, 'legacyRow') && !legacyRow) ||
    (Object.hasOwn(value, 'offerEntryId') && !hasSource) ||
    (Object.hasOwn(value, 'supersedes') && (!supersedes || !hasSource || !Object.hasOwn(value, 'offerEntryId')))) return undefined;
  return {
    id: value.id,
    criterion: value.criterion,
    authority: value.authority,
    rationale: value.rationale,
    operator: value.operator,
    revision: value.revision,
    ...(originalSource === undefined ? {} : { originalSource, originalCaseId: value.originalCaseId as string }),
    ...(Object.hasOwn(value, 'offerEntryId') ? { offerEntryId: value.offerEntryId as string } : {}),
    ...(legacyRow === undefined ? {} : { legacyRow }),
    ...(supersedes === undefined ? {} : { supersedes }),
  };
}

function parseDecisionState(value: unknown):
  | { readonly kind: 'valid'; readonly state: AcceptedWideningDecisionState }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unsupported'; readonly version: unknown } {
  if (!isObjectRecord(value)) return { kind: 'malformed' };
  if (value.version !== ACCEPTED_WIDENINGS_STORE_VERSION) return { kind: 'unsupported', version: value.version };
  if (!hasExactKeys(value, ['version', 'feature', 'decisions']) || !Array.isArray(value.decisions) ||
    value.decisions.length > MAX_DECISIONS) return { kind: 'malformed' };
  const feature = parseDecisionFeature(value.feature);
  const decisions = value.decisions.map(parseDecision);
  if (!feature || decisions.some((decision) => decision === undefined)) return { kind: 'malformed' };
  const accepted = decisions as AcceptedWideningDecision[];
  if (new Set(accepted.map((decision) => decision.id)).size !== accepted.length ||
    accepted.some((decision, index) => decision.revision !== index + 1) || !hasValidDecisionRelationships(accepted)) return { kind: 'malformed' };
  return { kind: 'valid', state: { version: ACCEPTED_WIDENINGS_STORE_VERSION, feature, decisions: accepted } };
}

function isMissingDecisionStore(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Feature-local authority with one leased atomic decision append seam. */
export class AcceptedWideningDecisionStore {
  private readonly filesystem: AcceptedWideningDecisionStoreFilesystem;
  private readonly path: string;
  private readonly lock: ConductStateLease;
  private readonly newDecisionId: () => string;

  constructor(
    projectRoot: string,
    private readonly feature: AcceptedWideningFeatureIdentity,
    options: AcceptedWideningDecisionStoreOptions = {},
  ) {
    this.filesystem = options.filesystem ?? decisionStoreFilesystem;
    this.path = join(projectRoot, ACCEPTED_WIDENINGS_PATH);
    this.lock = options.lock ?? createConductStateLease(this.path, {
      ...options.leaseOptions,
      label: 'accepted-widening-decision-store',
    });
    this.newDecisionId = options.newDecisionId ?? randomUUID;
  }

  private async acquire(): Promise<{ readonly ok: true; readonly release: () => Promise<void> } | Extract<AcceptedWideningDecisionReadResult, { readonly kind: 'lease-failed' }>> {
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return { kind: 'lease-failed', reason: acquired.kind === 'timeout' ? 'lock-timeout' : 'lock-failed' };
    return { ok: true, release: async () => { await acquired.handle.release(); } };
  }

  private async load(): Promise<AcceptedWideningDecisionReadResult> {
    let serialized: string;
    try {
      serialized = await this.filesystem.readFile(this.path);
    } catch (error) {
      return isMissingDecisionStore(error) ? { kind: 'absent' } : { kind: 'lease-failed', reason: 'unreadable' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      return { kind: 'malformed' };
    }
    const parsed = parseDecisionState(raw);
    if (parsed.kind !== 'valid') return parsed;
    return sameDecisionFeature(parsed.state.feature, this.feature)
      ? parsed
      : { kind: 'foreign-feature' };
  }

  private async atomicReplace(state: AcceptedWideningDecisionState): Promise<boolean> {
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await this.filesystem.mkdir(dirname(this.path));
      await this.filesystem.writeFile(temporaryPath, `${JSON.stringify(state)}\n`);
      await this.filesystem.rename(temporaryPath, this.path);
      return true;
    } catch {
      await this.filesystem.rm(temporaryPath).catch(() => undefined);
      return false;
    }
  }

  async read(): Promise<AcceptedWideningDecisionReadResult> {
    const acquired = await this.acquire();
    if (!('ok' in acquired)) return acquired;
    try {
      return await this.load();
    } finally {
      await acquired.release();
    }
  }

  /**
   * Replaces one verified v1 document with its complete v2 projection in one
   * atomic transition. Case snapshots are deliberately written by the caller
   * first, so a failed transition leaves only harmless source history behind.
   */
  async migrateLegacy(
    document: LegacyOverScopeDecisionDocument,
    decisions: readonly AcceptedWideningDecision[],
  ): Promise<AcceptedWideningLegacyMigrationResult> {
    const next = parseDecisionState({
      version: ACCEPTED_WIDENINGS_STORE_VERSION,
      feature: this.feature,
      decisions,
    });
    if (next.kind !== 'valid') return { ok: false, reason: 'malformed-state' };
    const acquired = await this.acquire();
    if (!('ok' in acquired)) return { ok: false, reason: acquired.reason };
    try {
      let serialized: string;
      try {
        serialized = await this.filesystem.readFile(this.path);
      } catch (error) {
        return isMissingDecisionStore(error)
          ? { ok: false, reason: 'legacy-changed' }
          : { ok: false, reason: 'unreadable' };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(serialized);
      } catch {
        return { ok: false, reason: 'malformed-state' };
      }
      if (!isObjectRecord(raw)) return { ok: false, reason: 'malformed-state' };
      if (raw.version === 1) {
        if (!hasExactKeys(raw, ['version', 'decisions']) || !Array.isArray(raw.decisions) ||
          !raw.decisions.every(isOverScopeDecision)) return { ok: false, reason: 'malformed-state' };
        if (legacyDocumentId(serialized) !== document.documentId) return { ok: false, reason: 'legacy-changed' };
        return await this.atomicReplace(next.state)
          ? { ok: true, kind: 'migrated' }
          : { ok: false, reason: 'atomic-replace-failed' };
      }
      if (raw.version !== ACCEPTED_WIDENINGS_STORE_VERSION) return { ok: false, reason: 'unsupported-version' };
      const existing = parseDecisionState(raw);
      if (existing.kind !== 'valid') return { ok: false, reason: 'malformed-state' };
      if (!sameDecisionFeature(existing.state.feature, this.feature)) return { ok: false, reason: 'foreign-feature' };
      return JSON.stringify(existing.state.decisions) === JSON.stringify(next.state.decisions)
        ? { ok: true, kind: 'already-migrated' }
        : { ok: false, reason: 'legacy-changed' };
    } catch {
      return { ok: false, reason: 'lease-operation-failed' };
    } finally {
      await acquired.release();
    }
  }

  async append(input: unknown): Promise<AcceptedWideningDecisionAppendResult> {
    const parsedInput = parseDecisionInput(input);
    if (!parsedInput) return { ok: false, reason: 'invalid-decision' };
    const acquired = await this.acquire();
    if (!('ok' in acquired)) return { ok: false, reason: acquired.reason };
    try {
      const loaded = await this.load();
      if (loaded.kind === 'malformed') return { ok: false, reason: 'malformed-state' };
      if (loaded.kind === 'unsupported') return { ok: false, reason: 'unsupported-version' };
      if (loaded.kind === 'foreign-feature') return { ok: false, reason: 'foreign-feature' };
      if (loaded.kind === 'lease-failed') return { ok: false, reason: loaded.reason };
      const state = loaded.kind === 'absent'
        ? { version: ACCEPTED_WIDENINGS_STORE_VERSION, feature: this.feature, decisions: [] as readonly AcceptedWideningDecision[] }
        : loaded.state;
      // Pre-offer legacy clears have no offer entry. Their deterministic
      // source/case reference is their replay key; an exact replay is inert
      // while a different authority still requires an explicit revision.
      const legacyReplay = parsedInput.offerEntryId === undefined && parsedInput.supersedes === undefined
        ? state.decisions.find((decision) =>
          decision.offerEntryId === undefined &&
          decision.criterion === parsedInput.criterion &&
          decision.authority === parsedInput.authority &&
          decision.rationale === parsedInput.rationale &&
          decision.operator === parsedInput.operator &&
          decision.originalCaseId === parsedInput.originalCaseId &&
          decision.originalSource?.id === parsedInput.originalSource?.id &&
          decision.originalSource?.snapshot === parsedInput.originalSource?.snapshot)
        : undefined;
      if (legacyReplay !== undefined) return { ok: true, decision: legacyReplay };
      // A revision deliberately reuses the immutable offer entry.  It is not
      // an old-clear replay: supersession validation below must see it.
      const replay = parsedInput.offerEntryId === undefined || parsedInput.supersedes !== undefined
        ? undefined
        : state.decisions.find((decision) => decision.offerEntryId === parsedInput.offerEntryId);
      if (replay !== undefined) return { ok: true, decision: replay };
      const prior = state.decisions.filter((decision) => sameDecisionCase(decision, parsedInput)).at(-1);
      if (parsedInput.supersedes !== undefined) {
        // Re-capturing the same persisted revision (an unchanged HALT.cleared
        // read again) is a replay of the recorded supersession, not a new one.
        if (prior !== undefined && prior.supersedes !== undefined &&
          prior.supersedes.id === parsedInput.supersedes.id &&
          prior.supersedes.revision === parsedInput.supersedes.revision &&
          prior.offerEntryId === parsedInput.offerEntryId &&
          prior.authority === parsedInput.authority) return { ok: true, decision: prior };
        if (!prior || parsedInput.supersedes.id !== prior.id || parsedInput.supersedes.revision !== prior.revision) {
          return { ok: false, reason: 'invalid-decision' };
        }
        if (parsedInput.authority === prior.authority) return { ok: true, decision: prior };
      } else if (prior !== undefined) {
        return { ok: false, reason: 'invalid-decision' };
      }
      const id = this.newDecisionId();
      if (!boundedDecisionString(id, MAX_DECISION_REFERENCE_LENGTH) || state.decisions.some((decision) => decision.id === id)) {
        return { ok: false, reason: 'invalid-decision' };
      }
      const decision: AcceptedWideningDecision = {
        id,
        ...parsedInput,
        revision: state.decisions.length + 1,
      };
      const nextState: AcceptedWideningDecisionState = { ...state, decisions: [...state.decisions, decision] };
      if (parseDecisionState(nextState).kind !== 'valid') return { ok: false, reason: 'invalid-decision' };
      return await this.atomicReplace(nextState)
        ? { ok: true, decision }
        : { ok: false, reason: 'atomic-replace-failed' };
    } catch {
      return { ok: false, reason: 'lease-operation-failed' };
    } finally {
      await acquired.release();
    }
  }
}

function parseDecisionInput(value: unknown): Omit<AcceptedWideningDecision, 'id' | 'revision'> | undefined {
  if (!isObjectRecord(value)) return undefined;
  const hasSource = Object.hasOwn(value, 'originalSource');
  const hasCase = Object.hasOwn(value, 'originalCaseId');
  if (hasSource !== hasCase) return undefined;
  const keys = [
    'criterion', 'authority', 'rationale', 'operator',
    ...(hasSource ? ['originalSource', 'originalCaseId'] : []),
    ...(Object.hasOwn(value, 'offerEntryId') ? ['offerEntryId'] : []),
    ...(Object.hasOwn(value, 'legacyRow') ? ['legacyRow'] : []),
    ...(Object.hasOwn(value, 'supersedes') ? ['supersedes'] : []),
  ];
  if (!hasExactKeys(value, keys) || !boundedDecisionString(value.criterion, MAX_DECISION_REFERENCE_LENGTH) ||
    (value.authority !== 'accept' && value.authority !== 'refuse') || !boundedDecisionString(value.rationale) ||
    !boundedDecisionString(value.operator, MAX_DECISION_REFERENCE_LENGTH) ||
    (Object.hasOwn(value, 'offerEntryId') && !boundedDecisionString(value.offerEntryId, MAX_DECISION_REFERENCE_LENGTH))) return undefined;
  const originalSource = hasSource ? parseOriginalSource(value.originalSource) : undefined;
  const legacyRow = Object.hasOwn(value, 'legacyRow') ? parseLegacyRowEvidence(value.legacyRow) : undefined;
  const supersedes = Object.hasOwn(value, 'supersedes') ? parseDecisionReference(value.supersedes) : undefined;
  if ((hasSource && (!originalSource || !boundedDecisionString(value.originalCaseId, MAX_DECISION_REFERENCE_LENGTH))) ||
    (Object.hasOwn(value, 'legacyRow') && !legacyRow) ||
    (Object.hasOwn(value, 'offerEntryId') && !hasSource) ||
    (Object.hasOwn(value, 'supersedes') && (!supersedes || !hasSource || !Object.hasOwn(value, 'offerEntryId')))) return undefined;
  return {
    criterion: value.criterion.trim(),
    authority: value.authority,
    rationale: value.rationale.trim(),
    operator: value.operator.trim(),
    ...(originalSource === undefined ? {} : { originalSource, originalCaseId: (value.originalCaseId as string).trim() }),
    ...(Object.hasOwn(value, 'offerEntryId') ? { offerEntryId: (value.offerEntryId as string).trim() } : {}),
    ...(legacyRow === undefined ? {} : { legacyRow }),
    ...(supersedes === undefined ? {} : { supersedes }),
  };
}

export type IntentRelation = 'within' | 'outside-harmless' | 'outside-visible';

function isOverScopeDecision(value: unknown): value is LegacyOverScopeDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.criterion === 'string' && entry.criterion.trim().length > 0 && typeof entry.summary === 'string' && entry.summary.trim().length > 0 && (entry.decision === 'accept' || entry.decision === 'refuse') && typeof entry.rationale === 'string' && entry.rationale.trim().length > 0 && typeof entry.operator === 'string' && entry.operator.trim().length > 0 && typeof entry.decidedAt === 'string' && entry.decidedAt.trim().length > 0;
}

function legacyDocumentId(serialized: string): string {
  return `legacy-document-${createHash('sha256').update(serialized).digest('hex')}`;
}

/**
 * Reads the retired authority document without re-binding it to a current
 * report. Corruption stays distinct from absence so migration never replaces
 * an unreadable source with an empty v2 authority history.
 */
export async function readLegacyOverScopeDecisionDocument(
  projectRoot: string,
): Promise<LegacyOverScopeDecisionReadResult> {
  let serialized: string;
  try {
    serialized = await readFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), 'utf8');
  } catch (error) {
    return isMissingDecisionStore(error) ? { kind: 'absent' } : { kind: 'unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { kind: 'malformed' };
  }
  if (!isObjectRecord(parsed)) return { kind: 'malformed' };
  if (parsed.version !== 1) return { kind: 'unsupported', version: parsed.version };
  if (!hasExactKeys(parsed, ['version', 'decisions']) || !Array.isArray(parsed.decisions) ||
    parsed.decisions.length > MAX_DECISIONS || !parsed.decisions.every(isOverScopeDecision)) {
    return { kind: 'malformed' };
  }
  return {
    kind: 'legacy',
    document: { version: 1, documentId: legacyDocumentId(serialized), decisions: parsed.decisions },
  };
}

export interface OverScopeRenderableFinding { criterion: string; summary: string; relation: IntentRelation }

/** An editable operator offer reconstructed only from engine-persisted case state. */
export type OverScopePersistedOffer =
  | {
      readonly kind: 'pending';
      readonly criterion: string;
      readonly summary: string;
      readonly relation: 'outside-visible';
      readonly offerEntryId: string;
      readonly originalSource: AcceptedWideningOriginalSource;
      readonly originalCaseId: string;
    }
  | {
      readonly kind: 'revise-decision';
      readonly criterion: string;
      readonly summary: string;
      readonly relation: 'outside-visible';
      readonly offerEntryId: string;
      readonly originalSource: AcceptedWideningOriginalSource;
      readonly originalCaseId: string;
      readonly priorDecision: AcceptedWideningDecisionReference;
    };

function isPersistedOffer(value: OverScopeRenderableFinding | OverScopePersistedOffer): value is OverScopePersistedOffer {
  return 'offerEntryId' in value;
}

/** Names the sanctioned clear: `halt clear` renames HALT to HALT.cleared, the only file the next lap harvests. */
const OVER_SCOPE_CLEAR_INSTRUCTION = 'run `ai-conductor halt clear --feature <slug> --rationale "<why>"`, which preserves this block for the next audit lap. Do not delete this file: deleting it discards every decision recorded here.';

export function renderOverScopeDecisionBlock(undecided: readonly (OverScopeRenderableFinding | OverScopePersistedOffer)[], refused: readonly OverScopeRenderableFinding[] = [], defects: readonly { kind: string; criterion?: string; message?: string }[] = []): string {
  const parts: string[] = [];
  const editable = undecided.filter((finding) => finding.relation === 'outside-visible');
  const pending = editable.filter((finding) => !isPersistedOffer(finding) || finding.kind === 'pending');
  const revisions = editable.filter((finding): finding is Extract<OverScopePersistedOffer, { kind: 'revise-decision' }> =>
    isPersistedOffer(finding) && finding.kind === 'revise-decision');
  const renderOffer = (finding: OverScopeRenderableFinding | OverScopePersistedOffer) => {
    if (!isPersistedOffer(finding)) {
      return { criterion: finding.criterion, summary: finding.summary, relation: finding.relation, decision: 'pending' };
    }
    return {
      ...(finding.kind === 'revise-decision' ? { kind: 'revise-decision', priorDecision: finding.priorDecision } : {}),
      criterion: finding.criterion,
      summary: finding.summary,
      relation: finding.relation,
      offerEntryId: finding.offerEntryId,
      originalSource: finding.originalSource,
      originalCaseId: finding.originalCaseId,
      decision: 'pending',
    };
  };
  if (pending.length) {
    parts.push(`Blocking criteria awaiting a decision: ${pending.map((f) => f.criterion).join(', ')}.`);
    parts.push(`Edit each \`decision\` to \`accept\` or \`refuse\` with a \`rationale\`, then ${OVER_SCOPE_CLEAR_INSTRUCTION}`);
    parts.push(`\`\`\`json over-scope-decisions\n${JSON.stringify(pending.map(renderOffer), null, 2)}\n\`\`\``);
  }
  if (revisions.length || refused.length) {
    parts.push(`Refused — rework required: ${[...revisions, ...refused].map((f) => f.criterion).join(', ')}.`);
  }
  if (revisions.length) {
    parts.push(`To revise a refusal, edit each \`decision\` to \`accept\` or \`refuse\` with a \`rationale\`; leaving \`decision\` as \`pending\` keeps the prior decision unchanged. Then ${OVER_SCOPE_CLEAR_INSTRUCTION}`);
    parts.push(`\`\`\`json over-scope-decisions\n${JSON.stringify(revisions.map(renderOffer), null, 2)}\n\`\`\``);
  }
  if (defects.length) parts.push(`Unreadable scope decisions: ${defects.map((d) => d.message ? `${d.kind} (${d.message})` : d.criterion ? `${d.kind} (${d.criterion})` : d.kind).join(', ')}.`);
  return parts.join('\n\n');
}
