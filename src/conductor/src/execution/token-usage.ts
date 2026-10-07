import type { TokenUsage } from './llm-provider.js';

/**
 * Keep counted tokens but withhold the price: the attempt ended without a
 * record covering all of its spend, so its dollars are not a complete figure.
 * The result classifies `cost-unmetered` — the existing "tokens counted, cost
 * not" state — rather than presenting a partial sum as the attempt's cost.
 * Absent usage stays absent: no attributable usage is `unmetered`, never zero.
 */
export function withholdCost(usage: TokenUsage | undefined): TokenUsage | undefined {
  if (usage === undefined) return undefined;
  const { costUsd: _costUsd, costSource: _costSource, ...tokens } = usage;
  return tokens;
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  return finite(a) || finite(b) ? (finite(a) ? a : 0) + (finite(b) ? b : 0) : undefined;
}

/**
 * Sum the usage of two sequential invocations that one provider attempt
 * reports together (a model-fallback rung followed by the next rung). Each
 * argument covers a different subprocess, so summing never double counts.
 *
 * Cost follows the existing all-or-nothing rule: the sum carries `costUsd`
 * only when both sides are priced; otherwise it is cost-unmetered.
 */
export function combineTokenUsage(
  first: TokenUsage | undefined,
  second: TokenUsage | undefined,
): TokenUsage | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  const combined: TokenUsage = {
    input: first.input + second.input,
    output: first.output + second.output,
  };
  const optional = {
    reasoningOutput: sumOptional(first.reasoningOutput, second.reasoningOutput),
    cacheRead: sumOptional(first.cacheRead, second.cacheRead),
    cacheCreation: sumOptional(first.cacheCreation, second.cacheCreation),
    numTurns: sumOptional(first.numTurns, second.numTurns),
    durationMs: sumOptional(first.durationMs, second.durationMs),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (combined as unknown as Record<string, number>)[key] = value;
  }
  if (finite(first.costUsd) && finite(second.costUsd)) {
    combined.costUsd = first.costUsd + second.costUsd;
    // A sum that includes any estimate is an estimate.
    combined.costSource = first.costSource === second.costSource ? first.costSource : 'rate-card';
    if (combined.costSource === undefined) delete combined.costSource;
  }
  const attributedModel = second.attributedModel ?? first.attributedModel;
  if (attributedModel !== undefined) combined.attributedModel = attributedModel;
  return combined;
}
