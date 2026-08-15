import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { renderReport, ReportError, parseEvents, aggregateKickbacks } from '../../src/engine/report-renderer.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';

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

  it('renders raw rubric, cache, and explicit skipped-not-pass metrics', async () => {
    await writeFile(eventsPath, makeLines([
      { event: { type: 'build_review_rubric_result', rubric: 'scope', verdict: 'FAIL' }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'build_review_rubric_skipped', rubric: 'wiring', reason: 'missing-entry-points' }, ts: '2026-01-01T00:00:01.000Z' },
      { event: { type: 'build_review_cache_hit', rubric: 'tautology' }, ts: '2026-01-01T00:00:02.000Z' },
      { event: { type: 'build_review_outer_verdict', lapId: 'lap-1', effectiveVerdict: 'PASS' }, ts: '2026-01-01T00:00:03.000Z' },
    ]), 'utf8');

    expect(renderReport(eventsPath)).toContain('Effective laps-to-pass: 1\nReduced coverage (skipped, not pass): 1\nSkip reasons: missing-entry-points=1\nCache hits: 1\nRaw scope: failures=1/1');
  });

  it('renders absent build-review data safely', async () => {
    await writeFile(eventsPath, '', 'utf8');
    expect(renderReport(eventsPath)).toContain('## Build Review Metrics\nNo build-review metrics recorded');
  });

  it('ignores persisted kickback lines in report, timing, and cost rollups', async () => {
    const baselineDir = join(tempDir, 'baseline');
    const kickbackDir = join(tempDir, 'with-kickback');
    const baseline = makeLines([
      { event: { type: 'step_started', step: 'build', activeInterval: { start: 0, end: 1_000 } }, ts: '2026-01-01T00:00:00.000Z' },
      { event: { type: 'step_completed', step: 'build', activeInterval: { start: 0, end: 1_000 }, tokenUsage: { input: 100, output: 50, costUsd: 0.01 } }, ts: '2026-01-01T00:00:01.000Z' },
    ]);
    const withKickback = `${baseline}${makeLines([
      { event: { type: 'kickback', from: 'build_review', to: 'build', evidence: 'rerun build', count: 1 }, ts: '2026-01-01T00:00:02.000Z' },
    ])}`;

    await Promise.all([baselineDir, kickbackDir].map(async (dir, index) => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'events.jsonl'), index === 0 ? baseline : withKickback, 'utf-8');
    }));

    const baselineResults = [
      renderReport(join(baselineDir, '.pipeline', 'events.jsonl')),
      await computeTimingRollup(baselineDir),
      await computeCostRollup(baselineDir),
    ];
    const kickbackResults = [
      renderReport(join(kickbackDir, '.pipeline', 'events.jsonl')),
      await computeTimingRollup(kickbackDir),
      await computeCostRollup(kickbackDir),
    ];

    expect(kickbackResults).toEqual(baselineResults);
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

  // ─── #647 D3: kickback_outcome discriminator surfaced by aggregateKickbacks ──

  it('aggregateKickbacks surfaces kickback_outcome as kickbackOutcome when the event carries it', () => {
    const events = parseEvents(
      makeLines([
        {
          event: {
            type: 'kickback',
            from: 'architecture_review_as_built',
            to: 'build',
            evidence: 'test:as-built-gap→build',
            count: 1,
            kickback_outcome: 'did-work (commits abc1234..def5678 / resolved +1)',
          },
          ts: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );

    const kickbacks = aggregateKickbacks(events);

    expect(kickbacks).toHaveLength(1);
    expect(kickbacks[0].kickbackOutcome).toBe(
      'did-work (commits abc1234..def5678 / resolved +1)',
    );
  });

  it('aggregateKickbacks omits kickbackOutcome when the event carries none', () => {
    const events = parseEvents(
      makeLines([
        {
          event: {
            type: 'kickback',
            from: 'conflict_check',
            to: 'architecture_review',
            evidence: 'missing seam',
            count: 1,
          },
          ts: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );

    const kickbacks = aggregateKickbacks(events);

    expect(kickbacks).toHaveLength(1);
    expect(kickbacks[0].kickbackOutcome).toBeUndefined();
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

  it('renders preferred and actual providers for mixed-provider token spend while preserving legacy rows', async () => {
    const content = makeLines([
      {
        event: {
          type: 'step_completed',
          step: 'plan',
          status: 'done',
          preferredProvider: 'codex',
          actualProvider: 'claude',
          tokenUsage: { input: 100, output: 20 },
        },
        ts: '2026-01-01T00:00:05.000Z',
      },
      {
        event: {
          type: 'step_completed',
          step: 'build',
          status: 'done',
          preferredProvider: 'codex',
          actualProvider: 'codex',
          tokenUsage: { input: 50, output: 10 },
        },
        ts: '2026-01-01T00:00:10.000Z',
      },
      {
        event: {
          type: 'step_completed',
          step: 'legacy',
          status: 'done',
          tokenUsage: { input: 10, output: 5 },
        },
        ts: '2026-01-01T00:00:15.000Z',
      },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);

    expect(report).toMatch(
      /Step\s+Preferred Provider\s+Actual Provider\s+Input\s+Output[\s\S]*plan\s+codex\s+claude\s+100\s+20[\s\S]*build\s+codex\s+codex\s+50\s+10[\s\S]*legacy\s+—\s+—\s+10\s+5/,
    );
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

  it('reports exact serial, group, and pre-first operator park boundaries', async () => {
    const content = makeLines([
      {
        event: {
          type: 'operator_park_boundary',
          featureSlug: 'serial-feature',
          boundary: { kind: 'step', name: 'memory' },
        },
        ts: '2026-01-01T00:00:01.000Z',
      },
      {
        event: {
          type: 'operator_park_boundary',
          featureSlug: 'group-feature',
          boundary: { kind: 'group', name: 'ship-validation' },
        },
        ts: '2026-01-01T00:00:02.000Z',
      },
      {
        event: {
          type: 'operator_park_boundary',
          featureSlug: 'early-feature',
          boundary: { kind: 'pre-first-unit' },
        },
        ts: '2026-01-01T00:00:03.000Z',
      },
    ]);
    await writeFile(eventsPath, content, 'utf-8');

    const report = renderReport(eventsPath);

    expect(report).toContain('## Operator Park Boundaries');
    expect(report).toMatch(/serial-feature\s+step\s+memory/);
    expect(report).toMatch(/group-feature\s+group\s+ship-validation/);
    expect(report).toMatch(/early-feature\s+pre-first-unit\s+—/);
    expect(report).not.toMatch(/\b(?:DONE|HALT|ERROR)\b/);
  });
});
