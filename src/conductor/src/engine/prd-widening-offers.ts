import {
  renderOverScopeDecisionBlock,
  type OverScopePersistedOffer,
} from './accepted-widenings.js';
import {
  RemediationCaseStore,
  type RemediationCasePrdWideningRecord,
  type RemediationCaseStoreMutation,
  type RemediationCaseStoreMutationResult,
  type RemediationCaseStoreState,
  type RemediationCaseFeatureIdentity,
} from './remediation-case-store.js';

export interface PrdWideningOfferInput {
  readonly criterion: string;
  /** Stable source identity from the report parser, never a rendered row ordinal. */
  readonly sourceId: string;
  /** Immutable evidence the operator is deciding about. */
  readonly evidence: string;
  /** The complete report snapshot that produced this offer. */
  readonly reportSnapshot: string;
  readonly relation: 'outside-visible';
}

export interface PrdWideningOfferStore {
  mutate(
    operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<readonly OverScopePersistedOffer[]>>,
  ): Promise<RemediationCaseStoreMutationResult<readonly OverScopePersistedOffer[]>>;
}

export interface PersistPrdWideningOffersOptions {
  readonly store?: PrdWideningOfferStore;
  readonly newCaseId?: () => string;
  readonly now?: () => string;
}

export type PersistPrdWideningOffersResult =
  | {
      readonly ok: true;
      readonly offers: readonly OverScopePersistedOffer[];
      readonly block: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly offers: readonly [];
      readonly block: '';
    };

const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;

function bounded(value: string, maximum = MAX_TEXT_LENGTH): boolean {
  return value.trim().length > 0 && value.length <= maximum;
}

/**
 * A report snapshot is context, not identity: the offer's identity is its
 * `sourceId` and `evidence`. A full prd-audit report routinely exceeds the
 * store's text bound, so it is clipped to the bound instead of rejecting the
 * whole offer as `invalid-offer` (which surfaced as `persistence-failed`).
 */
export function boundReportSnapshot(reportSnapshot: string): string {
  // The widening context bound (`proseBytes`) is measured in UTF-8 bytes, so
  // clip by bytes as well: a report with multibyte characters (em dashes,
  // arrows) that is clipped by character count still exceeds the byte bound
  // and the offer is rejected as `context-overflow` on the very next read.
  if (Buffer.byteLength(reportSnapshot, 'utf8') <= MAX_TEXT_LENGTH) return reportSnapshot;
  let clipped = Buffer.from(reportSnapshot, 'utf8').subarray(0, MAX_TEXT_LENGTH).toString('utf8');
  // A cut inside a multibyte sequence decodes to U+FFFD; drop the partial character.
  if (clipped.endsWith('\uFFFD')) clipped = clipped.slice(0, -1);
  return clipped;
}

function validInput(input: PrdWideningOfferInput): boolean {
  return bounded(input.criterion, MAX_REFERENCE_LENGTH) &&
    bounded(input.sourceId, MAX_REFERENCE_LENGTH) && bounded(input.evidence) &&
    bounded(input.reportSnapshot) && input.relation === 'outside-visible';
}

export function offeredCaseToPersistedOffer(
  record: RemediationCasePrdWideningRecord,
): OverScopePersistedOffer | undefined {
  const original = record.originalSources.at(0);
  if (!original || !record.offeredCriterion) return undefined;
  return {
    kind: 'pending',
    criterion: record.offeredCriterion,
    summary: original.snapshot,
    relation: 'outside-visible',
    // One original source opens one PRD case. The case id is therefore the
    // immutable editable-entry identity as well as the offered case reference.
    offerEntryId: record.id,
    originalSource: { id: original.sourceId, snapshot: original.snapshot },
    originalCaseId: record.id,
  };
}

function existingOffer(
  cases: readonly RemediationCasePrdWideningRecord[],
  input: PrdWideningOfferInput,
): RemediationCasePrdWideningRecord | undefined {
  return cases.find((record) => record.originalSources.some((source) =>
    source.sourceId === input.sourceId && source.snapshot === input.evidence));
}

function sourceOwnedByAnotherOffer(
  cases: readonly RemediationCasePrdWideningRecord[],
  input: PrdWideningOfferInput,
): boolean {
  return cases.some((record) => record.originalSources.some((source) =>
    source.sourceId === input.sourceId && source.snapshot !== input.evidence));
}

function stateWithOffers(
  state: RemediationCaseStoreState,
  offers: readonly RemediationCasePrdWideningRecord[],
): RemediationCaseStoreState {
  return {
    version: 'v2',
    feature: state.feature,
    cases: state.cases,
    prdWideningCases: offers,
    suppressions: state.suppressions ?? [],
  };
}

/**
 * Saves each original widening source before an operator-visible editable
 * block exists. The resulting case id is the stable offer identity consumed by
 * later decision capture; report wording is evidence, never that identity.
 */
export async function persistPrdWideningOffers(
  projectRoot: string,
  feature: RemediationCaseFeatureIdentity,
  rawInputs: readonly PrdWideningOfferInput[],
  options: PersistPrdWideningOffersOptions = {},
): Promise<PersistPrdWideningOffersResult> {
  const inputs = rawInputs.map((input) => ({ ...input, reportSnapshot: boundReportSnapshot(input.reportSnapshot) }));
  if (inputs.some((input) => !validInput(input)) ||
    new Set(inputs.map((input) => input.sourceId)).size !== inputs.length) {
    return { ok: false, reason: 'could not persist PRD widening offer: invalid-offer', offers: [], block: '' };
  }
  const store = options.store ?? new RemediationCaseStore(projectRoot, feature);
  const newCaseId = options.newCaseId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const result = await store.mutate(async (state) => {
    const current = state.version === 'v2' ? state.prdWideningCases : [];
    if (inputs.some((input) => sourceOwnedByAnotherOffer(current, input))) {
      return { value: [] as readonly OverScopePersistedOffer[] };
    }
    const next = [...current];
    const offers: OverScopePersistedOffer[] = [];
    for (const input of inputs) {
      let record = existingOffer(next, input);
      if (!record) {
        const id = newCaseId();
        if (!bounded(id, MAX_REFERENCE_LENGTH) || next.some((candidate) => candidate.id === id)) {
          return { value: [] as readonly OverScopePersistedOffer[] };
        }
        record = {
          id,
          domain: 'prd_widening',
          offeredCriterion: input.criterion.trim(),
          originalSources: [{ sourceId: input.sourceId, snapshot: input.evidence }],
          currentSources: [{ sourceId: input.sourceId, snapshot: input.reportSnapshot, recordedAt: now() }],
          relationships: [],
        };
        next.push(record);
      }
      const offer = offeredCaseToPersistedOffer(record);
      if (!offer) return { value: [] as readonly OverScopePersistedOffer[] };
      offers.push(offer);
    }
    return {
      value: offers,
      nextState: stateWithOffers(state, next),
    };
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: `could not persist PRD widening offer: ${result.reason}`,
      offers: [],
      block: '',
    };
  }
  if (result.value.length !== inputs.length) {
    return { ok: false, reason: 'could not persist PRD widening offer: conflicting-source', offers: [], block: '' };
  }
  return { ok: true, offers: result.value, block: renderOverScopeDecisionBlock(result.value) };
}
import { randomUUID } from 'node:crypto';
