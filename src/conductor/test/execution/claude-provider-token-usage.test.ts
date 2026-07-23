import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
const mockExeca = vi.mocked(execa);

describe('ClaudeProvider tokenUsage parsing', () => {
  let provider: ClaudeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeProvider();
  });

  const baseOptions: InvokeOptions = {
    prompt: 'Do the thing',
    sessionId: 'abc-123',
    resume: false,
  };

  it('parses tokenUsage from a claude --output-format json result payload', async () => {
    const jsonResult = JSON.stringify({
      result: 'Done!',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      total_cost_usd: 0.05,
      num_turns: 3,
      duration_ms: 1200,
    });

    mockExeca.mockResolvedValue({
      stdout: jsonResult,
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.output).toBe('Done!');
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage?.input).toBe(100);
    expect(result.tokenUsage?.output).toBe(50);
    expect(result.tokenUsage?.cacheCreation).toBe(10);
    expect(result.tokenUsage?.cacheRead).toBe(5);
    expect(result.tokenUsage?.costUsd).toBe(0.05);
    expect(result.tokenUsage?.numTurns).toBe(3);
    expect(result.tokenUsage?.durationMs).toBe(1200);
  });

  it('returns tokenUsage as undefined and falls back to raw stdout when output is not JSON', async () => {
    mockExeca.mockResolvedValue({
      stdout: 'plain text output',
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage).toBeUndefined();
    expect(result.output).toBe('plain text output');
  });

  it('does not crash and falls back to raw stdout on malformed JSON', async () => {
    mockExeca.mockResolvedValue({
      stdout: 'not valid json {{{',
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage).toBeUndefined();
    expect(result.output).toBe('not valid json {{{');
  });

  it('parses tokenUsage with zero cache values', async () => {
    const jsonResult = JSON.stringify({
      result: 'Done!',
      usage: {
        input_tokens: 200,
        output_tokens: 75,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    mockExeca.mockResolvedValue({
      stdout: jsonResult,
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage?.input).toBe(200);
    expect(result.tokenUsage?.output).toBe(75);
    expect(result.tokenUsage?.cacheCreation).toBe(0);
    expect(result.tokenUsage?.cacheRead).toBe(0);
  });

  it('invokes claude with --output-format json (not text)', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({ result: 'ok' }),
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    await provider.invoke(baseOptions);

    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--print', '--output-format', 'json']),
      expect.anything()
    );
    const [, args] = mockExeca.mock.calls[0];
    expect(args).not.toContain('text');
  });
});
