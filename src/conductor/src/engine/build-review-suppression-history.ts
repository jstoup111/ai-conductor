import { projectBuildReviewAggregateSources, type BuildReviewAggregate } from './build-review-aggregate.js';
import {
  RemediationCaseStore,
  type RemediationCaseFeatureIdentity,
  type RemediationCaseStoreFailureReason,
  type RemediationCaseSuppressionEntry,
} from './remediation-case-store.js';

export interface BuildReviewCustomSuppressionSource {
  readonly rubric: string;
  readonly findingId: string;
  readonly summary: string;
  readonly confidence?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Reads the current custom findings from their self-describing evidence. The
 * identity has to agree with the current result's complete policy-bearing
 * envelope; a matching rubric name or summary is deliberately insufficient.
 */
export function projectBuildReviewCustomSuppressionSources(
  aggregate: BuildReviewAggregate,
): readonly BuildReviewCustomSuppressionSource[] | undefined {
  const sources: BuildReviewCustomSuppressionSource[] = [];
  for (const rubric of aggregate.currentCustomRubrics ?? []) {
    const result = aggregate.customResults?.[rubric]?.result;
    if (!result || result.kind !== 'judged') return undefined;
    for (const value of result.findings) {
      const finding = record(value);
      const identity = record(finding?.identity);
      const payload = record(identity?.canonicalPayload);
      if (!finding || !identity || !payload || typeof finding.summary !== 'string' || finding.summary.length === 0 ||
        typeof identity.id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(identity.id) ||
        payload.rubric !== rubric || JSON.stringify(payload.declaration) !== JSON.stringify(result.declaration) ||
        JSON.stringify(payload.policy) !== JSON.stringify(result.policy) ||
        JSON.stringify(payload.candidate) !== JSON.stringify(result.candidate) ||
        JSON.stringify(payload.reviewedInput) !== JSON.stringify(result.reviewedInput) ||
        typeof payload.concernId !== 'string' || payload.concernId.length === 0 ||
        (finding.confidence !== undefined && !validConfidence(finding.confidence))) return undefined;
      sources.push({
        rubric,
        findingId: identity.id,
        summary: finding.summary,
        ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
      });
    }
  }
  return Object.freeze(sources);
}

/**
 * The one projection of a lap's sub-floor findings into durable suppression
 * entries (adr-2026-08-29 D4.6).  A finding without a reported confidence was
 * never suppressible (D4.2), so it can never produce an entry here.
 */
export function projectBuildReviewSuppressionEntries(input: {
  readonly aggregate: BuildReviewAggregate;
  readonly suppressedFindingIds: readonly string[];
  readonly floors: Partial<Record<string, number>>;
}): readonly RemediationCaseSuppressionEntry[] {
  if (input.suppressedFindingIds.length === 0) return [];
  const suppressed = new Set(input.suppressedFindingIds);
  const sources = [
    ...(projectBuildReviewAggregateSources(input.aggregate) ?? []),
    ...(projectBuildReviewCustomSuppressionSources(input.aggregate) ?? []),
  ];
  return sources.flatMap((source) => {
    if (!suppressed.has(source.findingId) || source.confidence === undefined) return [];
    const floor = input.floors[source.rubric];
    if (floor === undefined) return [];
    return [{
      findingId: source.findingId,
      rubric: source.rubric,
      summary: source.summary,
      confidence: source.confidence,
      floor,
      lastSeenLap: input.aggregate.lapId as string,
    }];
  });
}

/**
 * The SINGLE writer of durable suppression history.
 *
 * adr-2026-08-29 D4.6 requires every suppressed finding to be retained in the
 * feature-scoped case store, but D4.4 keeps a fully suppressed lap out of
 * post-join judgement entirely — so a lap that suppresses everything is an
 * effective PASS that never reaches the adjudication coordinator.  Making the
 * coordinator the only writer therefore lost exactly the laps the decision is
 * about.  This seam is invoked from the effective-verdict resolution path,
 * BEFORE the pass/fail fork, and the coordinator reuses it rather than keeping
 * a second, divergent write of the same rows.
 *
 * The write is an idempotent upsert keyed by finding id: a recurrence refreshes
 * the existing entry in place (its `lastSeenLap` moves forward), no duplicate
 * row is ever created, and an entry whose finding stopped recurring is never
 * pruned.  Running the seam and then the coordinator over the same lap is
 * therefore indistinguishable from running either one alone.
 */
export async function persistBuildReviewSuppressions(input: {
  readonly projectRoot: string;
  readonly feature: RemediationCaseFeatureIdentity;
  readonly suppressions: readonly RemediationCaseSuppressionEntry[];
  /** Injected only by callers that already hold the store for this feature. */
  readonly store?: RemediationCaseStore;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: RemediationCaseStoreFailureReason }> {
  if (input.suppressions.length === 0) return { ok: true };
  const store = input.store ?? new RemediationCaseStore(input.projectRoot, input.feature);
  const persisted = await store.mutate(async (state) => {
    const byFindingId = new Map((state.suppressions ?? []).map((entry) => [entry.findingId, entry]));
    for (const entry of input.suppressions) byFindingId.set(entry.findingId, entry);
    return { value: undefined, nextState: { ...state, suppressions: [...byFindingId.values()] } };
  });
  return persisted.ok ? { ok: true } : { ok: false, reason: persisted.reason };
}
