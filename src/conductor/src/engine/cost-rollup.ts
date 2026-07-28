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
import { classifyMetering } from './metering.js';

export interface CostRollup {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  costUsd: number;
  dispatches: number;
  retries: number;
  halts: number;
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
  return { ...zeroUsageRollup(), retries: 0, halts: 0 };
}

function addDispatch(
  target: ProviderCostRollup,
  event: Record<string, unknown>,
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
  };
}

export async function computeCostRollup(worktreeDir: string): Promise<CostRollup> {
  const rollup = zeroRollup();
  const providers: Record<string, ProviderCostRollup> = Object.create(null);
  const eventsPath = join(worktreeDir, '.pipeline', 'events.jsonl');

  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf-8');
  } catch {
    rollup.unmetered.count += 1;
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
      continue;
    }

    if (typeof event !== 'object' || event === null || !('type' in event)) {
      rollup.unmetered.count += 1;
      continue;
    }

    const e = event as Record<string, unknown>;
    events.push(e);
  }

  const unmatchedSuccessfulAttempts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'provider_attempt') {
      if (e.invoked === true) {
        addDispatch(rollup, e);
        if (typeof e.provider === 'string') {
          const providerRollup = providers[e.provider] ??= zeroUsageRollup();
          addDispatch(providerRollup, e);
          if (e.outcome === 'success' && typeof e.step === 'string') {
            const key = `${e.step}\0${e.provider}`;
            unmatchedSuccessfulAttempts.set(
              key,
              (unmatchedSuccessfulAttempts.get(key) ?? 0) + 1,
            );
          }
        }
      }
      continue;
    }

    if (e.type === 'step_completed') {
      const provider =
        typeof e.actualProvider === 'string' ? e.actualProvider : undefined;
      const key =
        provider && typeof e.step === 'string'
          ? `${e.step}\0${provider}`
          : undefined;
      const matchingAttempts = key
        ? (unmatchedSuccessfulAttempts.get(key) ?? 0)
        : 0;
      if (key && matchingAttempts > 0) {
        unmatchedSuccessfulAttempts.set(key, matchingAttempts - 1);
        continue;
      }

      addDispatch(rollup, e);
      if (provider) {
        const providerRollup = providers[provider] ??= zeroUsageRollup();
        addDispatch(providerRollup, e);
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
