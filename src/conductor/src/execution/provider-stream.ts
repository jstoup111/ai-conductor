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

/** Tracks the live child spans represented by Claude's Task tool calls. */
export class ProviderStreamChildTracker {
  readonly childObservability = 'observed' as const;

  private readonly openChildIds = new Set<string>();

  get activeChildren(): number {
    return this.openChildIds.size;
  }

  /** Apply one stream record; malformed or unrelated records leave state unchanged. */
  observe(record: unknown): void {
    if (typeof record !== 'object' || record === null) return;
    const message = (record as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null) return;
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const fields = block as Record<string, unknown>;
      if (
        fields.type === 'tool_use'
        && fields.name === 'Task'
        && typeof fields.id === 'string'
      ) {
        this.openChildIds.add(fields.id);
      }
      if (fields.type === 'tool_result' && typeof fields.tool_use_id === 'string') {
        this.openChildIds.delete(fields.tool_use_id);
      }
    }
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
    // The terminal `result` record repeats the whole run's usage as an
    // aggregate at the same top level per-message records use. Adding it to
    // the per-message sum double counts every token, so accumulate only the
    // incremental records — the live burn is built from per-message usage.
    if ((record as Record<string, unknown>).type === 'result') continue;
    const recordFields = record as Record<string, unknown>;
    const message = recordFields.message;
    // Claude stream-json assistant records carry their incremental usage in
    // the message envelope. Retain top-level usage for normalized records,
    // while preferring the provider's real stream shape.
    const usage = typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>).usage ?? recordFields.usage
      : recordFields.usage;
    if (typeof usage !== 'object' || usage === null) continue;

    const fields = usage as Record<string, unknown>;
    if (typeof fields.input_tokens === 'number') totals.uncachedInputTokens += fields.input_tokens;
    if (typeof fields.cache_read_input_tokens === 'number') totals.cachedInputTokens += fields.cache_read_input_tokens;
    if (typeof fields.cache_creation_input_tokens === 'number') totals.cachedInputTokens += fields.cache_creation_input_tokens;
    if (typeof fields.output_tokens === 'number') totals.outputTokens += fields.output_tokens;
  }

  return totals;
}
