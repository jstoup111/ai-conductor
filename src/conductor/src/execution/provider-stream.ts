/**
 * Reassembles newline-delimited JSON records from arbitrary stdout chunks.
 * Incomplete trailing data remains buffered until a later chunk completes it.
 */
export class ProviderStreamAssembler {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

export interface ProviderStreamTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Sum provider-reported token usage from parsed stream records. */
export function accumulateProviderStreamTokens(records: Iterable<unknown>): ProviderStreamTokenTotals {
  const totals: ProviderStreamTokenTotals = {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  for (const record of records) {
    if (typeof record !== 'object' || record === null) continue;
    const usage = (record as Record<string, unknown>).usage;
    if (typeof usage !== 'object' || usage === null) continue;

    const fields = usage as Record<string, unknown>;
    if (typeof fields.input_tokens === 'number') totals.uncachedInputTokens += fields.input_tokens;
    if (typeof fields.cache_read_input_tokens === 'number') totals.cachedInputTokens += fields.cache_read_input_tokens;
    if (typeof fields.cache_creation_input_tokens === 'number') totals.cachedInputTokens += fields.cache_creation_input_tokens;
    if (typeof fields.output_tokens === 'number') totals.outputTokens += fields.output_tokens;
  }

  return totals;
}
