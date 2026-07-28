// provider-diagnostics.ts — Human-readable rendering of a provider subprocess's
// captured output for the daemon activity log.
//
// Both provider adapters run their CLI in `pipe` mode when a daemon feature
// supplies a `diagnosticLog` sink, then hand the captured stdout/stderr to that
// sink so the feature's `.daemon/daemon.log` retains the diagnostic. Claude's
// `--print --output-format json` stdout, however, is a SINGLE machine envelope:
// one enormous line carrying cost/usage telemetry, per-tool permission records,
// and — buried at the end — the human-readable `result` text. Teeing it verbatim
// produced daemon.log lines like
//
//   [daemon][gate-kickback-counter-r…] {"is_error":false,"duration_api_ms":486825,…}
//
// which an operator triaging a possibly-wedged build cannot read at all. Codex's
// `exec --json` stdout is the same problem in JSONL form.
//
// This module converts that envelope into a one-line summary plus the agent's
// own prose. It is deliberately TOTAL: any output it does not positively
// recognize as a machine envelope is returned verbatim, so plain-prose stdout,
// stderr, crash traces, and future/unknown payload shapes never lose detail.

/** Telemetry extracted from a recognized provider result envelope. */
interface EnvelopeSummary {
  /** Human-readable agent text, when the envelope carried one. */
  text?: string;
  /** `true` when the provider flagged the run as an error result. */
  isError?: boolean;
  numTurns?: number;
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Render a millisecond duration compactly: `8m6s`, `42s`, `640ms`. Whole
 * seconds only above one second — sub-second precision is noise in a log an
 * operator is scanning for "is this step still moving?".
 */
export function formatDiagnosticDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return `${seconds}s`;
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours === 0) return `${minutes}m${seconds}s`;
  return `${hours}h${minutes}m${seconds}s`;
}

/** Compact token count: `1.2k`, `486k`, `12`. */
export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Whole-feature provider usage, summed across every dispatch a feature build
 * recorded. Mirrors the per-dispatch telemetry an `EnvelopeSummary` carries so
 * the aggregate line reads as a sibling of the per-step provider lines.
 */
export interface FeatureUsageTotals {
  /** Every provider dispatch attributed to the feature, metered or not. */
  dispatches: number;
  /** Dispatches that reported token usage — the denominator of the money figure. */
  meteredDispatches: number;
  /** Dispatches that reported no usage (e.g. an unmetered provider, or a lost record). */
  unmeteredDispatches: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compose the whole-feature usage line logged when `finish` completes:
 *
 *   finish: total usage — 23 dispatches, $12.34, 1.2M→48k tok, 2 unmetered
 *
 * Cost and token figures are emitted ONLY when at least one dispatch was
 * actually metered. A build whose provider reports no usage prints its
 * dispatch count and an explicit unmetered count rather than a fabricated
 * `$0.00` / `0→0 tok`, which would read as "this build was free" instead of
 * "this build was never measured".
 */
export function formatFeatureUsageTotal(totals: FeatureUsageTotals): string {
  const parts: string[] = [
    `${totals.dispatches} dispatch${totals.dispatches === 1 ? '' : 'es'}`,
  ];
  if (totals.meteredDispatches > 0) {
    parts.push(`$${totals.costUsd.toFixed(2)}`);
    parts.push(
      `${formatTokens(totals.inputTokens)}→${formatTokens(totals.outputTokens)} tok`,
    );
  }
  if (totals.unmeteredDispatches > 0) parts.push(`${totals.unmeteredDispatches} unmetered`);
  return `finish: total usage — ${parts.join(', ')}`;
}

/**
 * Recognize Claude's `--print --output-format json` envelope: a single JSON
 * object whose `result` is a string. Anything else is not this shape.
 */
function parseClaudeEnvelope(stdout: string): EnvelopeSummary | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  if (typeof parsed.result !== 'string') return undefined;

  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  const summary: EnvelopeSummary = { text: parsed.result };
  if (typeof parsed.is_error === 'boolean') summary.isError = parsed.is_error;
  summary.numTurns = num(parsed.num_turns);
  summary.durationMs = num(parsed.duration_ms) ?? num(parsed.duration_api_ms);
  summary.costUsd = num(parsed.total_cost_usd);
  summary.inputTokens = num(usage.input_tokens);
  summary.outputTokens = num(usage.output_tokens);
  return summary;
}

/**
 * Recognize Codex's `exec --json` JSONL stream. Requires at least one line that
 * parses as a JSON object carrying a string `type` — otherwise the output is
 * ordinary prose and is passed through untouched.
 */
function parseCodexEnvelope(stdout: string): EnvelopeSummary | undefined {
  let sawEvent = false;
  const summary: EnvelopeSummary = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof event.type !== 'string') continue;
    sawEvent = true;
    if (event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message') {
        const text =
          typeof item.text === 'string'
            ? item.text
            : Array.isArray(item.content)
              ? (item.content as Array<Record<string, unknown>>)
                  .map((part) => (typeof part?.text === 'string' ? part.text : ''))
                  .join('')
              : undefined;
        if (text) summary.text = text;
      }
    }
    if (event.type === 'turn.completed') {
      const usage = event.usage as Record<string, unknown> | undefined;
      if (usage) {
        summary.inputTokens = num(usage.input_tokens);
        summary.outputTokens = num(usage.output_tokens);
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') summary.isError = true;
  }
  return sawEvent ? summary : undefined;
}

/** Compose the `provider: done — 54 turns, 8m6s, $4.96` headline. */
function formatHeadline(provider: string, summary: EnvelopeSummary): string {
  const parts: string[] = [];
  if (summary.numTurns !== undefined) {
    parts.push(`${summary.numTurns} turn${summary.numTurns === 1 ? '' : 's'}`);
  }
  if (summary.durationMs !== undefined) parts.push(formatDiagnosticDuration(summary.durationMs));
  if (summary.costUsd !== undefined) parts.push(`$${summary.costUsd.toFixed(2)}`);
  if (summary.inputTokens !== undefined && summary.outputTokens !== undefined) {
    parts.push(`${formatTokens(summary.inputTokens)}→${formatTokens(summary.outputTokens)} tok`);
  }
  const outcome = summary.isError ? 'error' : 'done';
  const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
  return `${provider}: ${outcome}${detail}`;
}

/**
 * Convert one captured provider output stream into what belongs in daemon.log.
 *
 * Recognized machine envelopes become a telemetry headline followed by the
 * agent's own prose. EVERYTHING else — prose stdout from an interactive-mode
 * dispatch, stderr, crash traces, unknown payload shapes — is returned
 * unchanged, so no diagnostic detail is ever traded for readability.
 */
export function summarizeProviderDiagnostic(provider: string, output: string): string {
  if (output.trim().length === 0) return output;
  const summary =
    provider === 'codex'
      ? (parseCodexEnvelope(output) ?? parseClaudeEnvelope(output))
      : (parseClaudeEnvelope(output) ?? parseCodexEnvelope(output));
  if (!summary) return output;

  const headline = formatHeadline(provider, summary);
  const text = summary.text?.trim();
  return text ? `${headline}\n${text}` : headline;
}
