// Covers: task:1
import { describe, expect, it } from 'vitest';
import { DispatchMeteringTracker } from '../../src/engine/dispatch-metering.js';

describe('engine/dispatch-metering', () => {
  it.each([
    ['provider-free unmetered completion', { unmetered: true }, undefined],
    ['empty provider evidence', { actualProvider: '' }, undefined],
    ['malformed token usage', { tokenUsage: { input: 10 } }, undefined],
    ['token usage', { tokenUsage: { input: 10, output: 2 } }, {
      step: 'build', tokenUsage: { input: 10, output: 2 },
    }],
    ['actual provider', { actualProvider: 'codex' }, { step: 'build', provider: 'codex' }],
    ['preferred provider', { preferredProvider: 'codex' }, { step: 'build' }],
    ['model', { model: 'gpt-5.6-terra' }, { step: 'build', model: 'gpt-5.6-terra' }],
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
});
