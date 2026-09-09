// Covers: task:1
import { describe, expect, it } from 'vitest';
import { DispatchMeteringTracker } from '../../src/engine/dispatch-metering.js';

describe('engine/dispatch-metering', () => {
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
});
