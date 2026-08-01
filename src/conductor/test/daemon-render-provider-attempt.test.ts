import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import chalk from 'chalk';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';
import type { ConductorEvent } from '../src/types/index.js';

// This repo routes providers per step (`llm_provider` top-level + per-step
// overrides). Before this line existed, an operator could not tell from
// daemon.log or `daemon status` whether a step was running under claude or
// codex without reading the subprocess argv out of `ps aux`.

function lines(event: ConductorEvent): string[] {
  const out: string[] = [];
  renderDaemonEvent(event, (m) => out.push(m));
  return out;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent: provider_attempt', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('names the provider and model that executed the step', () => {
    const [line] = lines({
      type: 'provider_attempt',
      step: 'build',
      provider: 'codex',
      model: 'gpt-5.6-terra',
      outcome: 'success',
      invoked: true,
    });
    expect(line).toContain('build via codex');
    expect(line).toContain('(gpt-5.6-terra)');
    expect(line).toContain('✓');
  });

  it('appends turn count, duration, and cost when the provider reported them', () => {
    const [line] = lines({
      type: 'provider_attempt',
      step: 'acceptance_specs',
      provider: 'claude',
      model: 'opus',
      outcome: 'success',
      invoked: true,
      tokenUsage: {
        input: 12_345,
        output: 4_100,
        numTurns: 54,
        durationMs: 486_825,
        costUsd: 4.956137999999998,
      },
    });
    expect(line).toBe('·   acceptance_specs via claude (opus) ✓ — 54 turns, 8m7s, $4.96');
  });

  it('renders a failed attempt with its outcome instead of a success glyph', () => {
    const [line] = lines({
      type: 'provider_attempt',
      step: 'build',
      provider: 'claude',
      outcome: 'failure',
      invoked: true,
      reason: 'exit 1',
    });
    expect(line).toContain('build via claude');
    expect(line).toContain('failure');
    expect(line).not.toContain('✓');
  });

  it('renders nothing for a cached availability skip that dispatched no process', () => {
    expect(
      lines({
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        reason: 'cached run-wide unavailability',
      }),
    ).toEqual([]);
  });

  it.each([
    [
      { phase: 'preparing', attemptId: 'attempt-1', recoveryCount: 0 },
      '·   build provider preparing (attempt attempt-1, recovery 0)',
    ],
    [
      { phase: 'running', attemptId: 'attempt-2', recoveryCount: 0 },
      '·   build provider running (attempt attempt-2, recovery 0)',
    ],
    [
      { phase: 'recovering', attemptId: 'attempt-3', recoveryCount: 1, reason: 'preparation-timeout' },
      '·   build provider recovering (attempt attempt-3, recovery 1 — preparation-timeout)',
    ],
    [
      { phase: 'exhausted', attemptId: 'attempt-4', recoveryCount: 1, reason: 'preparation-timeout-exhausted' },
      '· ✋ build provider halted (attempt attempt-4, recovery 1 — preparation-timeout-exhausted)',
    ],
  ] as const)('renders lifecycle diagnostics for %s', (lifecycle, expected) => {
    expect(lines({
      type: 'provider_attempt',
      step: 'build',
      provider: 'provider-lifecycle',
      outcome: 'success',
      invoked: false,
      lifecycle,
    })).toEqual([expected]);
  });
});

describe('renderDaemonEvent: feature_usage_total', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('logs the whole-feature totals as a sibling of the per-step provider lines', () => {
    const [line] = lines({
      type: 'feature_usage_total',
      dispatches: 23,
      meteredDispatches: 21,
      unmeteredDispatches: 2,
      costUsd: 12.3449,
      inputTokens: 1_200_000,
      outputTokens: 48_000,
    });
    expect(line).toBe(
      '·   finish: total usage — 23 dispatches, $12.34, 1.2M→48k tok, 2 unmetered',
    );
  });
});
