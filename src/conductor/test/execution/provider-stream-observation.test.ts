import { describe, expect, it } from 'vitest';
import type { ProviderStreamObservation } from '../../src/execution/llm-provider.js';

describe('ProviderStreamObservation', () => {
  it('allows unsupported child observability without an active child count', () => {
    const observation: ProviderStreamObservation = {
      childObservability: 'unsupported',
      uncachedInputTokens: 120,
      outputTokens: 30,
    };

    expect(observation).toEqual({
      childObservability: 'unsupported',
      uncachedInputTokens: 120,
      outputTokens: 30,
    });
    expect(observation.activeChildren).toBeUndefined();
  });

  it('allows observed child observability with an active child count', () => {
    const observation: ProviderStreamObservation = {
      activeChildren: 2,
      childObservability: 'observed',
      uncachedInputTokens: 240,
      cachedInputTokens: 80,
      outputTokens: 60,
    };

    expect(observation.activeChildren).toBe(2);
    expect(observation.cachedInputTokens).toBe(80);
  });
});
