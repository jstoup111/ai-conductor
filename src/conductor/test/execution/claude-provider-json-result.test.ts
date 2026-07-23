import { describe, it, expect } from 'vitest';
import { parseJsonResult } from '../../src/execution/claude-provider';

describe('parseJsonResult', () => {
  it('parses a full result object with usage into output + tokenUsage', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'the text response',
      total_cost_usd: 0.023,
      duration_ms: 4213,
      num_turns: 3,
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 0,
      },
    });

    const result = parseJsonResult(stdout);

    expect(result.output).toBe('the text response');
    expect(result.tokenUsage).toEqual({
      input: 1200,
      output: 340,
      cacheRead: 500,
      cacheCreation: 0,
      costUsd: 0.023,
      numTurns: 3,
      durationMs: 4213,
    });
  });

  it('preserves result text with tokenUsage undefined when usage is missing', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'text only, no usage',
    });

    const result = parseJsonResult(stdout);

    expect(result.output).toBe('text only, no usage');
    expect(result.tokenUsage).toBeUndefined();
  });

  it('passes through raw stdout unchanged when JSON is unparseable', () => {
    const stdout = 'not json at all, just garbage output';

    const result = parseJsonResult(stdout);

    expect(result.output).toBe(stdout);
    expect(result.tokenUsage).toBeUndefined();
  });

  it('passes through raw stdout when parsed JSON has no string result field', () => {
    const stdout = JSON.stringify({ type: 'system', subtype: 'init' });

    const result = parseJsonResult(stdout);

    expect(result.output).toBe(stdout);
    expect(result.tokenUsage).toBeUndefined();
  });
});
