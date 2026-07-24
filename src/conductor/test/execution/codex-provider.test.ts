import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexProvider,
  parseCodexJsonl,
} from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// This is a fake Codex CLI boundary: no test invokes a locally installed Codex.
vi.mock('execa', () => ({ execa: vi.fn() }));
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

const baseOptions: InvokeOptions = {
  prompt: 'Make the no-op change',
  systemPrompt: 'You are the conductor.',
  sessionId: 'thread-123',
  resume: false,
  cwd: '/workspace/project',
};

function jsonlMessage(text: string): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 7 },
    }),
  ].join('\n');
}

describe('CodexProvider', () => {
  let provider: CodexProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CodexProvider();
  });

  it('runs a fresh Codex exec with JSONL, model, cwd, and stdin prompt delivery', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('No-op complete.'), exitCode: 0 } as any);

    const result = await provider.invoke({
      ...baseOptions,
      model: 'gpt-5.4',
      effort: 'high',
      dangerouslySkipPermissions: true,
    });

    const [command, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(command).toBe('codex');
    expect(args).toEqual(expect.arrayContaining(['exec', '--json', '--model', 'gpt-5.4', '--cd', '/workspace/project', '-']));
    expect(args).toEqual(expect.arrayContaining(['--config', 'model_reasoning_effort="high"']));
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain(baseOptions.prompt);
    expect(options.input).toBe('You are the conductor.\n\nMake the no-op change');
    expect(options.cwd).toBe('/workspace/project');
    expect(result).toMatchObject({ success: true, output: 'No-op complete.', exitCode: 0 });
    expect(result.tokenUsage).toEqual({ input: 12, cacheRead: 4, output: 7 });
  });

  it('resumes the requested Codex session and continues using stdin', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Resumed.'), exitCode: 0 } as any);

    await provider.invoke({ ...baseOptions, resume: true });

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-123']);
    expect(args).not.toContain('--cd');
    expect(args).toContain('-');
    expect(options.cwd).toBe('/workspace/project');
  });

  it('keeps a >128 KiB prompt out of argv', async () => {
    mockExeca.mockResolvedValue({ stdout: jsonlMessage('Done.'), exitCode: 0 } as any);
    const prompt = 'x'.repeat(200_000);

    await provider.invoke({ ...baseOptions, prompt });

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(options.input).toContain(prompt);
    for (const arg of args) expect(arg.length).toBeLessThan(1024);
  });

  it.each([
    ['missing binary', { stdout: '', stderr: 'spawn codex ENOENT', exitCode: 127 }, 'output'],
    ['authentication failure', { stdout: '', stderr: 'Authentication required. Please run codex login.', exitCode: 1 }, 'authFailure'],
    ['rate limit', { stdout: '', stderr: 'Error 429: rate limit exceeded; retry after 45 seconds', exitCode: 1 }, 'rateLimited'],
    ['model unavailable', { stdout: '', stderr: 'Requested model gpt-nope is not available', exitCode: 1 }, 'modelUnavailable'],
    ['expired session', { stdout: '', stderr: 'Thread not found; cannot resume this session', exitCode: 1 }, 'sessionExpired'],
  ])('classifies %s from fake CLI output', async (_name, response, expectedFlag) => {
    mockExeca.mockResolvedValue(response as any);

    const result = await provider.invoke({ ...baseOptions, resume: true });

    expect(result.success).toBe(false);
    if (expectedFlag === 'output') {
      expect(result.output).toMatch(/codex.*not found/i);
    } else {
      expect(result[expectedFlag as keyof typeof result]).toBe(true);
    }
    if (expectedFlag === 'rateLimited') expect(result.waitSeconds).toBe(45);
  });

  it('streams a one-shot exec for interface-compatible interactive calls', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0 } as any);

    await provider.invokeInteractive(baseOptions);

    const [, args, options] = mockExeca.mock.calls[0] as [string, string[], any];
    expect(args).toEqual(expect.arrayContaining(['exec', '-']));
    expect(args).not.toContain('--json');
    expect(options.stdio).toEqual(['pipe', 'inherit', 'inherit']);
  });
});

describe('parseCodexJsonl', () => {
  it('uses the final agent message instead of returning raw event JSON', () => {
    expect(parseCodexJsonl(jsonlMessage('Final answer.')).output).toBe('Final answer.');
  });

  it('falls back to plain output when Codex emits a non-JSON diagnostic', () => {
    expect(parseCodexJsonl('plain diagnostic').output).toBe('plain diagnostic');
  });
});
