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

  it('parses tokenUsage from stream-json usage event in stdout', async () => {
    const streamLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc', tools: [], mcp_servers: [] }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] }, session_id: 'abc' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Done!', session_id: 'abc', is_error: false }),
      JSON.stringify({ type: 'usage', input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 }),
    ].join('\n');

    mockExeca.mockResolvedValue({
      stdout: streamLines,
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage?.input).toBe(100);
    expect(result.tokenUsage?.output).toBe(50);
    expect(result.tokenUsage?.cacheCreation).toBe(10);
    expect(result.tokenUsage?.cacheRead).toBe(5);
  });

  it('returns tokenUsage as undefined when no usage event in stdout', async () => {
    mockExeca.mockResolvedValue({
      stdout: 'plain text output',
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage).toBeUndefined();
  });

  it('does not crash when stdout has partial or malformed lines', async () => {
    const streamLines = [
      'not valid json',
      JSON.stringify({ type: 'usage', input_tokens: 42, output_tokens: 8 }),
    ].join('\n');

    mockExeca.mockResolvedValue({
      stdout: streamLines,
      stderr: '',
      exitCode: 0,
      failed: false,
    } as any);

    const result = await provider.invoke(baseOptions);
    expect(result.tokenUsage?.input).toBe(42);
    expect(result.tokenUsage?.output).toBe(8);
  });

  it('parses tokenUsage with zero cache values', async () => {
    const usageLine = JSON.stringify({
      type: 'usage',
      input_tokens: 200,
      output_tokens: 75,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    mockExeca.mockResolvedValue({
      stdout: usageLine,
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
});
