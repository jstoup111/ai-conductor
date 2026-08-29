// rate-card.ts — Per-model token prices for providers that report token counts
// but no money.
//
// Claude Code reports `total_cost_usd` on every dispatch, so `TokenUsage.costUsd`
// is provider-reported truth there. Codex reports token counts and nothing else,
// so every codex dispatch classified as `cost-unmetered` and contributed $0 to
// the feature rollup — pairing all-provider token volume with Claude-only
// dollars, which understated a real mixed-provider feature by 4.4x.
//
// This module supplies the missing multiplication. It is deliberately narrow:
//
//   * The card is DURABLE STATE, not telemetry (event-spine exception C — it
//     answers "what is true now" and is read by name), so it lives in a
//     committed JSON file rather than on the event bus.
//   * Pricing happens at DISPATCH time, inside the adapter, and the resulting
//     `costUsd` rides the EXISTING `TokenUsage` on the existing
//     `provider_attempt` event. No new channel; every consumer
//     (`cost-rollup.ts`, the feature usage line, OTel) works unchanged.
//   * The rate in force when the dispatch ran is baked into the event log.
//     History is never re-priced — a later card revision would silently drift
//     every past feature's reported cost.
//   * It FAILS CLOSED. A missing card, an unparseable card, an unknown model,
//     or a malformed rate leaves `costUsd` undefined, so the dispatch stays
//     `cost-unmetered` exactly as it does today. `metering.ts` classifies
//     "without inventing a cost", and this module does not weaken that.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from './llm-provider.js';

/** Project-relative location of the committed rate card. */
export const RATE_CARD_RELATIVE_PATH = join('.ai-conductor', 'rate-card.json');

/** Upstream the card is pruned from; recorded in the card and used by refresh. */
export const RATE_CARD_SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/**
 * One model's per-TOKEN prices. Field names are LiteLLM's verbatim so a card
 * entry is a literal subset of the upstream record and can be diffed against it.
 */
export interface ModelRate {
  input_cost_per_token: number;
  output_cost_per_token: number;
  /** Falls back to `input_cost_per_token` when the model has no cache tier. */
  cache_read_input_token_cost?: number;
  /**
   * Writing a cache entry costs MORE than ordinary input — upstream publishes
   * 1.25x across the codex family (terra 2.5e-6 vs input 2e-6). Falls back to
   * `input_cost_per_token` only when a model publishes no cache-write tier.
   */
  cache_creation_input_token_cost?: number;
}

export interface RateCard {
  /** ISO-8601 instant the card was last pruned from upstream. */
  as_of: string;
  source: string;
  models: Record<string, ModelRate>;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Narrow one upstream/committed record to a usable rate, or reject it. */
export function parseModelRate(value: unknown): ModelRate | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!finite(record.input_cost_per_token)) return undefined;
  if (!finite(record.output_cost_per_token)) return undefined;
  const rate: ModelRate = {
    input_cost_per_token: record.input_cost_per_token,
    output_cost_per_token: record.output_cost_per_token,
  };
  if (finite(record.cache_read_input_token_cost)) {
    rate.cache_read_input_token_cost = record.cache_read_input_token_cost;
  }
  if (finite(record.cache_creation_input_token_cost)) {
    rate.cache_creation_input_token_cost = record.cache_creation_input_token_cost;
  }
  return rate;
}

/**
 * Parse a committed rate card. Total: any shape this does not positively
 * recognize yields `undefined`, and individual unusable model entries are
 * dropped rather than failing the whole card.
 */
export function parseRateCard(raw: string): RateCard | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.as_of !== 'string' || record.as_of.length === 0) return undefined;
  const rawModels = record.models;
  if (typeof rawModels !== 'object' || rawModels === null) return undefined;

  const models: Record<string, ModelRate> = Object.create(null);
  for (const [model, value] of Object.entries(rawModels as Record<string, unknown>)) {
    const rate = parseModelRate(value);
    if (rate) models[model] = rate;
  }

  return {
    as_of: record.as_of,
    source: typeof record.source === 'string' ? record.source : RATE_CARD_SOURCE_URL,
    models,
  };
}

/**
 * Price one dispatch's usage.
 *
 *   cost = input          * input_cost_per_token
 *        + cacheRead      * (cache_read_input_token_cost ?? input_cost_per_token)
 *        + cacheCreation  * (cache_creation_input_token_cost ?? input_cost_per_token)
 *        + output         * output_cost_per_token
 *
 * `reasoningOutput` is NOT priced separately: providers already include it in
 * `output_tokens`, so adding it would double-charge every reasoning dispatch.
 * `input` is fresh-only by `TokenUsage` contract (the codex adapter has already
 * subtracted the cached share), so the cached volume is never counted twice.
 */
export function priceUsage(usage: TokenUsage, rate: ModelRate): number {
  const cacheReadRate = rate.cache_read_input_token_cost ?? rate.input_cost_per_token;
  // Cache WRITES are dearer than input, not equal to it. Pricing them at the
  // input rate understated every cache-creating dispatch by 20%; it stayed
  // invisible only because codex reported cacheCreation: 0 on all 17 observed
  // dispatches, so the term was inert rather than correct.
  const cacheCreationRate =
    rate.cache_creation_input_token_cost ?? rate.input_cost_per_token;
  return (
    (usage.input || 0) * rate.input_cost_per_token +
    (usage.cacheRead ?? 0) * cacheReadRate +
    (usage.cacheCreation ?? 0) * cacheCreationRate +
    (usage.output || 0) * rate.output_cost_per_token
  );
}

/**
 * Return `usage` with a rate-card-derived `costUsd`/`costSource` attached, or
 * unchanged when the cost cannot be established.
 *
 * A usage that already carries a provider-reported `costUsd` is returned
 * untouched: provider truth always outranks a harness estimate.
 */
export function applyRateCard(
  usage: TokenUsage | undefined,
  model: string | undefined,
  card: RateCard | undefined,
): TokenUsage | undefined {
  if (!usage) return usage;
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return usage;
  if (!model || !card) return usage;
  const rate = Object.hasOwn(card.models, model) ? card.models[model] : undefined;
  if (!rate) return usage;
  const costUsd = priceUsage(usage, rate);
  if (!Number.isFinite(costUsd)) return usage;
  return { ...usage, costUsd, costSource: 'rate-card' };
}

const cache = new Map<string, RateCard | undefined>();

/** Test seam: drop the per-process memo. */
export function clearRateCardCache(): void {
  cache.clear();
}

/**
 * Read the rate card for `projectRoot`. Memoized per path for the life of the
 * process: rates change rarely (a merged bot PR), and a daemon restart picks
 * up the new card. No stat on the dispatch path.
 *
 * Never throws — an absent or unreadable card is simply "no rates".
 */
export function loadRateCard(projectRoot: string | undefined): RateCard | undefined {
  // The global card WINS: bin/install and bin/update keep it symlinked to the
  // harness checkout's committed card, so every project prices codex from one
  // current source. A project's committed card only applies where no global
  // card exists (e.g. an environment that never ran bin/install).
  const globalCard = readCardAt(globalRateCardPath());
  if (globalCard) return globalCard;
  return projectRoot
    ? readCardAt(join(projectRoot, RATE_CARD_RELATIVE_PATH))
    : undefined;
}

/** Resolved per call so tests can redirect via $HOME. */
export function globalRateCardPath(): string {
  return join(homedir(), '.ai-conductor', 'rate-card.json');
}

function readCardAt(path: string): RateCard | undefined {
  if (cache.has(path)) return cache.get(path);
  let card: RateCard | undefined;
  try {
    card = parseRateCard(readFileSync(path, 'utf-8'));
  } catch {
    card = undefined;
  }
  cache.set(path, card);
  return card;
}

/** The production loader shape the codex adapter injects. */
export type RateCardLoader = (projectRoot: string | undefined) => RateCard | undefined;
