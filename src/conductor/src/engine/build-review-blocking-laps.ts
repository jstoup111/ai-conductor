import { join } from 'node:path';

import {
  projectBuildReviewAggregateSources,
  type BuildReviewAggregate,
  type BuildReviewBlockingLapLimit,
  type BuildReviewEffectiveVerdict,
} from './build-review-aggregate.js';
import type { ChildId } from './child-context.js';
import { createEngineStateStore } from './engine-state-store.js';
import type { ResolvedBuildReviewConfig } from './resolved-config.js';

/**
 * Per-rubric blocking-lap budget for build_review
 * (adr-2026-10-19-build-review-finding-severity-advisory-threshold D8, D9).
 *
 * `.pipeline/engine-state.json` holds `buildReviewBlockingLaps[scope][rubric]`:
 * the lap ids in which that rubric left at least one unresolved finding. It is
 * an engine-owned budget read by name (event-spine exception C); the demotion
 * it causes is reported on `build_review_outer_verdict`.
 */
const STATE_KEY = 'buildReviewBlockingLaps';

/** Lap ids a rubric blocked, keyed by rubric id. */
export type BuildReviewBlockingLaps = Readonly<Record<string, readonly string[]>>;

function engineStatePath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', 'engine-state.json');
}

/** A stacked child's laps never count toward its siblings or the feature. */
function scopeKey(child: ChildId | undefined): string {
  return child === undefined ? 'feature' : `child-${child}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Positive per-rubric limits; a rubric without an entry is unlimited. */
export function buildReviewBlockingLapLimits(
  config: Pick<ResolvedBuildReviewConfig, 'catalog' | 'rubrics'>,
): Partial<Record<string, number>> {
  const policies = [
    ...Object.entries(config.rubrics).map(([id, policy]) => [id, policy.max_blocking_laps] as const),
    ...config.catalog
      .filter((entry) => entry.kind === 'custom')
      .map((entry) => [entry.id, entry.policy.max_blocking_laps] as const),
  ];
  return Object.fromEntries(policies.flatMap(([id, limit]) => (limit === undefined ? [] : [[id, limit]])));
}

function parseScope(value: unknown): BuildReviewBlockingLaps {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([rubric, laps]) => {
      const lapIds = Array.isArray(laps) ? laps.filter((lap): lap is string => typeof lap === 'string') : [];
      return lapIds.length === 0 ? [] : [[rubric, lapIds]];
    }),
  );
}

/**
 * Reads one scope's blocking laps. Absent or unreadable state counts as no
 * laps, so a rubric keeps blocking rather than being demoted on bad evidence.
 */
export async function readBuildReviewBlockingLaps(
  projectRoot: string,
  child: ChildId | undefined,
): Promise<BuildReviewBlockingLaps> {
  const read = await createEngineStateStore(engineStatePath(projectRoot)).read();
  if (!read.ok) return {};
  const scopes = read.value[STATE_KEY];
  return isRecord(scopes) ? parseScope(scopes[scopeKey(child)]) : {};
}

/**
 * Rubrics that already blocked their limit of laps other than `lapId`. The
 * current lap is excluded so re-evaluating one lap never limits itself.
 */
export function lapLimitedBuildReviewRubrics(input: {
  readonly limits: Partial<Record<string, number>>;
  readonly laps: BuildReviewBlockingLaps;
  readonly lapId: string;
}): BuildReviewBlockingLapLimit[] {
  return Object.entries(input.limits)
    .flatMap(([rubric, limit]) => {
      if (limit === undefined) return [];
      const blockingLaps = new Set((input.laps[rubric] ?? []).filter((lap) => lap !== input.lapId)).size;
      return blockingLaps >= limit ? [{ rubric, blockingLaps, limit }] : [];
    })
    .sort((left, right) => left.rubric.localeCompare(right.rubric));
}

/** Rubrics owning at least one unresolved finding in this lap's effective verdict. */
export function blockingBuildReviewRubrics(
  aggregate: BuildReviewAggregate,
  effective: Pick<BuildReviewEffectiveVerdict, 'unresolvedFindingIds'>,
): string[] {
  const unresolved = new Set(effective.unresolvedFindingIds);
  const rubrics = (projectBuildReviewAggregateSources(aggregate) ?? [])
    .filter((source) => unresolved.has(source.findingId))
    .map((source) => source.rubric);
  return [...new Set(rubrics)].sort();
}

/** Adds `lapId` once under each rubric; every other engine-state key is preserved. */
export async function recordBuildReviewBlockingLaps(
  projectRoot: string,
  child: ChildId | undefined,
  lapId: string,
  rubrics: readonly string[],
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  if (rubrics.length === 0) return { ok: true };
  const scope = scopeKey(child);
  const result = await createEngineStateStore(engineStatePath(projectRoot)).update((current) => {
    const scopes = isRecord(current[STATE_KEY]) ? current[STATE_KEY] : {};
    const laps: Record<string, readonly string[]> = { ...parseScope(scopes[scope]) };
    for (const rubric of rubrics) {
      const recorded = laps[rubric] ?? [];
      if (!recorded.includes(lapId)) laps[rubric] = [...recorded, lapId];
    }
    return { ...current, [STATE_KEY]: { ...scopes, [scope]: laps } };
  });
  return result.ok ? { ok: true } : { ok: false, reason: `${result.kind}: ${result.message}` };
}
