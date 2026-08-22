import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider, parseJsonResult } from '../../src/execution/claude-provider';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

describe('Claude stream JSON result parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('passes through a stream with no terminal result record', async () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
    ].join('\n');
    mockExeca.mockResolvedValue({ stdout, stderr: '', exitCode: 0, failed: false } as any);

    const result = await new ClaudeProvider().invoke({ prompt: 'Do the thing', sessionId: 'abc-123', resume: false });

    expect(result).toMatchObject({ output: stdout, tokenUsage: undefined });
  });

  it('leaves token usage undefined when the terminal result omits input tokens', async () => {
    const stdout = JSON.stringify({
      type: 'result',
      result: 'text without complete usage',
      usage: { output_tokens: 7 },
    });
    mockExeca.mockResolvedValue({ stdout, stderr: '', exitCode: 0, failed: false } as any);

    const result = await new ClaudeProvider().invoke({ prompt: 'Do the thing', sessionId: 'abc-123', resume: false });

    expect(result).toMatchObject({ output: 'text without complete usage', tokenUsage: undefined });
  });

  it('passes through raw stdout when the terminal stream line is malformed', async () => {
    const stdout = [
      JSON.stringify({ type: 'result', result: 'stale result', usage: { input_tokens: 1, output_tokens: 1 } }),
      '{"type":"result","result":',
    ].join('\n');
    mockExeca.mockResolvedValue({ stdout, stderr: '', exitCode: 0, failed: false } as any);

    const result = await new ClaudeProvider().invoke({ prompt: 'Do the thing', sessionId: 'abc-123', resume: false });

    expect(result).toMatchObject({ output: stdout, tokenUsage: undefined });
  });
});
