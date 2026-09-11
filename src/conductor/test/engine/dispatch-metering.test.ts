// Covers: task:1, task:6
import { describe, expect, it } from 'vitest';
import { DispatchMeteringTracker } from '../../src/engine/dispatch-metering.js';

describe('engine/dispatch-metering', () => {
  it('correlates interleaved configured executions without suppressing another member completion', () => {
    const tracker = new DispatchMeteringTracker();
    const qualityAudit = {
      executionId: 'quality-audit-1',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const securityAudit = {
      executionId: 'security-audit-1',
      subject: { kind: 'configured-member' as const, parentGroup: 'security', member: 'audit' },
    };

    expect([
      tracker.observe({
        type: 'provider_attempt', step: 'build', provider: 'codex', invoked: true, outcome: 'success',
        tokenUsage: { input: 10, output: 2 }, executionContext: qualityAudit,
      }),
      tracker.observe({
        type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
        executionContext: securityAudit,
      }),
      tracker.observe({
        type: 'group_member_step', member: 'audit', skill: 'build', phase: 'result', outcome: 'completed',
        executionContext: securityAudit,
      }),
      tracker.observe({
        type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', invoked: false, outcome: 'success',
        executionContext: securityAudit,
      }),
      tracker.observe({
        type: 'provider_attempt', step: 'build', provider: 'claude', invoked: false, outcome: 'success',
        executionContext: securityAudit,
      }),
      tracker.observe({
        type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
        executionContext: qualityAudit,
      }),
      tracker.observe({
        type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
      }),
      tracker.observe({ type: 'step_completed', step: 'build', unmetered: true }),
    ]).toEqual([
      {
        step: 'configured:quality/audit', provider: 'codex', tokenUsage: { input: 10, output: 2 },
      },
      { step: 'configured:security/audit', provider: 'codex', unmetered: true },
      undefined,
      undefined,
      undefined,
      undefined,
      { step: 'build', provider: 'codex', unmetered: true },
      undefined,
    ]);
  });

  it.each([
    ['provider-free unmetered completion', { unmetered: true }, undefined],
    ['provider-free completion', {}, undefined],
    ['empty provider evidence', { actualProvider: '' }, undefined],
    ['malformed token usage', { tokenUsage: { input: 10 } }, undefined],
    ['token usage', { tokenUsage: { input: 10, output: 2 }, unmetered: true }, {
      step: 'build', tokenUsage: { input: 10, output: 2 }, unmetered: true,
    }],
    ['actual provider', { actualProvider: 'codex', unmetered: true }, {
      step: 'build', provider: 'codex', unmetered: true,
    }],
    ['preferred provider', { preferredProvider: 'codex', unmetered: true }, {
      step: 'build', unmetered: true,
    }],
    ['model', { model: 'gpt-5.6-terra', unmetered: true }, {
      step: 'build', model: 'gpt-5.6-terra', unmetered: true,
    }],
  ] as const)('keeps unmatched completions only when they carry %s evidence', (
    _evidence,
    event,
    expected,
  ) => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({ type: 'step_completed', step: 'build', ...event })).toEqual(expected);
  });

  it('continues to suppress a completion matched to a successful provider attempt', () => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({
      type: 'provider_attempt', step: 'build', provider: 'codex', invoked: true, outcome: 'success',
    })).toEqual({ step: 'build', provider: 'codex' });
    expect(tracker.observe({
      type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
    })).toBeUndefined();
  });

  it('consumes only one successful attempt when matching completions', () => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({
      type: 'provider_attempt', step: 'build', provider: 'codex', invoked: true, outcome: 'success',
    })).toEqual({ step: 'build', provider: 'codex' });
    expect(tracker.observe({
      type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
    })).toBeUndefined();
    expect(tracker.observe({
      type: 'step_completed', step: 'build', actualProvider: 'codex', unmetered: true,
    })).toEqual({ step: 'build', provider: 'codex', unmetered: true });
  });

  it.each([
    ['an attempt with usage', {
      invoked: true, outcome: 'success', tokenUsage: { input: 10, output: 2 },
    }, {
      step: 'build', provider: 'codex', tokenUsage: { input: 10, output: 2 },
    }],
    ['an unmetered attempt', {
      invoked: true, outcome: 'success', unmetered: true,
    }, { step: 'build', provider: 'codex', unmetered: true }],
    ['a failed invoked attempt', {
      invoked: true, outcome: 'failure', unmetered: true,
    }, { step: 'build', provider: 'codex', unmetered: true }],
    ['a not-invoked attempt', {
      invoked: false, outcome: 'success', tokenUsage: { input: 10, output: 2 },
    }, undefined],
  ] as const)('keeps selection behavior for %s', (_case, event, expected) => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({
      type: 'provider_attempt', step: 'build', provider: 'codex', ...event,
    })).toEqual(expected);
  });

  it('carries preferred-provider fallback details from an invoked attempt', () => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({
      type: 'provider_attempt',
      step: 'build',
      provider: 'claude',
      preferredProvider: 'codex',
      fallbackReason: 'codex unavailable',
      invoked: true,
      outcome: 'success',
    })).toEqual({
      step: 'build',
      provider: 'claude',
      preferredProvider: 'codex',
      fallbackReason: 'codex unavailable',
    });
  });

  it('ignores lifecycle provider-attempt rows', () => {
    const tracker = new DispatchMeteringTracker();

    expect(tracker.observe({
      type: 'provider_attempt',
      step: 'build',
      provider: 'provider-lifecycle',
      preferredProvider: 'codex',
      fallbackReason: 'codex unavailable',
      invoked: false,
      outcome: 'success',
    })).toBeUndefined();
  });
});
