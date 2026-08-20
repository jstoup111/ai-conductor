import { describe, expect, it } from 'vitest';

import type { ConductorEvent } from '../src/types/events.js';

describe('ConductorEvent provider stream progress', () => {
  it('accepts live intra-step events with optional measurements omitted or observed', () => {
    const unobserved: ConductorEvent = {
      type: 'provider_stream_progress',
      step: 'build',
      provider: 'codex',
      childObservability: 'unsupported',
      uncachedInputTokens: 120,
      outputTokens: 30,
      ts: '2026-08-20T12:00:00.000Z',
    };

    const observed: ConductorEvent = {
      type: 'provider_stream_progress',
      step: 'build',
      provider: 'claude',
      activeChildren: 2,
      childObservability: 'observed',
      uncachedInputTokens: 220,
      cachedInputTokens: 80,
      outputTokens: 40,
      ts: '2026-08-20T12:00:01.000Z',
    };

    expect([unobserved, observed]).toMatchObject([
      { type: 'provider_stream_progress', childObservability: 'unsupported' },
      {
        type: 'provider_stream_progress',
        activeChildren: 2,
        childObservability: 'observed',
        cachedInputTokens: 80,
      },
    ]);
  });
});
