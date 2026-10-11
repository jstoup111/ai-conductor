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

function lines(event: ConductorEvent, verbose = false): string[] {
  const out: string[] = [];
  renderDaemonEvent(event, (m) => out.push(m), { verbose });
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

  it('keeps routine attempt detail out of the default daemon log', () => {
    const [line] = lines({
      type: 'provider_attempt',
      step: 'build',
      provider: 'codex',
      model: 'gpt-5.6-terra',
      outcome: 'success',
      invoked: true,
    });
    expect(line).toContain('build via codex');
    expect(line).toContain('✓');
  });

  it('keeps the non-lifecycle attempt at one declared depth regardless of outcome', () => {
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
    expect(line).toBe('·   build via claude ✗ failure');
    expect(line).not.toContain('✓');
  });

  it('uses the same concise line for uninvoked attempts', () => {
    expect(lines({
      type: 'provider_attempt', step: 'build_review', provider: 'codex',
      outcome: 'failure', invoked: false,
      reason: 'Prepared candidate operation timed out before judgment.',
    })).toEqual(['·   build_review skipped codex (not-invoked: Prepared candidate operation timed out before judgment.)']);
  });

  it('does not put unavailable attempt detail in the default line', () => {
    expect(
      lines({
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: false,
        reason: 'cached run-wide unavailability',
      }),
    ).toEqual(['·   build skipped codex (unavailable: cached run-wide unavailability)']);
  });

  it('suppresses routine lifecycle phases and makes recovery actionable without ids', () => {
    for (const phase of ['preparing', 'running', 'settled'] as const) expect(lines({
      type: 'provider_attempt',
      step: 'build',
      provider: 'provider-lifecycle',
      outcome: 'success',
      invoked: false,
      lifecycle: { phase, attemptId: '123e4567-e89b-12d3-a456-426614174000', recoveryCount: 0 },
    })).toEqual([]);
    const recovering = lines({ type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', outcome: 'success', invoked: false, lifecycle: { phase: 'recovering', attemptId: '123e4567-e89b-12d3-a456-426614174000', recoveryCount: 1, reason: 'preparation-timeout' } });
    const exhausted = lines({ type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', outcome: 'success', invoked: false, lifecycle: { phase: 'exhausted', attemptId: '123e4567-e89b-12d3-a456-426614174000', recoveryCount: 2, reason: 'preparation-timeout' } });
    expect(recovering[0]).toContain('recovery 1 — preparation-timeout');
    expect(recovering[0]).toMatch(/ — no action needed: /);
    expect(exhausted[0]).toMatch(/✋ build provider halted .* — next: ai-conductor monitor all$/);
    expect([...recovering, ...exhausted].join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const phase of ['preparing', 'running', 'settled', 'recovering', 'exhausted'] as const) {
      expect(lines({ type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', outcome: 'success', invoked: false, lifecycle: { phase, attemptId: '123e4567-e89b-12d3-a456-426614174000', recoveryCount: 1, reason: 'preparation-timeout' } }, true).join('\n')).toContain('123e4567-e89b-12d3-a456-426614174000');
    }
  });
});

describe('renderDaemonEvent: feature_usage_total', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('qualifies a partial cost total as a sibling of the per-step provider lines', () => {
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
      '·   finish: total usage — 23 dispatches, $12.34 (21 cost-metered dispatches), 1.2M→48k tok, 2 unmetered',
    );
  });

  it('leaves a fully cost-metered total unqualified', () => {
    const [line] = lines({
      type: 'feature_usage_total',
      dispatches: 2,
      meteredDispatches: 2,
      unmeteredDispatches: 0,
      costUsd: 0.75,
      inputTokens: 120,
      outputTokens: 12,
    });
    expect(line).toBe('·   finish: total usage — 2 dispatches, $0.75, 120→12 tok');
  });
});
