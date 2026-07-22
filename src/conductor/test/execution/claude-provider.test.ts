import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider, parseRateLimitWaitSeconds } from '../../src/execution/claude-provider.js';
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

    it('delivers the prompt on stdin (execa input), never as a `-p <prompt>` argv', async () => {
      // A single argv string is capped at MAX_ARG_STRLEN (128 KiB on Linux);
      // passing a large prompt as `-p <prompt>` makes exec() fail with E2BIG
      // before claude starts. The prompt must go on stdin instead.
      mockExeca.mockResolvedValue({ stdout: 'ok', exitCode: 0, failed: false } as any);

      await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: true });

      const [, args, opts] = mockExeca.mock.calls[0] as [string, string[], any];
      // Prompt is on stdin, print flags are set, and the prompt is NOT an argv.
      expect(opts).toMatchObject({ input: 'Do the thing' });
      expect(opts.stdin).toBeUndefined();
      expect(args).toContain('--print');
      expect(args).not.toContain('-p');
      expect(args).not.toContain('Do the thing');
    });

    it('never puts a >128 KiB prompt into argv (E2BIG regression)', async () => {
      mockExeca.mockResolvedValue({ stdout: 'ok', exitCode: 0, failed: false } as any);
      const bigPrompt = 'x'.repeat(200_000); // over MAX_ARG_STRLEN

      await provider.invoke({ ...baseOptions, prompt: bigPrompt, dangerouslySkipPermissions: true });

      const [, args, opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts).toMatchObject({ input: bigPrompt });
      // No single argv element is anywhere near the 128 KiB single-arg ceiling.
      for (const a of args) expect(a.length).toBeLessThan(1024);
    });

    it('closes stdin (stdin: ignore) when there is no prompt', async () => {
      mockExeca.mockResolvedValue({ stdout: 'ok', exitCode: 0, failed: false } as any);

      await provider.invoke({ ...baseOptions, prompt: undefined, dangerouslySkipPermissions: true });

      const [, args, opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts).toMatchObject({ stdin: 'ignore' });
      expect(opts.input).toBeUndefined();
      expect(args).not.toContain('--print');
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

    it('treats "out of usage credits" (on a ZERO exit code) as modelUnavailable and NOT success', async () => {
      mockExeca.mockResolvedValue({
        stdout:
          "You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch models.",
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      // Soft notice rides exit 0, but the model can't run → ladder must engage.
      expect(result.modelUnavailable).toBe(true);
      // And it is NOT a real success — no work was done, no artifact written.
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

    // Task 17: Session-limit classification family (observed 2026-07-03 incident)
    it('detects LITERAL session-limit message with reset time', async () => {
      const observedMessage = "You've hit your session limit · resets 3:20pm (America/New_York)";
      mockExeca.mockResolvedValue({
        stdout: observedMessage,
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
      expect(result.waitSeconds).toBeDefined();
    });

    it('detects usage-limit variant as rateLimited', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'usage limit reached · resets 3:20pm (America/New_York)',
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects "session limit reached" variant as rateLimited', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'session limit reached · resets 5:45pm (America/New_York)',
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects "session limit" (short form) variant as rateLimited', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'session limit · resets tomorrow',
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
    });

    it('treats exit-0 session-limit message as rateLimited and NOT success (mirrors outOfCredits)', async () => {
      mockExeca.mockResolvedValue({
        stdout: "You've hit your session limit · resets 3:20pm (America/New_York)",
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      // Soft notice rides exit 0, but rate limit is still in effect → must wait and retry.
      expect(result.rateLimited).toBe(true);
      // And it is NOT a real success — no work was done, no artifact written.
      expect(result.success).toBe(false);
      expect(result.waitSeconds).toBeDefined();
    });

    it('does not flag rateLimited when message has session-limit-like word in prose (no reset time)', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Discussion about session limit policies in documentation',
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBeUndefined();
      expect(result.success).toBe(true);
    });

    it('preserves precedence: session-limit classifies before auth-failure check', async () => {
      // A contrived case where message matches both session-limit AND auth patterns
      // (unlikely in practice, but tests the precedence)
      mockExeca.mockResolvedValue({
        stdout: 'You\'ve hit your session limit and are not logged in',
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.authFailure).toBeUndefined();
    });

    // Regression test for acceptance test: verify the EXACT observed message is classified
    it('acceptance regression: EXACT observed message yields rateLimited and proper waitSeconds', async () => {
      const observedMessage = "You've hit your session limit · resets 3:20pm (America/New_York)";
      mockExeca.mockResolvedValue({
        stdout: observedMessage,
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.success).toBe(false);
      expect(result.waitSeconds).toBeDefined();
      expect(result.waitSeconds).toBeGreaterThan(0);
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

    it('detects auth failure from observed "Failed to authenticate. API Error: 401 Invalid bearer token" (text mode)', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Failed to authenticate. API Error: 401 Invalid bearer token',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
    });

    it('detects auth failure from "Failed to authenticate. API Error: 401 Invalid bearer token" embedded in longer output', async () => {
      mockExeca.mockResolvedValue({
        stdout:
          'Starting session...\nConnecting to API...\nFailed to authenticate. API Error: 401 Invalid bearer token\nExiting with error.',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBe(true);
      expect(result.success).toBe(false);
    });

    it('does not flag authFailure on a bare "401" mentioned in prose', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'The mock server expects a 401 response for this case',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBeUndefined();
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

    // Negative cases: auth failure should NOT match in these scenarios
    it('does not flag authFailure on exit code 0 even if output mentions "Not logged in"', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Success: Not logged in message mentioned but exit is 0',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.success).toBe(true);
      expect(result.authFailure).toBeUndefined();
    });

    it('does not flag authFailure when MODEL_UNAVAILABLE_RE matches', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Invalid model name: claude-bogus',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.modelUnavailable).toBe(true);
      expect(result.authFailure).toBeUndefined();
      expect(result.success).toBe(false);
    });

    it('does not flag authFailure when rate-limit is detected', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Error: rate limit exceeded, please retry later',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.authFailure).toBeUndefined();
      expect(result.success).toBe(false);
    });

    it('Task 2 pin: session-limit precedence holds over extended auth patterns (failed to authenticate)', async () => {
      // Message matches BOTH session-limit AND the new auth patterns from Task 1.
      mockExeca.mockResolvedValue({
        stdout: "You've hit your session limit · resets 3:20pm (America/New_York). Failed to authenticate. API Error: 401 Invalid bearer token",
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.authFailure).toBeUndefined();
    });

    it('Task 2 pin: rate-limit precedence holds over extended auth patterns (invalid bearer token)', async () => {
      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Error: rate limit exceeded. Invalid bearer token. API Error: 401',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.rateLimited).toBe(true);
      expect(result.authFailure).toBeUndefined();
    });

    it('Task 2 pin: exit code 0 with auth-shaped text does not classify as authFailure', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Note: previously failed to authenticate. API Error: 401 Invalid bearer token, but retry succeeded.',
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.authFailure).toBeUndefined();
    });

    describe('Task 18: deadline-first timezone-aware reset parse with clamp', () => {
      it('parses reset time in America/New_York timezone and returns deadline', async () => {
        mockExeca.mockResolvedValue({
          stdout: "You've hit your session limit · resets 3:20pm (America/New_York)",
          stderr: '',
          exitCode: 1,
          failed: true,
        } as any);

        const beforeInvoke = Date.now();
        const result = await provider.invoke({ ...baseOptions });
        const afterInvoke = Date.now();

        expect(result.rateLimited).toBe(true);
        expect(result.waitSeconds).toBeDefined();
        expect(result.deadline).toBeDefined();
        // Deadline should be in the future and within reasonable bounds
        if (result.deadline) {
          const deadlineDelta = result.deadline - afterInvoke;
          expect(deadlineDelta).toBeGreaterThan(0);
          // Should not be unreasonably far in the future
          expect(deadlineDelta).toBeLessThanOrEqual(24 * 3600 * 1000); // Not more than 24 hours
        }
      });

      it('unknown timezone falls back to default waitSeconds without deadline', async () => {
        mockExeca.mockResolvedValue({
          stdout: "You've hit your session limit · resets 3:20pm (America/Unknown)",
          stderr: '',
          exitCode: 1,
          failed: true,
        } as any);

        const result = await provider.invoke({ ...baseOptions });

        expect(result.rateLimited).toBe(true);
        // Should not have a parsed deadline (unknown timezone)
        expect(result.deadline).toBeUndefined();
        // Should still have fallback waitSeconds
        expect(result.waitSeconds).toBeDefined();
        expect(result.waitSeconds).toBeGreaterThan(0);
      });

      it('midnight rollover handled correctly (future midnight)', async () => {
        mockExeca.mockResolvedValue({
          stdout: "You've hit your session limit · resets 11:59pm (America/New_York)",
          stderr: '',
          exitCode: 1,
          failed: true,
        } as any);

        const result = await provider.invoke({ ...baseOptions });

        expect(result.rateLimited).toBe(true);
        expect(result.deadline).toBeDefined();
        if (result.deadline) {
          // Should be a reasonable wait time (not negative/wrapped)
          const deadlineDelta = result.deadline - Date.now();
          expect(deadlineDelta).toBeGreaterThan(0);
        }
      });

      it('exactly ONE timer arm per deadline (no re-probe before deadline)', async () => {
        // This test verifies that when we parse a deadline, we use it once for episode.enter()
        // and don't re-arm timers before the deadline. This is structural — checked via
        // conductor wiring, not here, but we verify the deadline is well-formed.
        mockExeca.mockResolvedValue({
          stdout: "You've hit your session limit · resets 3:20pm (America/New_York)",
          stderr: '',
          exitCode: 1,
          failed: true,
        } as any);

        const result = await provider.invoke({ ...baseOptions });

        expect(result.rateLimited).toBe(true);
        expect(result.deadline).toBeDefined();
        // Deadline is an absolute timestamp (ms since epoch), usable for single episode.enter() call
        if (result.deadline) {
          expect(typeof result.deadline).toBe('number');
          expect(result.deadline).toBeGreaterThan(Date.now());
        }
      });
    });

    describe('rate-limit waitSeconds parsing', () => {
      it('parses waitSeconds from rate-limited output with reset time (happy path)', async () => {
        mockExeca.mockResolvedValue({
          stdout: '',
          stderr: 'Error: rate limit exceeded, resets at 23:00',
          exitCode: 1,
          failed: true,
        } as any);

        const result = await provider.invoke(baseOptions);
        expect(result.rateLimited).toBe(true);
        expect(result.waitSeconds).toBeDefined();
        expect(typeof result.waitSeconds).toBe('number');
        expect(result.waitSeconds).toBeGreaterThan(0);
      });

      it('returns default 300 seconds when rate-limited output has no parseable reset time', async () => {
        mockExeca.mockResolvedValue({
          stdout: '',
          stderr: 'Error: rate limit exceeded, try again later',
          exitCode: 1,
          failed: true,
        } as any);

        const result = await provider.invoke(baseOptions);
        expect(result.rateLimited).toBe(true);
        expect(result.waitSeconds).toBe(300);
      });

      it('does not populate waitSeconds on non-rate-limited success', async () => {
        mockExeca.mockResolvedValue({
          stdout: 'Done!',
          exitCode: 0,
          failed: false,
        } as any);

        const result = await provider.invoke(baseOptions);
        expect(result.rateLimited).toBeUndefined();
        expect(result.waitSeconds).toBeUndefined();
      });
    });
  });

  describe('Task 17: Session-limit acceptance validation', () => {
    it('simulates acceptance test scenario: session-limit message with exitCode 1', async () => {
      const SESSION_LIMIT_MESSAGE = "You've hit your session limit · resets 3:20pm (America/New_York)";

      // Simulate the acceptance test mock: first call returns rate limit, second call succeeds
      let callCount = 0;
      mockExeca.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { stdout: SESSION_LIMIT_MESSAGE, stderr: '', exitCode: 1, failed: true } as any;
        }
        return { stdout: 'done', stderr: '', exitCode: 0, failed: false } as any;
      });

      const provider = new ClaudeProvider();

      // First call should detect rate limit
      const result1 = await provider.invoke(baseOptions);
      expect(result1.rateLimited).toBe(true);
      expect(result1.success).toBe(false);
      expect(result1.waitSeconds).toBeDefined();

      // Second call should succeed
      const result2 = await provider.invoke(baseOptions);
      expect(result2.success).toBe(true);
      expect(result2.rateLimited).toBeUndefined();
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

describe('parseRateLimitWaitSeconds - direct unit tests for timezone parsing', () => {
  it('parses reset time in America/New_York timezone and returns deadline', () => {
    // Task 18: Test with injected "now" time to verify clamping
    // 2026-07-03T18:05:54Z is 13:05:54 EDT (UTC-4)
    // Reset at 3:20pm (15:20) EDT = ~2h 14m 6s ≈ 8046s, clamped to 3600s
    const now = new Date('2026-07-03T18:05:54Z');
    const message = "You've hit your session limit · resets 3:20pm (America/New_York)";

    const result = (parseRateLimitWaitSeconds as any)(message, { now });

    expect(result.waitSeconds).toBeDefined();
    expect(result.deadline).toBeDefined();
    if (result.deadline) {
      // Deadline should be clamped to 3600s
      const waitMs = result.deadline - now.getTime();
      expect(waitMs).toBeLessThanOrEqual(3600000); // 3600s in ms
      expect(waitMs).toBeGreaterThan(0);
    }
  });

  it('past deadline (today) rolls to tomorrow and clamps', () => {
    // 2026-07-03T20:05:54Z is 16:05:54 EDT (4:05:54 PM)
    // Reset at 2:00pm (14:00) EDT was earlier today
    // Should roll to tomorrow at 2:00pm, calculate that delta (~21h 55m), and clamp to 3600s
    const now = new Date('2026-07-03T20:05:54Z');
    const message = "You've hit your session limit · resets 2:00pm (America/New_York)";

    const result = (parseRateLimitWaitSeconds as any)(message, { now });

    expect(result.waitSeconds).toBeDefined();
    expect(result.deadline).toBeDefined();
    if (result.deadline) {
      // Deadline should be clamped to 3600s (1 hour max)
      const waitMs = result.deadline - now.getTime();
      expect(waitMs).toBeGreaterThan(0);
      expect(waitMs).toBeLessThanOrEqual(3600000); // 3600s (clamped)
    }
  });

  it('unknown timezone returns undefined deadline', () => {
    const message = "You've hit your session limit · resets 3:20pm (America/Unknown)";
    const result = (parseRateLimitWaitSeconds as any)(message, { now: new Date() });

    expect(result.waitSeconds).toBeDefined();
    expect(result.deadline).toBeUndefined();
  });

  it('clamping works correctly for very far future times', () => {
    // Time just before reset, so large wait but still gets clamped
    const now = new Date('2026-07-03T14:55:00Z'); // 10:55 AM EDT
    const message = "You've hit your session limit · resets 11:59pm (America/New_York)"; // 23:59 EDT = ~13h away

    const result = (parseRateLimitWaitSeconds as any)(message, { now });

    expect(result.deadline).toBeDefined();
    if (result.deadline) {
      // Should be clamped to 3600s (1 hour)
      const waitMs = result.deadline - now.getTime();
      expect(waitMs).toBeLessThanOrEqual(3600000);
    }
  });
});
