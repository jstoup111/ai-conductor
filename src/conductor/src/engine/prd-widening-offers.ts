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

function validInput(input: PrdWideningOfferInput): boolean {
  return bounded(input.criterion, MAX_REFERENCE_LENGTH) &&
    bounded(input.sourceId, MAX_REFERENCE_LENGTH) && bounded(input.evidence) &&
    bounded(input.reportSnapshot) && input.relation === 'outside-visible';
}

function offeredCaseToPersistedOffer(
  criterion: string,
  record: RemediationCasePrdWideningRecord,
): OverScopePersistedOffer | undefined {
  const original = record.originalSources.at(0);
  if (!original) return undefined;
  return {
    kind: 'pending',
    criterion,
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
  inputs: readonly PrdWideningOfferInput[],
  options: PersistPrdWideningOffersOptions = {},
): Promise<PersistPrdWideningOffersResult> {
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
          originalSources: [{ sourceId: input.sourceId, snapshot: input.evidence }],
          currentSources: [{ sourceId: input.sourceId, snapshot: input.reportSnapshot, recordedAt: now() }],
          relationships: [],
        };
        next.push(record);
      }
      const offer = offeredCaseToPersistedOffer(input.criterion, record);
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
