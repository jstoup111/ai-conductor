import { describe, expect, it } from 'vitest';

import { accumulateProviderStreamTokens } from '../../src/execution/provider-stream.js';

describe('accumulateProviderStreamTokens', () => {
  it('accumulates numeric fresh, cached, and output tokens without changing totals for absent or nonnumeric usage', () => {
    expect(accumulateProviderStreamTokens([
      {
        type: 'assistant',
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 20,
        },
      },
      {
        type: 'assistant',
        usage: {
          input_tokens: 200,
          output_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      },
      {
        type: 'assistant',
        usage: {
          input_tokens: 300,
          output_tokens: 50,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 80,
        },
      },
      { type: 'assistant' },
      {
        type: 'assistant',
        usage: {
          input_tokens: 'not-a-number',
          output_tokens: null,
          cache_read_input_tokens: false,
          cache_creation_input_tokens: {},
        },
      },
    ])).toEqual({
      uncachedInputTokens: 600,
      cachedInputTokens: 200,
      outputTokens: 90,
    });
  });
});
