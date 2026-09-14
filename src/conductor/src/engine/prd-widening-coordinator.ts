import { createHash, randomUUID } from 'node:crypto';

import { projectPrdWideningSemanticSnapshot, type PrdWideningContext } from './prd-widening-context.js';
import type { AcceptedWideningDecisionReadResult } from './accepted-widenings.js';
import {
  validatePrdWideningReconciliation,
  type PrdWideningReconciliationResult,
} from './prd-widening-contract.js';
import type {
  RemediationCasePrdWideningRecord,
  RemediationCaseStoreMutation,
  RemediationCaseStoreMutationResult,
  RemediationCaseStoreState,
} from './remediation-case-store.js';

export interface PrdWideningCoordinatorStore {
  mutate(operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<PrdWideningCoordinatorResult>>): Promise<RemediationCaseStoreMutationResult<PrdWideningCoordinatorResult>>;
}

type PrdWideningReadStore = {
  mutate<Value>(operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<Value>>): Promise<RemediationCaseStoreMutationResult<Value>>;
};

export type PrdWideningCoordinatorResult =
  | { readonly kind: 'published'; readonly result: PrdWideningReconciliationResult; readonly reused: boolean }
  | {
      readonly kind: 'failed';
      readonly reason: 'invalid-result' | 'stale-context' | 'store-failed' | 'timeout' | 'unavailable' | 'attempts-exhausted';
      /** The final consumed mechanical failure, when an allowance was exhausted. */
      readonly lastMechanicalFailure?: 'timeout' | 'unavailable' | 'invalid';
    };

/**
 * The authority snapshot sampled on each side of the provider boundary.
 * It is deliberately structural: report rendering can exclude engine-owned
 * projections at its producer, while reviewer source and operator authority
 * remain part of the digest.
 */
export interface PrdWideningFreshness {
  readonly reportDigest: string;
  readonly sourceDigest: string;
  readonly codeDigest: string;
  readonly feature: string;
  readonly decisionRevision: number;
  readonly contractVersion: string;
}

export interface PrdWideningMechanicalFailure {
  /** Classify a terminal provider failure without charging BUILD/growth. */
  readonly classify: (error: unknown) => 'timeout' | 'unavailable' | 'invalid';
  /** The configured remediate allowance remaining before this dispatch. */
  readonly remainingAttempts: number;
}

/** The second member of the case-then-decision publication read. */
export interface PrdWideningCoordinatorDecisionStore {
  read(): Promise<AcceptedWideningDecisionReadResult>;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

type PrdWideningJudge = (context: PrdWideningContext) => Promise<unknown>;

function currentCases(state: RemediationCaseStoreState): readonly RemediationCasePrdWideningRecord[] {
  return state.version === 'v2' ? state.prdWideningCases : [];
}

function hasCurrentSnapshot(state: RemediationCaseStoreState, context: PrdWideningContext): boolean {
  return projectPrdWideningSemanticSnapshot({
    version: context.version,
    currentSources: context.currentSources,
    cases: currentCases(state),
    decisions: context.decisions,
    scope: context.semanticScope,
  }).digest === context.digest;
}

function sameFreshness(left: PrdWideningFreshness, right: PrdWideningFreshness): boolean {
  return left.reportDigest === right.reportDigest &&
    left.sourceDigest === right.sourceDigest &&
    left.codeDigest === right.codeDigest &&
    left.feature === right.feature &&
    left.decisionRevision === right.decisionRevision &&
    left.contractVersion === right.contractVersion;
}

function replayIdentity(
  context: PrdWideningContext,
  freshness: PrdWideningFreshness | undefined,
  sampledDecisionRevision: number | undefined,
): string | undefined {
  return freshness === undefined ? undefined : digest({
    currentSources: context.currentSources,
    freshness,
    sampledDecisionRevision,
  });
}

function decisionRevision(read: AcceptedWideningDecisionReadResult): number | undefined {
  if (read.kind === 'absent') return 0;
  if (read.kind !== 'valid') return undefined;
  return read.state.decisions.at(-1)?.revision ?? 0;
}

/**
 * A stored relationship is reusable only when it contains the exact current
 * source snapshot in the complete context that was validated after publication.
 * A matching NC key or an old source link alone deliberately cannot suppress a
 * new semantic judgment.
 */
function replayedResult(
  cases: readonly RemediationCasePrdWideningRecord[],
  context: PrdWideningContext,
  expectedReplayIdentity: string | undefined,
): PrdWideningReconciliationResult | undefined {
  const results = context.currentSources.map((source) => {
    const record = cases.find((candidate) => candidate.currentSources.some((current) =>
      current.sourceId === source.id && current.snapshot === source.evidence,
    ));
    const relationship = record !== undefined && record.reconciliationDigest === expectedReplayIdentity
      ? record.relationships.find((candidate) => candidate.currentSourceId === source.id)
      : undefined;
    if (!relationship) return undefined;
    if (relationship.kind === 'same-case') {
      return { sourceId: source.id, kind: 'same-case' as const, caseId: relationship.caseId, reason: relationship.reason };
    }
    if (relationship.kind === 'different') {
      return { sourceId: source.id, kind: 'different' as const, reason: relationship.reason };
    }
    return {
      sourceId: source.id,
      kind: 'uncertain' as const,
      candidateCaseIds: relationship.candidateCaseIds,
      reason: relationship.reason,
    };
  });
  return results.some((result) => result === undefined)
    ? undefined
    : { version: 'v1', results: results as PrdWideningReconciliationResult['results'] };
}

/**
 * Publish only a result whose source/case snapshot is still current under the
 * store mutation. A provider call is intentionally outside this lease: callers
 * pass its terminal value here only after the judge has returned.
 */
export async function coordinatePrdWidening(input: {
  readonly store: PrdWideningCoordinatorStore;
  readonly context: PrdWideningContext;
  /** Existing callers may supply a completed terminal result. */
  readonly rawResult?: unknown;
  /** New reconciliation calls inject their typed external judgment boundary. */
  readonly judge?: PrdWideningJudge;
  readonly now: string;
  /** Engine-sampled code/diff identity from immediately before judging. */
  readonly codeDigest?: string;
  /** Re-read under the publication lease; prevents stale code authority. */
  readonly readCodeDigest?: () => Promise<string>;
  /**
   * Samples report/source/code/feature/decision/contract identity before the
   * provider call and again from the publication transition.  The latter runs
   * inside the case-store mutation; concrete routing supplies its
   * case-then-decision lease acquisition around that sampler.
   */
  readonly freshness?: { readonly sample: () => Promise<PrdWideningFreshness> };
  /**
   * When supplied, this is read after acquiring the case-store mutation
   * lease. It therefore preserves the case-then-decision order at the one
   * publication transition without keeping either lease around the judge.
   */
  readonly decisionStore?: PrdWideningCoordinatorDecisionStore;
  /** Bounded mechanical provider-failure classification, never a BUILD charge. */
  readonly mechanicalFailure?: PrdWideningMechanicalFailure;
  readonly createId?: () => string;
}): Promise<PrdWideningCoordinatorResult> {
  const sampledFreshness = input.freshness === undefined
    ? undefined
    : await input.freshness.sample();
  const sampledDecision = input.decisionStore === undefined
    ? undefined
    : await input.decisionStore.read();
  const sampledDecisionRevision = sampledDecision === undefined
    ? undefined
    : decisionRevision(sampledDecision);
  if (sampledDecision !== undefined && sampledDecisionRevision === undefined) {
    return { kind: 'failed', reason: 'store-failed' };
  }
  const expectedReplayIdentity = replayIdentity(input.context, sampledFreshness, sampledDecisionRevision);
  // Reuse runs in a short read-only mutation before the judge. This retains
  // the store's single transition seam while ensuring no provider call occurs
  // under its lease.
  // The coordinator's public store seam is intentionally narrowed to its
  // publication result. The replay read has a different value shape but uses
  // the same generic store transition without changing that test-facing seam.
  const readStore = input.store as unknown as PrdWideningReadStore;
  const replay = await readStore.mutate(async (state) => {
    // Recheck authority while the case-store lease is held before reusing a
    // relation. This keeps the case-then-decision order and makes a concurrent
    // decision append invalidate replay instead of returning stale authority.
    if (sampledDecision !== undefined) {
      const currentDecisionRevision = decisionRevision(await input.decisionStore!.read());
      if (currentDecisionRevision === undefined || currentDecisionRevision !== sampledDecisionRevision) return { value: undefined };
    }
    return {
      value: hasCurrentSnapshot(state, input.context)
        ? replayedResult(currentCases(state), input.context, expectedReplayIdentity)
        : undefined,
    };
  });
  if (!replay.ok) return { kind: 'failed', reason: 'store-failed' };
  if (replay.value !== undefined) {
    return { kind: 'published', result: replay.value, reused: true };
  }

  let rawResult = input.rawResult;
  if (rawResult === undefined && input.judge !== undefined) {
    if (input.mechanicalFailure !== undefined && input.mechanicalFailure.remainingAttempts <= 0) {
      return { kind: 'failed', reason: 'attempts-exhausted' };
    }
    const attempts = input.mechanicalFailure?.remainingAttempts ?? 1;
    let lastMechanicalFailure: 'timeout' | 'unavailable' | 'invalid' | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const candidate = await input.judge(input.context);
        const candidateValidation = validatePrdWideningReconciliation(
          candidate,
          input.context.currentSources,
          input.context.cases,
        );
        if (candidateValidation.ok) {
          rawResult = candidate;
          break;
        }
        lastMechanicalFailure = 'invalid';
      } catch (error) {
        if (input.mechanicalFailure === undefined) return { kind: 'failed', reason: 'invalid-result' };
        lastMechanicalFailure = input.mechanicalFailure.classify(error);
      }
    }
    if (rawResult === undefined) {
      if (input.mechanicalFailure === undefined) return { kind: 'failed', reason: 'invalid-result' };
      // The named terminal result is deliberately withheld until every
      // configured remediate attempt has been consumed.
      return { kind: 'failed', reason: 'attempts-exhausted', lastMechanicalFailure };
    }
  }
  const validated = validatePrdWideningReconciliation(
    rawResult,
    input.context.currentSources,
    input.context.cases,
  );
  if (!validated.ok) return { kind: 'failed', reason: 'invalid-result' };
  const mutation = await input.store.mutate(async (state) => {
    // This callback owns the case-store transition. The decision read below
    // is intentionally nested after it, preserving the case-then-decision
    // order. The provider was awaited above, before either lease is held.
    if (sampledFreshness !== undefined &&
      !sameFreshness(sampledFreshness, await input.freshness!.sample())) {
      return { value: { kind: 'failed', reason: 'stale-context' } };
    }
    if (sampledDecision !== undefined) {
      const currentDecision = await input.decisionStore!.read();
      if (decisionRevision(currentDecision) === undefined) {
        return { value: { kind: 'failed', reason: 'store-failed' } };
      }
      if (decisionRevision(currentDecision) !== decisionRevision(sampledDecision)) {
        return { value: { kind: 'failed', reason: 'stale-context' } };
      }
    }
    if (input.codeDigest !== undefined && input.readCodeDigest !== undefined &&
      await input.readCodeDigest() !== input.codeDigest) {
      return { value: { kind: 'failed', reason: 'stale-context' } };
    }
    const cases = currentCases(state);
    if (!hasCurrentSnapshot(state, input.context)) return { value: { kind: 'failed', reason: 'stale-context' } };
    // A replay was returned above only for the complete frozen identity. A
    // fresh judgment must replace any old relation for its source, even when
    // the source text itself is unchanged (D8).
    const additions: RemediationCasePrdWideningRecord[] = [];
    const replacements = new Map<string, RemediationCasePrdWideningRecord>();
    for (const outcome of validated.value.results) {
      const source = input.context.currentSources.find((item) => item.id === outcome.sourceId)!;
      const targetId = outcome.kind === 'same-case' ? outcome.caseId : `prd-widening-${(input.createId ?? randomUUID)()}`;
      // Source ownership is global within this domain. If a changed frozen
      // input now judges the same occurrence differently, detach its prior
      // current link before attaching the fresh relation elsewhere.
      for (const record of cases) {
        const candidate = replacements.get(record.id) ?? record;
        if (candidate.id === targetId || !candidate.currentSources.some((current) => current.sourceId === source.id)) continue;
        replacements.set(candidate.id, {
          ...candidate,
          currentSources: candidate.currentSources.filter((current) => current.sourceId !== source.id),
          relationships: candidate.relationships.filter((relationship) => relationship.currentSourceId !== source.id),
        });
      }
      const existing = replacements.get(targetId) ?? cases.find((item) => item.id === targetId) ?? additions.find((item) => item.id === targetId);
      const relationship = outcome.kind === 'same-case'
        ? { currentSourceId: outcome.sourceId, kind: 'same-case' as const, caseId: outcome.caseId, reason: outcome.reason }
        : outcome.kind === 'different'
          ? { currentSourceId: outcome.sourceId, kind: 'different' as const, reason: outcome.reason }
          : { currentSourceId: outcome.sourceId, kind: 'uncertain' as const, candidateCaseIds: outcome.candidateCaseIds, reason: outcome.reason };
      // A different or uncertain judgement creates a new case.  Its current
      // source is also the immutable original evidence for that case: leaving
      // it empty makes the shared v2 store correctly reject the publication.
      const next = existing
        ? {
            ...existing,
            ...(expectedReplayIdentity === undefined ? {} : { reconciliationDigest: expectedReplayIdentity }),
            currentSources: [
              ...existing.currentSources.filter((current) => current.sourceId !== source.id),
              { sourceId: source.id, snapshot: source.evidence, recordedAt: input.now },
            ],
            relationships: [
              ...existing.relationships.filter((current) => current.currentSourceId !== source.id),
              relationship,
            ],
          }
        : {
            id: targetId,
            domain: 'prd_widening' as const,
            ...(outcome.kind === 'same-case' ? {} : { offeredCriterion: source.criterion.trim() }),
            originalSources: outcome.kind === 'same-case' ? [] : [{ sourceId: source.id, snapshot: source.evidence }],
            currentSources: [{ sourceId: source.id, snapshot: source.evidence, recordedAt: input.now }],
            relationships: [relationship],
            ...(expectedReplayIdentity === undefined ? {} : { reconciliationDigest: expectedReplayIdentity }),
          };
      if (existing) {
        const index = additions.findIndex((item) => item.id === existing.id);
        if (index >= 0) additions[index] = next; else replacements.set(existing.id, next);
      } else additions.push(next);
    }
    // Every relation participating in a successful multi-source judgment is
    // stamped with one complete identity. Otherwise an unchanged sibling can
    // force a needless provider replay after restart (D7).
    for (const source of input.context.currentSources) {
      const owner = additions.find((item) => item.currentSources.some((current) => current.sourceId === source.id)) ??
        [...replacements.values()].find((item) => item.currentSources.some((current) => current.sourceId === source.id)) ??
        cases.find((item) => item.currentSources.some((current) => current.sourceId === source.id));
      if (!owner || owner.reconciliationDigest === expectedReplayIdentity) continue;
      const next = { ...owner, ...(expectedReplayIdentity === undefined ? {} : { reconciliationDigest: expectedReplayIdentity }) };
      const additionIndex = additions.findIndex((item) => item.id === owner.id);
      if (additionIndex >= 0) additions[additionIndex] = next; else replacements.set(owner.id, next);
    }
    return additions.length === 0 && replacements.size === 0
      ? { value: { kind: 'published', result: validated.value, reused: true } }
      : { value: { kind: 'published', result: validated.value, reused: false }, nextState: { version: 'v2', feature: state.feature, cases: state.cases, suppressions: state.suppressions ?? [], prdWideningCases: [...cases.map((item) => replacements.get(item.id) ?? item), ...additions] } };
  });
  return mutation.ok ? mutation.value : { kind: 'failed', reason: 'store-failed' };
}
