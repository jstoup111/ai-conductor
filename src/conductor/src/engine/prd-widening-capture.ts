import { createHash } from 'node:crypto';

import type {
  AcceptedWideningDecision,
  AcceptedWideningDecisionAppendResult,
  AcceptedWideningDecisionInput,
  AcceptedWideningDecisionReference,
  AcceptedWideningDecisionReadResult,
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
  /** Optional for mocked captures; the real store uses it to preserve legacy replay semantics. */
  read?(): Promise<AcceptedWideningDecisionReadResult>;
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
  | 'write-failed'
  | 'unsupported-legacy-clear';

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
  readonly summary: string;
  readonly relation: 'outside-visible' | undefined;
  readonly authority: 'accept' | 'refuse' | 'pending' | undefined;
  readonly rationale: string | undefined;
  readonly offerEntryId: string | undefined;
  readonly originalCaseId: string | undefined;
  readonly originalSource: { readonly id: string; readonly snapshot: string } | undefined;
  readonly priorDecision: AcceptedWideningDecisionReference | undefined;
}

/** A pre-offer clear has evidence, decision, and rationale but no forged v2 reference. */
export interface LegacyPrdWideningClear {
  readonly criterion: string;
  readonly summary: string;
  readonly authority: 'accept' | 'refuse';
  readonly rationale: string;
}

export type LegacyPrdWideningClearParse =
  | { readonly kind: 'absent'; readonly entries: readonly [] }
  | { readonly kind: 'supported'; readonly entries: readonly LegacyPrdWideningClear[] }
  | { readonly kind: 'unsupported' };

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

function parsePriorDecision(value: unknown): AcceptedWideningDecisionReference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const reference = value as Record<string, unknown>;
  return Object.keys(reference).length === 2 && bounded(reference.id, MAX_REFERENCE_LENGTH) &&
    typeof reference.revision === 'number' && Number.isInteger(reference.revision) && reference.revision > 0
    ? { id: reference.id.trim(), revision: reference.revision }
    : undefined;
}

function parseEntry(value: unknown): ClearedDecisionEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const priorDecision = Object.hasOwn(entry, 'priorDecision') ? parsePriorDecision(entry.priorDecision) : undefined;
  if (Object.hasOwn(entry, 'priorDecision') && priorDecision === undefined) return undefined;
  return {
    criterion: typeof entry.criterion === 'string' ? entry.criterion.trim() : '',
    summary: typeof entry.summary === 'string' ? entry.summary.trim() : '',
    relation: entry.relation === 'outside-visible' ? entry.relation : undefined,
    authority: entry.decision === 'accept' || entry.decision === 'refuse' || entry.decision === 'pending'
      ? entry.decision
      : undefined,
    rationale: typeof entry.rationale === 'string' ? entry.rationale.trim() : undefined,
    offerEntryId: bounded(entry.offerEntryId, MAX_REFERENCE_LENGTH) ? entry.offerEntryId.trim() : undefined,
    originalCaseId: bounded(entry.originalCaseId, MAX_REFERENCE_LENGTH) ? entry.originalCaseId.trim() : undefined,
    originalSource: parseSource(entry.originalSource),
    priorDecision,
  };
}

/**
 * Read only the retired fenced JSON decision shape. It deliberately does not
 * compare current ordinals or summaries and returns unsupported rather than
 * treating a single-line or entries-shaped document as empty authority.
 */
export function parseLegacyPrdWideningClear(value: string): LegacyPrdWideningClearParse {
  const match = value.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
  if (!match) return { kind: 'absent', entries: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]!); } catch { return { kind: 'unsupported' }; }
  if (!Array.isArray(parsed)) return { kind: 'unsupported' };
  const entries: LegacyPrdWideningClear[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return { kind: 'unsupported' };
    const row = item as Record<string, unknown>;
    if (!bounded(row.criterion, MAX_REFERENCE_LENGTH) || !bounded(row.summary) ||
      (row.decision !== 'accept' && row.decision !== 'refuse') || !bounded(row.rationale)) return { kind: 'unsupported' };
    entries.push({ criterion: row.criterion.trim(), summary: row.summary.trim(), authority: row.decision, rationale: row.rationale.trim() });
  }
  return { kind: 'supported', entries };
}

function legacyClearReference(kind: 'case' | 'source' | 'entry', entry: LegacyPrdWideningClear): string {
  const digest = createHash('sha256')
    .update(entry.criterion)
    .update('\0')
    .update(entry.summary)
    .update('\0')
    .digest('hex');
  return `legacy-clear-${kind}-${digest}`;
}

function sameLegacyAuthority(
  decision: AcceptedWideningDecision,
  entry: LegacyPrdWideningClear,
  operator: string,
): boolean {
  return decision.authority === entry.authority && decision.rationale === entry.rationale &&
    decision.operator === operator && decision.originalCaseId === legacyClearReference('case', entry) &&
    decision.originalSource?.id === legacyClearReference('source', entry) &&
    decision.originalSource.snapshot === entry.summary;
}

async function materializeLegacySource(
  store: PrdWideningCaptureOfferStore,
  entry: LegacyPrdWideningClear,
): Promise<boolean> {
  const caseId = legacyClearReference('case', entry);
  const sourceId = legacyClearReference('source', entry);
  const result = await store.mutate(async (state) => {
    const cases = state.version === 'v2' ? state.prdWideningCases : [];
    const existing = cases.find((candidate) => candidate.id === caseId);
    if (existing) return { value: cases };
    return {
      value: [...cases, {
        id: caseId, domain: 'prd_widening' as const,
        originalSources: [{ sourceId, snapshot: entry.summary }],
        currentSources: [], relationships: [],
      }],
      nextState: {
        version: 'v2', feature: state.feature, cases: state.cases,
        suppressions: state.suppressions ?? [],
        prdWideningCases: [...cases, {
          id: caseId, domain: 'prd_widening' as const,
          originalSources: [{ sourceId, snapshot: entry.summary }],
          currentSources: [], relationships: [],
        }],
      },
    };
  });
  return result.ok && result.value.some((record) => record.id === caseId && record.originalSources.some((source) =>
    source.sourceId === sourceId && source.snapshot === entry.summary));
}

function hasLegacyDecisionFence(value: string): boolean {
  return /```(?:json\s+)?over-scope-decisions\s*\n[\s\S]*?\n```/i.test(value);
}

function matchesPersistedOffer(
  entry: ClearedDecisionEntry,
  cases: readonly RemediationCasePrdWideningRecord[],
): boolean {
  if (!entry.offerEntryId || !entry.originalCaseId || !entry.originalSource ||
    entry.offerEntryId !== entry.originalCaseId) return false;
  const offer = cases.find((candidate) => candidate.id === entry.offerEntryId);
  return offer !== undefined && offer.offeredCriterion === entry.criterion &&
    entry.summary === entry.originalSource.snapshot && entry.relation === 'outside-visible' &&
    offer.originalSources.some((source) =>
      source.sourceId === entry.originalSource!.id && source.snapshot === entry.originalSource!.snapshot &&
      source.snapshot === entry.summary);
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
  if (!match) {
    return hasLegacyDecisionFence(clearedBlock)
      ? { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] }
      : { kind: 'absent', captured: [], defects: [] };
  }
  let rawEntries: unknown;
  try {
    rawEntries = JSON.parse(match[1]!);
  } catch {
    return { kind: 'captured', captured: [], defects: [{ kind: 'malformed-block' }] };
  }
  if (!Array.isArray(rawEntries)) return { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] };

  const legacy = parseLegacyPrdWideningClear(clearedBlock);
  const containsModernOffer = rawEntries.some((entry) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) && Object.hasOwn(entry, 'offerEntryId'));
  if (legacy.kind === 'unsupported' && !containsModernOffer) {
    return { kind: 'captured', captured: [], defects: [{ kind: 'unsupported-legacy-clear' }] };
  }
  if (legacy.kind === 'supported' && rawEntries.every((entry) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) && !Object.hasOwn(entry, 'offerEntryId'))) {
    const captured: AcceptedWideningDecision[] = [];
    const defects: PrdWideningCaptureDefect[] = [];
    for (const entry of legacy.entries) {
      if (!bounded(options.operator, MAX_REFERENCE_LENGTH)) {
        defects.push({ kind: 'missing-operator' });
        continue;
      }
      // D3: source/case state is durable before a legacy decision can refer
      // to it. Replays verify the same deterministic materialization.
      if (!await materializeLegacySource(options.offerStore, entry)) {
        defects.push({ kind: 'write-failed' });
        continue;
      }
      const input: AcceptedWideningDecisionInput = {
        criterion: entry.criterion,
        authority: entry.authority,
        rationale: entry.rationale,
        operator: options.operator.trim(),
        // This deterministic legacy-clear provenance is deliberately distinct
        // from migrated v1-row provenance.
        originalSource: { id: legacyClearReference('source', entry), snapshot: entry.summary },
        originalCaseId: legacyClearReference('case', entry),
        offerEntryId: legacyClearReference('entry', entry),
      };
      const existing = options.decisionStore.read === undefined ? undefined : await options.decisionStore.read();
      const originalSource = input.originalSource;
      const prior = existing?.kind === 'valid'
        ? existing.state.decisions.filter((decision) => decision.originalCaseId === input.originalCaseId &&
          decision.originalSource?.id === originalSource.id && decision.originalSource?.snapshot === originalSource.snapshot).at(-1)
        : undefined;
      if (prior && sameLegacyAuthority(prior, entry, input.operator)) {
        captured.push(prior);
        continue;
      }
      const appended = await options.decisionStore.append({
        ...input,
        ...(prior === undefined ? {} : { supersedes: { id: prior.id, revision: prior.revision } }),
      });
      if (!appended.ok) {
        defects.push({ kind: 'write-failed' });
        continue;
      }
      captured.push(appended.decision);
    }
    return { kind: 'captured', captured, defects };
  }

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
      ...(entry.priorDecision === undefined ? {} : { supersedes: entry.priorDecision }),
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
