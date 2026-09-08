import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';
import type { ConductorEvent } from '../src/types/index.js';

function lines(event: ConductorEvent): string[] {
  const output: string[] = [];
  renderDaemonEvent(event, (line) => output.push(line));
  return output;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent: build_review rubric lifecycle', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('labels a started rubric branch with its lap tag', () => {
    expect(lines({
      type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'lap-12345678',
    })).toEqual(['·   build_review [lap-1234] testQuality started']);
  });

  it('labels a cached rubric branch distinctly from a fresh start', () => {
    expect(lines({
      type: 'build_review_cache_hit', rubric: 'testQuality', lapId: 'lap-12345678',
    })).toEqual(['·   build_review [lap-1234] testQuality cache hit']);
  });

  it('keeps starts from separate laps distinguishable', () => {
    const first = lines({
      type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'first-lap-1234',
    });
    const second = lines({
      type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'second-lap-5678',
    });

    expect(first).toEqual(['·   build_review [first-la] testQuality started']);
    expect(second).toEqual(['·   build_review [second-l] testQuality started']);
    expect(first).not.toEqual(second);
  });

  it('renders a short lap identifier in full', () => {
    expect(lines({
      type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'lap',
    })).toEqual(['·   build_review [lap] testQuality started']);
  });

  it.each(['PASS', 'FAIL'] as const)('states a judged %s result', (verdict) => {
    expect(lines({
      type: 'build_review_rubric_result', rubric: 'testQuality', lapId: 'lap-12345678', verdict,
    })).toEqual([`·   build_review [lap-1234] testQuality ${verdict}`]);
  });

  it('renders a neutral skip with its reason verbatim', () => {
    const [line] = lines({
      type: 'build_review_rubric_skipped', rubric: 'testQuality', lapId: 'lap-12345678',
      reason: 'disabled by configuration',
    });

    expect(line).toBe('·   build_review [lap-1234] testQuality skipped: disabled by configuration');
    expect(line).not.toContain('FAIL');
    expect(line).not.toContain('failure');
  });

  it('names an agreeing outer verdict once', () => {
    expect(lines({
      type: 'build_review_outer_verdict', lapId: 'lap-12345678', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
    })).toEqual(['·   build_review [lap-1234] outer verdict: PASS']);
  });

  it('names both outer verdicts when the effective verdict differs', () => {
    expect(lines({
      type: 'build_review_outer_verdict', lapId: 'lap-12345678', rawVerdict: 'FAIL', effectiveVerdict: 'PASS',
    })).toEqual(['·   build_review [lap-1234] outer verdict: PASS (raw: FAIL)']);
  });

  it('includes an outer verdict reason only when supplied', () => {
    expect(lines({
      type: 'build_review_outer_verdict', lapId: 'lap-12345678', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
      reason: 'no enabled rubrics',
    })).toEqual(['·   build_review [lap-1234] outer verdict: PASS — no enabled rubrics']);
  });

  it('includes the unresolved-marker count only when supplied', () => {
    expect(lines({
      type: 'build_review_outer_verdict', lapId: 'lap-12345678', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
      unresolvedMarkers: [
        { selector: 'test/a.test.ts', reference: 'task:1' },
        { selector: 'test/b.test.ts', reference: 'task:2' },
      ],
    })).toEqual(['·   build_review [lap-1234] outer verdict: PASS — unresolved markers: 2']);
  });

  it('renders an infrastructure failure with its reason and optional excerpt', () => {
    expect(lines({
      type: 'build_review_rubric_infrastructure_failure', rubric: 'testQuality', lapId: 'lap-12345678',
      reason: 'scoped run timed out', excerpt: 'timed out after 30 seconds',
    })).toEqual([
      '·   build_review [lap-1234] testQuality infrastructure failure: scoped run timed out — timed out after 30 seconds',
    ]);
    expect(lines({
      type: 'build_review_rubric_infrastructure_failure', rubric: 'testQuality', lapId: 'lap-12345678',
      reason: 'scoped run timed out',
    })).toEqual(['·   build_review [lap-1234] testQuality infrastructure failure: scoped run timed out']);
  });

  it('keeps infrastructure failure distinct from judged failure in plain text', () => {
    const infrastructure = lines({
      type: 'build_review_rubric_infrastructure_failure', rubric: 'testQuality', lapId: 'lap-12345678',
      reason: 'scoped run timed out',
    });
    const judged = lines({
      type: 'build_review_rubric_result', rubric: 'testQuality', lapId: 'lap-12345678', verdict: 'FAIL',
    });

    expect(infrastructure).not.toEqual(judged);
    expect(infrastructure[0]).toContain('infrastructure failure');
  });

  it('renders every rubric event without serializing its payload', () => {
    const events: ConductorEvent[] = [
      { type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'lap-12345678' },
      { type: 'build_review_cache_hit', rubric: 'testQuality', lapId: 'lap-12345678' },
      { type: 'build_review_rubric_result', rubric: 'testQuality', lapId: 'lap-12345678', verdict: 'PASS' },
      { type: 'build_review_rubric_skipped', rubric: 'testQuality', lapId: 'lap-12345678', reason: 'disabled' },
      { type: 'build_review_rubric_infrastructure_failure', rubric: 'testQuality', lapId: 'lap-12345678', reason: 'timeout' },
      { type: 'build_review_outer_verdict', lapId: 'lap-12345678', rawVerdict: 'PASS', effectiveVerdict: 'PASS' },
    ];

    for (const event of events) {
      expect(lines(event)).toHaveLength(1);
      expect(lines(event)[0]).not.toContain('{');
    }
  });

  it('does not mutate a frozen rubric event', () => {
    const event = Object.freeze({
      type: 'build_review_rubric_started' as const, rubric: 'testQuality', lapId: 'lap-12345678',
    });
    const before = JSON.stringify(event);

    expect(() => lines(event)).not.toThrow();
    expect(JSON.stringify(event)).toBe(before);
  });
});
