import { readFileSync } from 'node:fs';
import type { TokenUsage } from '../execution/llm-provider.js';

/**
 * Thrown when events.jsonl cannot be found or read.
 */
export class ReportError extends Error {
  constructor(filePath: string, cause?: unknown) {
    super(
      `No event log found at ${filePath}` +
        (cause instanceof Error ? `: ${cause.message}` : ''),
    );
    this.name = 'ReportError';
  }
}

// ─── Types for internal parsing ───────────────────────────────────────────────

interface ParsedEvent {
  type: string;
  step?: string;
  ts: string;
  status?: string;
  reason?: string;
  error?: string;
  attempt?: number;
  tokenUsage?: TokenUsage;
  [key: string]: unknown;
}

// ─── renderReport ─────────────────────────────────────────────────────────────

/**
 * Parse events.jsonl and render three summary tables:
 * 1. Step Durations — sorted descending by duration_ms
 * 2. Retry Hotspots — count per step, most common reason
 * 3. Token Spend    — per step from step_completed.tokenUsage
 */
export function renderReport(eventsJsonlPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(eventsJsonlPath, 'utf-8');
  } catch (err) {
    throw new ReportError(eventsJsonlPath, err);
  }

  const events: ParsedEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ParsedEvent);
    } catch {
      // skip malformed lines
    }
  }

  const sections: string[] = [];
  sections.push(renderDurations(events));
  sections.push(renderRetries(events));
  sections.push(renderTokenSpend(events));

  return sections.join('\n\n');
}

// ─── Section: Step Durations ──────────────────────────────────────────────────

interface DurationRow {
  step: string;
  durationMs: number | null;
}

function renderDurations(events: ParsedEvent[]): string {
  // Collect start timestamps by step
  const startTimes = new Map<string, number>();
  const completeTimes = new Map<string, number>();

  for (const evt of events) {
    if (!evt.step) continue;
    if (evt.type === 'step_started') {
      startTimes.set(evt.step, new Date(evt.ts).getTime());
    } else if (evt.type === 'step_completed') {
      completeTimes.set(evt.step, new Date(evt.ts).getTime());
    }
  }

  // Build rows for all started steps
  const rows: DurationRow[] = [];
  for (const [step, startMs] of startTimes.entries()) {
    const endMs = completeTimes.get(step);
    rows.push({
      step,
      durationMs: endMs !== undefined ? endMs - startMs : null,
    });
  }

  // Sort descending by duration (null → end)
  rows.sort((a, b) => {
    if (a.durationMs === null && b.durationMs === null) return 0;
    if (a.durationMs === null) return 1;
    if (b.durationMs === null) return -1;
    return b.durationMs - a.durationMs;
  });

  const lines: string[] = ['## Step Durations', ''];
  lines.push(padRow(['Step', 'Duration (ms)']));
  lines.push(padRow(['----', '-------------']));
  for (const row of rows) {
    lines.push(padRow([row.step, row.durationMs !== null ? String(row.durationMs) : '—']));
  }

  return lines.join('\n');
}

// ─── Section: Retry Hotspots ──────────────────────────────────────────────────

interface RetryRow {
  step: string;
  count: number;
  topReason: string;
  failed: boolean;
}

function renderRetries(events: ParsedEvent[]): string {
  // Collect retry counts and reasons per step
  const retryCounts = new Map<string, number>();
  const retryReasons = new Map<string, Map<string, number>>();
  const failedSteps = new Set<string>();
  const completedSteps = new Set<string>();

  for (const evt of events) {
    if (!evt.step) continue;
    if (evt.type === 'step_retry') {
      retryCounts.set(evt.step, (retryCounts.get(evt.step) ?? 0) + 1);
      const reason = evt.reason ?? 'unknown';
      let reasons = retryReasons.get(evt.step);
      if (!reasons) {
        reasons = new Map();
        retryReasons.set(evt.step, reasons);
      }
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    } else if (evt.type === 'step_failed') {
      failedSteps.add(evt.step);
    } else if (evt.type === 'step_completed') {
      completedSteps.add(evt.step);
    }
  }

  const lines: string[] = ['## Retry Hotspots', ''];

  if (retryCounts.size === 0) {
    lines.push('No retries recorded');
    return lines.join('\n');
  }

  lines.push(padRow(['Step', 'Retries', 'Top Reason', 'Status']));
  lines.push(padRow(['----', '-------', '----------', '------']));

  // Sort by count descending
  const rows: RetryRow[] = [];
  for (const [step, count] of retryCounts.entries()) {
    const reasons = retryReasons.get(step) ?? new Map();
    let topReason = '';
    let topCount = 0;
    for (const [r, c] of reasons.entries()) {
      if (c > topCount) {
        topCount = c;
        topReason = r;
      }
    }
    const failed = failedSteps.has(step) && !completedSteps.has(step);
    rows.push({ step, count, topReason, failed });
  }
  rows.sort((a, b) => b.count - a.count);

  for (const row of rows) {
    const statusLabel = row.failed ? '(failed)' : 'ok';
    lines.push(padRow([row.step, String(row.count), row.topReason, statusLabel]));
  }

  return lines.join('\n');
}

// ─── Section: Token Spend ─────────────────────────────────────────────────────

interface TokenRow {
  step: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

function renderTokenSpend(events: ParsedEvent[]): string {
  const rows: TokenRow[] = [];

  for (const evt of events) {
    if (evt.type === 'step_completed' && evt.step && evt.tokenUsage) {
      const usage = evt.tokenUsage;
      rows.push({
        step: evt.step,
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead ?? 0,
        cacheCreation: usage.cacheCreation ?? 0,
      });
    }
  }

  const lines: string[] = ['## Token Spend', ''];

  if (rows.length === 0) {
    lines.push('No token data recorded');
    return lines.join('\n');
  }

  lines.push(padRow(['Step', 'Input', 'Output', 'CacheRead', 'CacheCreation']));
  lines.push(padRow(['----', '-----', '------', '---------', '-------------']));

  // Sort by total tokens descending
  rows.sort((a, b) => (b.input + b.output) - (a.input + a.output));

  for (const row of rows) {
    lines.push(padRow([
      row.step,
      String(row.input),
      String(row.output),
      String(row.cacheRead),
      String(row.cacheCreation),
    ]));
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function padRow(cols: string[]): string {
  return cols.map((c) => c.padEnd(20)).join('  ').trimEnd();
}
