import type {
  AcceptedWideningDecision,
  AcceptedWideningDecisionAppendResult,
  AcceptedWideningDecisionInput,
} from './accepted-widenings.js';
import type {
  RemediationCasePrdWideningRecord,
  RemediationCaseStoreMutation,
  RemediationCaseStoreMutationResult,
  RemediationCaseStoreState,
} from './remediation-case-store.js';

const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;

export interface PrdWideningCaptureOfferStore {
  mutate(
    operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<readonly RemediationCasePrdWideningRecord[]>>,
  ): Promise<RemediationCaseStoreMutationResult<readonly RemediationCasePrdWideningRecord[]>>;
}

export interface PrdWideningCaptureDecisionStore {
  append(input: AcceptedWideningDecisionInput): Promise<AcceptedWideningDecisionAppendResult>;
}

export interface CapturePrdWideningDecisionsOptions {
  /** Resolved from the configured machine owner; an absent value grants nothing. */
  readonly operator: string | undefined;
  readonly offerStore: PrdWideningCaptureOfferStore;
  readonly decisionStore: PrdWideningCaptureDecisionStore;
}

export type PrdWideningCaptureDefectKind =
  | 'malformed-block'
  | 'malformed-entry'
  | 'changed-offer-reference'
  | 'duplicate-offer-entry'
  | 'invalid-decision'
  | 'missing-rationale'
  | 'missing-operator'
  | 'offer-read-failed'
  | 'write-failed';

export interface PrdWideningCaptureDefect {
  readonly kind: PrdWideningCaptureDefectKind;
  readonly offerEntryId?: string;
}

export type CapturePrdWideningDecisionsResult =
  | { readonly kind: 'absent'; readonly captured: readonly []; readonly defects: readonly [] }
  | {
      readonly kind: 'captured';
      readonly captured: readonly AcceptedWideningDecision[];
      readonly defects: readonly PrdWideningCaptureDefect[];
    };

interface ClearedDecisionEntry {
  readonly criterion: string;
  readonly authority: 'accept' | 'refuse' | 'pending' | undefined;
  readonly rationale: string | undefined;
  readonly offerEntryId: string | undefined;
  readonly originalCaseId: string | undefined;
  readonly originalSource: { readonly id: string; readonly snapshot: string } | undefined;
}

function bounded(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function parseSource(value: unknown): ClearedDecisionEntry['originalSource'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || !Object.hasOwn(source, 'id') || !Object.hasOwn(source, 'snapshot') ||
    !bounded(source.id, MAX_REFERENCE_LENGTH) || !bounded(source.snapshot)) return undefined;
  return { id: source.id, snapshot: source.snapshot };
}

function parseEntry(value: unknown): ClearedDecisionEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  return {
    criterion: typeof entry.criterion === 'string' ? entry.criterion.trim() : '',
    authority: entry.decision === 'accept' || entry.decision === 'refuse' || entry.decision === 'pending'
      ? entry.decision
      : undefined,
    rationale: typeof entry.rationale === 'string' ? entry.rationale.trim() : undefined,
    offerEntryId: bounded(entry.offerEntryId, MAX_REFERENCE_LENGTH) ? entry.offerEntryId.trim() : undefined,
    originalCaseId: bounded(entry.originalCaseId, MAX_REFERENCE_LENGTH) ? entry.originalCaseId.trim() : undefined,
    originalSource: parseSource(entry.originalSource),
  };
}

function matchesPersistedOffer(
  entry: ClearedDecisionEntry,
  cases: readonly RemediationCasePrdWideningRecord[],
): boolean {
  if (!entry.offerEntryId || !entry.originalCaseId || !entry.originalSource ||
    entry.offerEntryId !== entry.originalCaseId) return false;
  const offer = cases.find((candidate) => candidate.id === entry.offerEntryId);
  return offer !== undefined && offer.originalSources.some((source) =>
    source.sourceId === entry.originalSource!.id && source.snapshot === entry.originalSource!.snapshot);
}

async function persistedOffers(
  store: PrdWideningCaptureOfferStore,
): Promise<RemediationCaseStoreMutationResult<readonly RemediationCasePrdWideningRecord[]>> {
  return store.mutate(async (state) => ({
    value: state.version === 'v2' ? state.prdWideningCases : [],
  }));
}

/**
 * Captures cleared authority only after proving its immutable offer references
 * still name a source/case persisted before the editable halt was rendered.
 * The source/case write is intentionally a prior transition (Task 6); failed
 * authority appends therefore leave a harmless offer-only case that can replay.
 */
export async function capturePrdWideningDecisions(
  clearedBlock: string,
  options: CapturePrdWideningDecisionsOptions,
): Promise<CapturePrdWideningDecisionsResult> {
  const match = clearedBlock.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
  if (!match) return { kind: 'absent', captured: [], defects: [] };
  let rawEntries: unknown;
  try {
    rawEntries = JSON.parse(match[1]!);
  } catch {
    return { kind: 'captured', captured: [], defects: [{ kind: 'malformed-block' }] };
  }
  if (!Array.isArray(rawEntries)) return { kind: 'captured', captured: [], defects: [{ kind: 'malformed-block' }] };

  const offers = await persistedOffers(options.offerStore);
  if (!offers.ok) return { kind: 'captured', captured: [], defects: [{ kind: 'offer-read-failed' }] };

  const captured: AcceptedWideningDecision[] = [];
  const defects: PrdWideningCaptureDefect[] = [];
  const handledOffers = new Set<string>();
  for (const raw of rawEntries) {
    const entry = parseEntry(raw);
    if (!entry) {
      defects.push({ kind: 'malformed-entry' });
      continue;
    }
    // An untouched rendered entry is an offer, never implicit machine authority.
    if (entry.authority === 'pending') continue;
    if (entry.authority === undefined) {
      defects.push({ kind: 'invalid-decision', ...(entry.offerEntryId ? { offerEntryId: entry.offerEntryId } : {}) });
      continue;
    }
    if (!matchesPersistedOffer(entry, offers.value)) {
      defects.push({ kind: 'changed-offer-reference', ...(entry.offerEntryId ? { offerEntryId: entry.offerEntryId } : {}) });
      continue;
    }
    if (!bounded(entry.criterion, MAX_REFERENCE_LENGTH)) {
      defects.push({ kind: 'invalid-decision', offerEntryId: entry.offerEntryId });
      continue;
    }
    if (!bounded(entry.rationale)) {
      defects.push({ kind: 'missing-rationale', offerEntryId: entry.offerEntryId });
      continue;
    }
    if (!bounded(options.operator, MAX_REFERENCE_LENGTH)) {
      defects.push({ kind: 'missing-operator', offerEntryId: entry.offerEntryId });
      continue;
    }
    if (handledOffers.has(entry.offerEntryId!)) {
      defects.push({ kind: 'duplicate-offer-entry', offerEntryId: entry.offerEntryId });
      continue;
    }
    handledOffers.add(entry.offerEntryId!);
    const input: AcceptedWideningDecisionInput = {
      criterion: entry.criterion,
      authority: entry.authority,
      rationale: entry.rationale,
      operator: options.operator.trim(),
      originalSource: entry.originalSource!,
      originalCaseId: entry.originalCaseId!,
      offerEntryId: entry.offerEntryId!,
    };
    const appended = await options.decisionStore.append(input);
    if (!appended.ok) {
      defects.push({ kind: 'write-failed', offerEntryId: entry.offerEntryId });
      continue;
    }
    captured.push(appended.decision);
  }
  return { kind: 'captured', captured, defects };
}
