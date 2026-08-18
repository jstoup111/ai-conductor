import { describe, it, expect } from 'vitest';
import {
  summarizeProviderDiagnostic,
  formatDiagnosticDuration,
  formatFeatureUsageTotal,
} from '../../src/execution/provider-diagnostics.js';

// The daemon tees a provider subprocess's captured stdout/stderr into
// `.daemon/daemon.log`. Claude's `--print --output-format json` stdout is one
// giant machine envelope; dumping it verbatim made the log unreadable for an
// operator triaging a possibly-wedged build. These tests pin the readable
// rendering AND the total-fallback guarantee that no diagnostic is ever lost.

describe('formatDiagnosticDuration', () => {
  it('renders sub-second durations in milliseconds', () => {
    expect(formatDiagnosticDuration(640)).toBe('640ms');
  });

  it('renders under a minute in whole seconds', () => {
    expect(formatDiagnosticDuration(42_000)).toBe('42s');
  });

  it('renders minutes and seconds', () => {
    expect(formatDiagnosticDuration(486_825)).toBe('8m7s');
  });

  it('renders hours, minutes, and seconds', () => {
    expect(formatDiagnosticDuration(3_723_000)).toBe('1h2m3s');
  });

  it('degrades a nonsense duration to a marker instead of throwing', () => {
    expect(formatDiagnosticDuration(Number.NaN)).toBe('?');
  });
});

describe('summarizeProviderDiagnostic: claude result envelope', () => {
  // Field-for-field shape of the line the operator reported (2026-07-27),
  // trimmed of the nested usage/permission-denial noise that motivated the fix.
  const envelope = JSON.stringify({
    is_error: false,
    duration_ms: 486_825,
    duration_api_ms: 486_825,
    num_turns: 54,
    stop_reason: 'end_turn',
    session_id: '82306471-0000-0000-0000-000000000000',
    total_cost_usd: 4.956137999999998,
    usage: { input_tokens: 345, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2_000, output_tokens: 4_100 },
    permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }],
    result: 'RED acceptance specs written, executed, and committed.\n\n**What landed:** …',
  });

  it('replaces the raw JSON blob with a telemetry headline plus the agent prose', () => {
    const summary = summarizeProviderDiagnostic('claude', envelope);
    expect(summary).toBe(
      'claude: done — 54 turns, 8m7s, $4.96, 12.3k→4.1k tok (97% cached)\n' +
        'RED acceptance specs written, executed, and committed.\n\n**What landed:** …',
    );
  });

  it('never leaks the machine telemetry keys into the log line', () => {
    const summary = summarizeProviderDiagnostic('claude', envelope);
    expect(summary).not.toContain('session_id');
    expect(summary).not.toContain('permission_denials');
    expect(summary).not.toContain('stop_reason');
  });

  it('reports an error envelope as an error outcome', () => {
    const summary = summarizeProviderDiagnostic(
      'claude',
      JSON.stringify({ is_error: true, num_turns: 1, result: 'Execution error' }),
    );
    expect(summary).toBe('claude: error — 1 turn\nExecution error');
  });

  it('renders a headline alone when the envelope carries no prose', () => {
    const summary = summarizeProviderDiagnostic(
      'claude',
      JSON.stringify({ is_error: false, num_turns: 3, total_cost_usd: 0.5, result: '   ' }),
    );
    expect(summary).toBe('claude: done — 3 turns, $0.50');
  });
});

describe('summarizeProviderDiagnostic: codex jsonl stream', () => {
  const jsonl = [
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Implemented the parser and committed.' },
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 900_000, output_tokens: 2_500 },
    }),
  ].join('\n');

  it('summarizes the stream into a headline plus the final agent message', () => {
    expect(summarizeProviderDiagnostic('codex', jsonl)).toBe(
      'codex: done — 900k→2.5k tok\nImplemented the parser and committed.',
    );
  });

  it('qualifies a cache-heavy dispatch with its cached share', () => {
    // A codex agentic run resubmits its conversation every internal tool
    // call; the cumulative "input" reads ~10x the fresh context without the
    // cached qualifier (the 1.57M-input remediate incident).
    const cacheHeavy = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Wrote remediation.json.' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 1_571_053, cached_input_tokens: 1_454_080, output_tokens: 6_662 },
      }),
    ].join('\n');
    expect(summarizeProviderDiagnostic('codex', cacheHeavy)).toBe(
      'codex: done — 1.6M→6.7k tok (93% cached)\nWrote remediation.json.',
    );
  });

  it('marks a failed turn as an error outcome', () => {
    const failed = JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } });
    expect(summarizeProviderDiagnostic('codex', failed)).toBe('codex: error');
  });
});

describe('summarizeProviderDiagnostic: unrecognized output passes through verbatim', () => {
  it('returns plain prose unchanged', () => {
    const prose = 'Reading files…\nDone.\n';
    expect(summarizeProviderDiagnostic('claude', prose)).toBe(prose);
  });

  it('returns a stderr crash trace unchanged', () => {
    const trace = 'Error: ENOENT: no such file or directory\n    at Object.open (fs.js:1)';
    expect(summarizeProviderDiagnostic('claude', trace)).toBe(trace);
  });

  it('returns malformed JSON unchanged rather than swallowing it', () => {
    const broken = '{"is_error":false,"result":"truncated';
    expect(summarizeProviderDiagnostic('claude', broken)).toBe(broken);
  });

  it('returns a JSON object with no result field unchanged', () => {
    const other = JSON.stringify({ some: 'other', payload: 1 });
    expect(summarizeProviderDiagnostic('claude', other)).toBe(other);
  });

  it('returns empty output unchanged', () => {
    expect(summarizeProviderDiagnostic('claude', '')).toBe('');
  });
});

// A build's per-step provider lines answer "what did this step cost?". The
// whole-feature line answers "what did this feature cost?" — the figure an
// operator would otherwise reconstruct by summing a hundred log lines. It must
// read as a sibling of the per-step lines, and must never turn "never
// measured" into "measured as free".
describe('formatFeatureUsageTotal', () => {
  it('renders dispatch count, cost, and token split for a fully metered build', () => {
    expect(
      formatFeatureUsageTotal({
        dispatches: 23,
        meteredDispatches: 23,
        unmeteredDispatches: 0,
        costUsd: 12.3449,
        inputTokens: 1_200_000,
        outputTokens: 48_000,
      }),
    ).toBe('finish: total usage — 23 dispatches, $12.34, 1.2M→48k tok');
  });

  it('names the unmetered dispatches alongside the metered totals in a mixed build', () => {
    expect(
      formatFeatureUsageTotal({
        dispatches: 10,
        meteredDispatches: 8,
        unmeteredDispatches: 2,
        costUsd: 3.5,
        inputTokens: 900,
        outputTokens: 120,
      }),
    ).toBe('finish: total usage — 10 dispatches, $3.50, 900→120 tok, 2 unmetered');
  });

  it('splits fresh from cached input when the build tracked cache volume', () => {
    // Fresh input and cached resubmission are different quantities (cached is
    // ~10% price and mostly re-reads); one merged figure made ordinary
    // agentic builds read as 100M+-token pathologies.
    expect(
      formatFeatureUsageTotal({
        dispatches: 104,
        meteredDispatches: 104,
        unmeteredDispatches: 0,
        costUsd: 32.14,
        inputTokens: 8_400_000,
        outputTokens: 639_300,
        cachedInputTokens: 121_600_000,
      }),
    ).toBe('finish: total usage — 104 dispatches, $32.14, 8.4M fresh + 121.6M cached→639.3k tok');
  });

  it('omits cost and tokens entirely when no dispatch was ever metered', () => {
    // The no-fabricated-zeros rule: a build whose provider reports no usage
    // must not print `$0.00, 0→0 tok`, which reads as a free build.
    const line = formatFeatureUsageTotal({
      dispatches: 6,
      meteredDispatches: 0,
      unmeteredDispatches: 6,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(line).toBe('finish: total usage — 6 dispatches, 6 unmetered');
    expect(line).not.toContain('$');
    expect(line).not.toContain('tok');
  });

  it('singularizes a one-dispatch build', () => {
    expect(
      formatFeatureUsageTotal({
        dispatches: 1,
        meteredDispatches: 1,
        unmeteredDispatches: 0,
        costUsd: 0.004,
        inputTokens: 12,
        outputTokens: 3,
      }),
    ).toBe('finish: total usage — 1 dispatch, $0.00, 12→3 tok');
  });
});
