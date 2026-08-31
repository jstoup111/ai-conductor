/**
 * Per-feature cost rollup: aggregates token usage, dispatch/retry/halt
 * counts, and unmetered-dispatch tracking from a worktree's
 * `.pipeline/events.jsonl`.
 *
 * Pure/read-only — no side effects, no writes. Tolerates a missing or
 * unreadable file (marks the rollup unmetered) and corrupt/unparseable lines
 * (skipped, folded into `unmetered.count` so the gap stays visible).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureUsageTotals } from '../execution/provider-diagnostics.js';
import type { TokenUsage } from '../execution/llm-provider.js';
import type { ConductorEvent } from '../types/events.js';
import { classifyMetering } from './metering.js';
import {
  DispatchMeteringTracker,
  type DispatchMeteringObservation,
} from './dispatch-metering.js';

export interface CostRollup {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  costUsd: number;
  byDimension?: Array<{
    step: string;
    model?: string;
    source?: 'provider' | 'rate-card';
    costUsd: number;
  }>;
  tokensByDimension?: Array<{
    step: string;
    model?: string;
    tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
  }>;
  dispatches: number;
  retries: number;
  halts: number;
  readErrors?: number;
  unmetered: { count: number; durationMs: number };
  costUnmetered?: { count: number };
  providers?: Record<string, ProviderCostRollup>;
}

export interface ProviderCostRollup {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  costUsd: number;
  dispatches: number;
  unmetered: { count: number; durationMs: number };
  costUnmetered?: { count: number };
}

function zeroUsageRollup(): ProviderCostRollup {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    costUsd: 0,
    dispatches: 0,
    unmetered: { count: 0, durationMs: 0 },
    costUnmetered: { count: 0 },
  };
}

function zeroRollup(): CostRollup {
  return {
    ...zeroUsageRollup(),
    byDimension: [],
    tokensByDimension: [],
    retries: 0,
    halts: 0,
    readErrors: 0,
  };
}

function dimensionKey(...dimensions: Array<string | undefined>): string {
  return JSON.stringify(dimensions);
}

function addDimensionRollup(
  rollup: CostRollup,
  buckets: Map<string, NonNullable<CostRollup['byDimension']>[number]>,
  event: DispatchMeteringObservation,
): void {
  const tokenUsage = event.tokenUsage;
  if (!tokenUsage || classifyMetering(tokenUsage) !== 'fully-metered') return;

  const step = event.step ?? 'unknown';
  const source = tokenUsage.costSource;
  const key = dimensionKey(step, event.model, source);
  const bucket = buckets.get(key) ?? {
    step,
    ...(event.model === undefined ? {} : { model: event.model }),
    ...(source === undefined ? {} : { source }),
    costUsd: 0,
  };
  bucket.costUsd += tokenUsage.costUsd!;
  if (!buckets.has(key)) {
    buckets.set(key, bucket);
    rollup.byDimension!.push(bucket);
  }
}

function addTokenDimensionRollup(
  rollup: CostRollup,
  buckets: Map<string, NonNullable<CostRollup['tokensByDimension']>[number]>,
  event: DispatchMeteringObservation,
): void {
  const tokenUsage = event.tokenUsage;
  if (!tokenUsage) return;

  const finiteTokens = (['input', 'output', 'cacheRead', 'cacheCreation'] as const)
    .filter((kind) => Number.isFinite(tokenUsage[kind]));
  if (finiteTokens.length === 0) return;

  const step = event.step ?? 'unknown';
  const key = dimensionKey(step, event.model);
  const bucket = buckets.get(key) ?? {
    step,
    ...(event.model === undefined ? {} : { model: event.model }),
    tokens: {},
  };
  for (const kind of finiteTokens) {
    bucket.tokens[kind] = (bucket.tokens[kind] ?? 0) + tokenUsage[kind]!;
  }
  if (!buckets.has(key)) {
    buckets.set(key, bucket);
    rollup.tokensByDimension!.push(bucket);
  }
}

function addDispatch(
  target: ProviderCostRollup,
  event: DispatchMeteringObservation,
): void {
  target.dispatches += 1;
  const tokenUsage = event.tokenUsage as TokenUsage | undefined;
  const metering = classifyMetering(tokenUsage);
  if (tokenUsage) {
    target.tokens.input += Number(tokenUsage.input) || 0;
    target.tokens.output += Number(tokenUsage.output) || 0;
    target.tokens.cacheRead += Number(tokenUsage.cacheRead) || 0;
    target.tokens.cacheCreation += Number(tokenUsage.cacheCreation) || 0;
    if (metering === 'fully-metered') target.costUsd += tokenUsage.costUsd!;
  }
  if (metering === 'cost-unmetered') {
    (target.costUnmetered ??= { count: 0 }).count += 1;
  }
  if (event.unmetered === true || metering === 'unmetered') {
    target.unmetered.count += 1;
    target.unmetered.durationMs += Number(tokenUsage?.durationMs) || 0;
  }
}

/**
 * Project a rollup onto the flat shape the whole-feature usage log line needs.
 *
 * `unmetered.count` also absorbs records the rollup could not read at all
 * (corrupt lines, a missing event log), so it can exceed `dispatches`; the
 * metered count is clamped at zero rather than going negative. Those
 * unreadable records stay visible as "unmetered" instead of silently
 * inflating a build's apparent measured cost.
 */
export function toFeatureUsageTotals(rollup: CostRollup): FeatureUsageTotals {
  return {
    dispatches: rollup.dispatches,
    meteredDispatches: Math.max(0, rollup.dispatches - rollup.unmetered.count),
    unmeteredDispatches: rollup.unmetered.count,
    costUsd: rollup.costUsd,
    inputTokens: rollup.tokens.input,
    outputTokens: rollup.tokens.output,
    cachedInputTokens: rollup.tokens.cacheRead + rollup.tokens.cacheCreation,
    costUnmeteredDispatches: rollup.costUnmetered?.count ?? 0,
  };
}

/** Project cumulative ledger costs into the non-persisted OTel snapshot event. */
export function toFeatureCostSnapshot(
  rollup: CostRollup,
): Extract<ConductorEvent, { type: 'feature_cost_snapshot' }> {
  return {
    type: 'feature_cost_snapshot',
    costUsd: rollup.costUsd,
    costComplete: rollup.unmetered.count === 0 && (rollup.costUnmetered?.count ?? 0) === 0,
    byDimension: rollup.byDimension ?? [],
    tokensByDimension: rollup.tokensByDimension ?? [],
  };
}

export async function computeCostRollup(worktreeDir: string): Promise<CostRollup> {
  const rollup = zeroRollup();
  const providers: Record<string, ProviderCostRollup> = Object.create(null);
  const dimensions = new Map<string, NonNullable<CostRollup['byDimension']>[number]>();
  const tokenDimensions = new Map<string, NonNullable<CostRollup['tokensByDimension']>[number]>();
  const eventsPath = join(worktreeDir, '.pipeline', 'events.jsonl');

  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf-8');
  } catch {
    rollup.unmetered.count += 1;
    rollup.readErrors = (rollup.readErrors ?? 0) + 1;
    return rollup;
  }

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const events: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      rollup.unmetered.count += 1;
      rollup.readErrors = (rollup.readErrors ?? 0) + 1;
      continue;
    }

    if (typeof event !== 'object' || event === null || !('type' in event)) {
      rollup.unmetered.count += 1;
      rollup.readErrors = (rollup.readErrors ?? 0) + 1;
      continue;
    }

    const e = event as Record<string, unknown>;
    events.push(e);
  }

  const dispatchMetering = new DispatchMeteringTracker();
  for (const e of events) {
    if (e.type === 'provider_attempt' || e.type === 'step_completed') {
      const dispatch = dispatchMetering.observe(e);
      if (dispatch) {
        addDispatch(rollup, dispatch);
        addDimensionRollup(rollup, dimensions, dispatch);
        addTokenDimensionRollup(rollup, tokenDimensions, dispatch);
        if (dispatch.provider) {
          const providerRollup = providers[dispatch.provider] ??= zeroUsageRollup();
          addDispatch(providerRollup, dispatch);
        }
      }
      continue;
    }

    if (e.type === 'step_retry') {
      rollup.retries += 1;
      continue;
    }

    if (e.type === 'loop_halt') {
      rollup.halts += 1;
      continue;
    }
  }

  if (Object.keys(providers).length > 0) {
    rollup.providers = providers;
  }
  return rollup;
}
