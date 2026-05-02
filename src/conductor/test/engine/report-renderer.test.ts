import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { renderReport, ReportError } from '../../src/engine/report-renderer.js';

// Helper: build a JSONL line from event + timestamp offset in ms
function makeEvent(event: Record<string, unknown>, ts: string): string {
  return JSON.stringify({ ...event, ts });
}

function makeLines(events: Array<{ event: Record<string, unknown>; ts: string }>): string {
  return events.map((e) => makeEvent(e.event, e.ts)).join('\n') + '\n';
}

describe('report-renderer', () => {
  let tempDir: string;
  let eventsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'report-renderer-test-'));
    eventsPath = join(tempDir, 'events.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Task 9: step durations table ─────────────────────────────────────────

  it('renders Step Durations table from step_started/step_completed pairs', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done' }, ts: '2026-01-01T00:00:05.000Z' },
      { event: { type: 'step_started', step: 'stories', index: 1 }, ts: '2026-01-01T00:00:10.000Z' },
      { event: { type: 'step_completed', step: 'stories', status: 'done' }, ts: '2026-01-01T00:00:12.500Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);

    expect(report).toContain('Step Durations');
    expect(report).toContain('bootstrap');
    expect(report).toContain('5000'); // ms
    expect(report).toContain('stories');
    expect(report).toContain('2500');
  });

  it('sorts Step Durations table descending by duration', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'stories', index: 1 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'stories', status: 'done' }, ts: '2026-01-01T00:00:02.000Z' },
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:10.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done' }, ts: '2026-01-01T00:00:20.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    const bootstrapPos = report.indexOf('bootstrap');
    const storiesPos = report.indexOf('stories');

    // bootstrap (10s) > stories (2s) — bootstrap should appear first
    expect(bootstrapPos).toBeLessThan(storiesPos);
  });

  it('shows em-dash for steps with no completion event', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      // No step_completed for bootstrap
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('bootstrap');
    expect(report).toContain('—');
  });

  // ─── Task 10: missing events.jsonl → ReportError ──────────────────────────

  it('throws ReportError when events.jsonl does not exist', () => {
    const missingPath = join(tempDir, 'nonexistent', 'events.jsonl');
    expect(() => renderReport(missingPath)).toThrow(ReportError);
  });

  it('ReportError message mentions the file path', () => {
    const missingPath = join(tempDir, 'nonexistent', 'events.jsonl');
    try {
      renderReport(missingPath);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportError);
      expect((err as ReportError).message).toContain(missingPath);
    }
  });

  it('ReportError is an instance of Error', () => {
    const err = new ReportError('/path/events.jsonl');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ReportError');
  });

  // ─── Task 11: retry hotspots table ────────────────────────────────────────

  it('renders Retry Hotspots table when step_retry events present', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_retry', step: 'bootstrap', attempt: 1, maxAttempts: 3, reason: 'rate limit' }, ts: '2026-01-01T00:00:01.000Z' },
      { event: { type: 'step_retry', step: 'bootstrap', attempt: 2, maxAttempts: 3, reason: 'rate limit' }, ts: '2026-01-01T00:00:02.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done' }, ts: '2026-01-01T00:00:10.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('Retry Hotspots');
    expect(report).toContain('bootstrap');
    expect(report).toContain('2'); // retry count
    expect(report).toContain('rate limit');
  });

  it('shows "No retries recorded" when no step_retry events', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done' }, ts: '2026-01-01T00:00:05.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('Retry Hotspots');
    expect(report).toContain('No retries recorded');
  });

  // ─── Task 12: failed step with retries shown as "(failed)" ───────────────

  it('shows "(failed)" for step with retries but no step_completed', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'stories', index: 1 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_retry', step: 'stories', attempt: 1, maxAttempts: 2, reason: 'timeout' }, ts: '2026-01-01T00:00:01.000Z' },
      { event: { type: 'step_failed', step: 'stories', error: 'max retries exhausted', retryCount: 1 }, ts: '2026-01-01T00:00:02.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('stories');
    expect(report).toContain('(failed)');
  });

  // ─── Task 13: token spend table ──────────────────────────────────────────

  it('renders Token Spend table from step_completed tokenUsage', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done', tokenUsage: { input: 100, output: 50 } }, ts: '2026-01-01T00:00:05.000Z' },
      { event: { type: 'step_started', step: 'stories', index: 1 }, ts: '2026-01-01T00:00:10.000Z' },
      { event: { type: 'step_completed', step: 'stories', status: 'done', tokenUsage: { input: 200, output: 75, cacheRead: 30 } }, ts: '2026-01-01T00:00:15.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('Token Spend');
    expect(report).toContain('bootstrap');
    expect(report).toContain('100');
    expect(report).toContain('50');
    expect(report).toContain('stories');
    expect(report).toContain('200');
    expect(report).toContain('75');
  });

  it('shows "No token data recorded" when no step_completed has tokenUsage', async () => {
    const content = makeLines([
      { event: { type: 'step_started', step: 'bootstrap', index: 0 }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'bootstrap', status: 'done' }, ts: '2026-01-01T00:00:05.000Z' },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);
    expect(report).toContain('Token Spend');
    expect(report).toContain('No token data recorded');
  });
});
