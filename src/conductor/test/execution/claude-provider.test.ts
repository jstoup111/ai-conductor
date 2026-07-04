import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

// Mock execa before importing anything that uses it
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
const mockExeca = vi.mocked(execa);

describe('ClaudeProvider', () => {
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

  describe('invoke', () => {
    it('builds correct args for first call (not resume)', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, resume: false, dangerouslySkipPermissions: true });

      expect(mockExeca).toHaveBeenCalledOnce();
      const [cmd, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(cmd).toBe('claude');
      expect(args).toContain('--session-id');
      expect(args).toContain('abc-123');
      expect(args).not.toContain('--resume');
    });

    it('passes stdin: ignore to execa so Claude does not wait on piped stdin', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: true });

      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts).toMatchObject({ stdin: 'ignore' });
    });

    it('builds correct args for resume call', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, resume: true, dangerouslySkipPermissions: true });

      const [, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(args).toContain('--resume');
      expect(args).toContain('abc-123');
    });

    it('includes --dangerously-skip-permissions when specified', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: true });

      const [, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('excludes --dangerously-skip-permissions when not specified', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: false });

      const [, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('detects rate limit in output', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Error: rate limit exceeded',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects stale session in output', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'No conversation found for this session',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.sessionExpired).toBe(true);
    });

    it('treats a session-in-use lock as recoverable (sessionExpired)', async () => {
      for (const msg of [
        'Error: Session abc-123 is already in use',
        'This conversation is currently in use by another process',
      ]) {
        mockExeca.mockResolvedValue({ stdout: msg, exitCode: 1, failed: true } as any);
        const result = await provider.invoke(baseOptions);
        expect(result.sessionExpired).toBe(true);
      }
    });

    it('returns success for exit code 0', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Done!',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.success).toBe(true);
      expect(result.output).toBe('Done!');
      expect(result.exitCode).toBe(0);
    });

    it('returns failure with clear message when claude binary not found', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'ENOENT',
        exitCode: 127,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.success).toBe(false);
      expect(result.output).toMatch(/not found/i);
    });

    it('detects model-unavailable from a not_found_error API response', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr:
          'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-bogus"}}',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.modelUnavailable).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects model-unavailable from an "Invalid model name" CLI message', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Invalid model name: bogus',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.modelUnavailable).toBe(true);
      expect(result.success).toBe(false);
    });

    it('does not flag modelUnavailable for "model" appearing in unrelated prose', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'error: model output truncated mid-stream',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.modelUnavailable).toBeUndefined();
    });

    it('flags rateLimited (not modelUnavailable) for a 429 overloaded response', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Error: 429 overloaded, please retry later',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.modelUnavailable).toBeUndefined();
    });

    it('does not flag modelUnavailable when the binary is missing (exit 127/ENOENT)', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'ENOENT',
        exitCode: 127,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.success).toBe(false);
      expect(result.output).toMatch(/not found/i);
      expect(result.modelUnavailable).toBeUndefined();
    });

    it('detects auth failure from "Not logged in" message', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Error: Not logged in',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects auth failure from "Please run /login" message', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Please run /login to authenticate',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects auth failure from "Invalid API key" message', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Invalid API key',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
    });

    it('includes --name when sessionName provided', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, sessionName: 'my-feature' });

      const [, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(args).toContain('--name');
      expect(args).toContain('my-feature');
    });
  });

  describe('effort env var', () => {
    it('passes CLAUDE_CODE_EFFORT_LEVEL via execa env when effort set', async () => {
      mockExeca.mockResolvedValue({ stdout: '', exitCode: 0, failed: false } as any);

      await provider.invoke({ ...baseOptions, effort: 'xhigh' });

      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts.env).toBeDefined();
      expect(opts.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('xhigh');
    });

    it('omits env overlay when effort is not set (inherits parent env)', async () => {
      mockExeca.mockResolvedValue({ stdout: '', exitCode: 0, failed: false } as any);

      await provider.invoke({ ...baseOptions });

      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts.env).toBeUndefined();
    });

    it('invokeInteractive also forwards the effort env var', async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 } as any);

      await provider.invokeInteractive({ ...baseOptions, effort: 'high' });

      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts.env?.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
    });

    it('ignores stdin in print mode so `claude -p` cannot hang on TTY stdin', async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 } as any);
      await provider.invokeInteractive({ ...baseOptions, interactive: false });
      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts.stdio).toEqual(['ignore', 'inherit', 'inherit']);
    });

    it('inherits all stdio in REPL mode so the user can type', async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 } as any);
      await provider.invokeInteractive({ ...baseOptions, interactive: true });
      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts.stdio).toBe('inherit');
    });
  });
});
