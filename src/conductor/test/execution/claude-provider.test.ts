import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ClaudeProvider, parseRateLimitWaitSeconds } from '../../src/execution/claude-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { IntervalClock } from '../../src/execution/observed-interval.js';

// Mock execa before importing anything that uses it
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const { mockValidateSpawnPermit } = vi.hoisted(() => ({
  mockValidateSpawnPermit: vi.fn((permit, purpose) =>
    permit?.(purpose) ?? { permitted: true as const }),
}));
vi.mock('../../src/engine/provider-runtime.js', () => ({
  validateSpawnPermit: mockValidateSpawnPermit,
}));

import { execa, type Options as ExecaOptions, type Result as ExecaResult } from 'execa';

/**
 * `execa`'s exported type is an intersection of several call-signature
 * overloads (template-tag, options-bind, `(file, args, options)`,
 * `(file, options)`). `Parameters<>`/`ReturnType<>` on such an intersection
 * collapse to the LAST overload, and the real `ResultPromise` return type
 * carries subprocess-only members (`.pipe`, etc.) that a plain mock never
 * implements. This codebase only ever calls execa in the 3-arg
 * `(file, args, options)` form and only ever awaits the plain result, so the
 * mock is re-typed to that actual call shape via `unknown` to bridge past
 * execa's overload-collapsing type limitation.
 */
type ExecaInvocation = (
  file: string,
  args: string[],
  options?: ExecaOptions,
) => Promise<ExecaResult>;
const mockExeca = vi.mocked(execa) as unknown as Mock<ExecaInvocation>;

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
    it('declares synchronous spawn-permit lifecycle capability', () => {
      expect(provider.lifecycleCapability).toEqual({ synchronousSpawnPermit: true });
    });

    it('reports spawn as a zero-argument observation', async () => {
      const onSpawn = vi.fn();
      mockExeca.mockResolvedValue({ stdout: 'Done.', stderr: '', exitCode: 0, failed: false } as any);

      await provider.invoke({ ...baseOptions, onSpawn });

      expect(onSpawn.mock.calls).toEqual([[]]);
    });

    it('checks a current permit immediately before the injected subprocess factory', async () => {
      const callOrder: string[] = [];
      const subprocessFactory = vi.fn(() => {
        callOrder.push('subprocess factory');
        return Promise.resolve({ stdout: 'ok', exitCode: 0, failed: false }) as any;
      });
      const spawnPermit = vi.fn(() => {
        callOrder.push('spawn permit');
        return { permitted: true as const };
      });
      provider = new ClaudeProvider(undefined, subprocessFactory);

      await provider.invoke({ ...baseOptions, spawnPermit });

      expect(callOrder).toEqual(['spawn permit', 'subprocess factory']);
      expect(mockValidateSpawnPermit).toHaveBeenCalledWith(spawnPermit);
    });

    it('fails closed without creating a child when its permit is revoked', async () => {
      const subprocessFactory = vi.fn(() =>
        Promise.resolve({ stdout: 'ok', exitCode: 0, failed: false }) as any,
      );
      provider = new ClaudeProvider(undefined, subprocessFactory);

      await expect(
        provider.invoke({
          ...baseOptions,
          spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
        }),
      ).rejects.toThrow('Claude process spawn denied: revoked');

      expect(subprocessFactory).not.toHaveBeenCalled();
    });

    it('returns the successful subprocess interval without changing output or provider usage', async () => {
      const readings = [1_000, 1_025];
      const clock: IntervalClock = {
        nowMs: () => readings.shift() ?? (() => { throw new Error('scripted clock exhausted'); })(),
      };
      provider = new ClaudeProvider(clock);
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({
          result: 'Done!',
          usage: { input_tokens: 12, output_tokens: 7 },
          duration_ms: 20,
        }),
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);

      expect(result).toMatchObject({
        success: true,
        output: 'Done!',
        exitCode: 0,
        tokenUsage: { input: 12, output: 7, durationMs: 20 },
        observedIntervals: [{ startedAtMs: 1_000, durationMs: 25 }],
      });
    });

    it('returns the interactive subprocess interval without changing completion classification', async () => {
      const readings = [2_000, 2_040];
      const clock: IntervalClock = {
        nowMs: () => readings.shift() ?? (() => { throw new Error('scripted clock exhausted'); })(),
      };
      provider = new ClaudeProvider(clock);
      mockExeca.mockResolvedValue({
        stdout: 'No conversation found',
        stderr: '',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invokeInteractive({
        ...baseOptions,
        interactive: true,
      });

      expect(result).toEqual({
        success: false,
        output: 'No conversation found',
        exitCode: 1,
        authFailure: undefined,
        rateLimited: undefined,
        sessionExpired: true,
        modelUnavailable: undefined,
        tokenUsage: undefined,
        waitSeconds: undefined,
        deadline: undefined,
        observedIntervals: [{ startedAtMs: 2_000, durationMs: 40 }],
      });
    });

    it('returns the unsuccessful subprocess interval without changing output or provider usage', async () => {
      const readings = [3_000, 3_055];
      const clock: IntervalClock = {
        nowMs: () => readings.shift() ?? (() => { throw new Error('scripted clock exhausted'); })(),
      };
      provider = new ClaudeProvider(clock);
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({
          result: 'Failed output',
          usage: { input_tokens: 17, output_tokens: 4 },
          duration_ms: 45,
        }),
        stderr: 'Invalid API key',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);

      expect(result).toEqual({
        success: false,
        output: 'Failed output\nInvalid API key',
        exitCode: 1,
        authFailure: true,
        rateLimited: undefined,
        sessionExpired: undefined,
        modelUnavailable: undefined,
        tokenUsage: { input: 17, output: 4, durationMs: 45 },
        waitSeconds: undefined,
        deadline: undefined,
        observedIntervals: [{ startedAtMs: 3_000, durationMs: 55 }],
      });
    });

    it('routes interactive subprocess diagnostics through the supplied feature logger', async () => {
      const featureLog = vi.fn();
      mockExeca.mockResolvedValue({
        stdout: 'subprocess stdout diagnostic',
        stderr: 'subprocess stderr diagnostic',
        exitCode: 1,
        failed: true,
      } as any);

      await provider.invokeInteractive({ ...baseOptions, diagnosticLog: featureLog });

      expect(featureLog).toHaveBeenCalledWith('subprocess stdout diagnostic');
      expect(featureLog).toHaveBeenCalledWith('subprocess stderr diagnostic');
    });

    it('logs a readable summary instead of the raw --output-format json envelope', async () => {
      const featureLog = vi.fn();
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({
          is_error: false,
          duration_ms: 486_825,
          num_turns: 54,
          session_id: '82306471-0000-0000-0000-000000000000',
          total_cost_usd: 4.956137999999998,
          usage: { input_tokens: 12_345, output_tokens: 4_100 },
          result: 'RED acceptance specs written, executed, and committed.',
        }),
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, diagnosticLog: featureLog });

      const logged = featureLog.mock.calls.map(([line]) => line as string).join('\n');
      expect(logged).toContain('claude: done — 54 turns, 8m7s, $4.96');
      expect(logged).toContain('RED acceptance specs written, executed, and committed.');
      expect(logged).not.toContain('session_id');
    });

    it('remains independent of Codex-only isolated-home state', async () => {
      const priorHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = '/missing/codex-home';
      mockExeca.mockResolvedValue({ stdout: 'ok', exitCode: 0, failed: false } as any);
      try {
        await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: true });
        const [command, , options] = mockExeca.mock.calls[0] as [string, string[], any];
        expect(command).toBe('claude');
        expect(options.env?.CODEX_HOME).toBeUndefined();
      } finally {
        if (priorHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = priorHome;
      }
    });

    it('runs when Codex is absent from PATH and no Codex environment is configured', async () => {
      const priorPath = process.env.PATH;
      const priorCodex = process.env.CODEX_HOME;
      process.env.PATH = '/claude-only';
      delete process.env.CODEX_HOME;
      mockExeca.mockResolvedValue({ stdout: 'ok', exitCode: 0, failed: false } as any);
      try {
        await provider.invoke({ ...baseOptions, dangerouslySkipPermissions: true });
        expect(mockExeca.mock.calls[0]?.[0]).toBe('claude');
      } finally {
        if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
        if (priorCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorCodex;
      }
    });

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
      const sessionIndex = args.indexOf('--session-id');
      expect(sessionIndex).toBeGreaterThanOrEqual(0);
      // Boundary enforcement mints a fresh session id; the caller-supplied id
      // never reaches the CLI (session reuse was removed by design).
      expect(args[sessionIndex + 1]).not.toBe('abc-123');
      expect(args[sessionIndex + 1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
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

      // InvokeOptions declares `prompt` required, but the CLI treats an
      // absent prompt as a real, supported runtime state (stdin closed
      // rather than fed). Deliberately construct that out-of-type value to
      // exercise the no-prompt path.
      await provider.invoke({
        ...baseOptions,
        prompt: undefined as unknown as string,
        dangerouslySkipPermissions: true,
      });

      const [, args, opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts).toMatchObject({ stdin: 'ignore' });
      expect(opts.input).toBeUndefined();
      expect(args).not.toContain('--print');
    });

    it('starts a fresh Claude session when handed resume: true', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'ok',
        exitCode: 0,
        failed: false,
      } as any);

      await provider.invoke({ ...baseOptions, resume: true, dangerouslySkipPermissions: true });

      const [, args] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(args).toContain('--session-id');
      expect(args).not.toContain('--resume');
      // resume: true is suppressed AND the supplied id is replaced with a
      // fresh one, so the CLI cannot resurrect the prior conversation.
      expect(args).not.toContain('abc-123');
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

    it.each([
      'No conversation found for this session',
      'Error: Session abc-123 is already in use',
    ])('classifies recoverable session failure %j as sessionExpired', async (output) => {
      mockExeca.mockResolvedValue({
        stdout: output,
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.sessionExpired).toBe(true);
    });

    it('treats a session-in-use lock as recoverable (sessionExpired)', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'This conversation is currently in use by another process',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.sessionExpired).toBe(true);
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

    it('classifies only anchored ENOENT and exit 127 as run-wide provider unavailability', async () => {
      const missingOutput =
        "LLM provider 'claude' not found. Install it or check your PATH.";
      const cases = [
        {
          name: 'structured ENOENT',
          response: {
            stdout: '',
            stderr: '',
            exitCode: undefined,
            code: 'ENOENT',
            shortMessage: 'spawn claude ENOENT',
            failed: true,
          },
          expected: {
            output: missingOutput,
            providerUnavailable: true,
            providerUnavailableScope: 'run',
            providerUnavailableReason: missingOutput,
          },
        },
        {
          name: 'exit 127',
          response: {
            stdout: '',
            stderr: 'shell could not execute command',
            exitCode: 127,
            failed: true,
          },
          expected: {
            output: missingOutput,
            providerUnavailable: true,
            providerUnavailableScope: 'run',
            providerUnavailableReason: missingOutput,
          },
        },
        {
          name: 'misleading prose',
          response: {
            stdout: '',
            stderr: 'The docs say the claude executable was not found',
            exitCode: 1,
            failed: true,
          },
          expected: {
            output: 'The docs say the claude executable was not found',
          },
        },
        {
          name: 'authentication',
          response: {
            stdout: '',
            stderr: 'Invalid API key',
            exitCode: 1,
            failed: true,
          },
          expected: {
            output: 'Invalid API key',
            authFailure: true,
          },
        },
        {
          name: 'model',
          response: {
            stdout: '',
            stderr: 'Invalid model name: claude-bogus',
            exitCode: 1,
            failed: true,
          },
          expected: {
            output: 'Invalid model name: claude-bogus',
            modelUnavailable: true,
          },
        },
        {
          name: 'rate limit',
          response: {
            stdout: '',
            stderr: 'Error: rate limit exceeded',
            exitCode: 1,
            failed: true,
          },
          expected: {
            output: 'Error: rate limit exceeded',
            rateLimited: true,
          },
        },
        {
          name: 'session',
          response: {
            stdout: '',
            stderr: 'No conversation found for this session',
            exitCode: 1,
            failed: true,
          },
          expected: {
            output: 'No conversation found for this session',
            sessionExpired: true,
          },
        },
      ] as const;
      const observed = [];

      for (const fixture of cases) {
        mockExeca.mockResolvedValue(fixture.response as any);
        const result = await provider.invoke(baseOptions);
        observed.push({
          name: fixture.name,
          output: result.output,
          providerUnavailable: result.providerUnavailable,
          providerUnavailableScope: result.providerUnavailableScope,
          providerUnavailableReason: result.providerUnavailableReason,
          authFailure: result.authFailure,
          modelUnavailable: result.modelUnavailable,
          rateLimited: result.rateLimited,
          sessionExpired: result.sessionExpired,
        });
      }

      expect(observed).toEqual(
        cases.map(({ name, expected }) => ({
          name,
          output: expected.output,
          providerUnavailable:
            'providerUnavailable' in expected
              ? expected.providerUnavailable
              : undefined,
          providerUnavailableScope:
            'providerUnavailableScope' in expected
              ? expected.providerUnavailableScope
              : undefined,
          providerUnavailableReason:
            'providerUnavailableReason' in expected
              ? expected.providerUnavailableReason
              : undefined,
          authFailure:
            'authFailure' in expected ? expected.authFailure : undefined,
          modelUnavailable:
            'modelUnavailable' in expected
              ? expected.modelUnavailable
              : undefined,
          rateLimited:
            'rateLimited' in expected ? expected.rateLimited : undefined,
          sessionExpired:
            'sessionExpired' in expected ? expected.sessionExpired : undefined,
        })),
      );
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

    it('treats the monthly spend limit notice as modelUnavailable and NOT success', async () => {
      mockExeca.mockResolvedValue({
        stdout: "You've hit your monthly spend limit. /model to switch models.",
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result).toMatchObject({ modelUnavailable: true, success: false });
    });

    it('does not flag modelUnavailable when prose quotes the monthly spend limit message', async () => {
      mockExeca.mockResolvedValue({
        stdout:
          'The incident report quotes "You\'ve hit your monthly spend limit" as an example.',
        stderr: '',
        exitCode: 0,
        failed: false,
      } as any);

      const result = await provider.invoke(baseOptions);
      expect(result.modelUnavailable).toBeUndefined();
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

    it('preserves model-unavailable classification over incidental auth-shaped output', async () => {
      mockExeca.mockResolvedValue({
        stdout: 'Invalid API key supplied while resolving Invalid model name: claude-bogus',
        exitCode: 1,
        failed: true,
      } as any);

      const result = await provider.invoke(baseOptions);

      expect({
        authFailure: result.authFailure,
        modelUnavailable: result.modelUnavailable,
      }).toEqual({
        authFailure: undefined,
        modelUnavailable: true,
      });
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
      expect(opts).toMatchObject({
        stdin: 'ignore',
        stdout: ['pipe', 'inherit'],
        stderr: ['pipe', 'inherit'],
      });
    });

    it('inherits REPL input while streaming and capturing output', async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 } as any);
      await provider.invokeInteractive({ ...baseOptions, interactive: true });
      const [, , opts] = mockExeca.mock.calls[0] as [string, string[], any];
      expect(opts).toMatchObject({
        stdin: 'inherit',
        stdout: ['pipe', 'inherit'],
        stderr: ['pipe', 'inherit'],
      });
    });
  });

  it('streams interactive output and returns classified completion', async () => {
    const missingOutput =
      "LLM provider 'claude' not found. Install it or check your PATH.";
    const cases = [
      {
        name: 'success',
        response: { stdout: 'Done!', stderr: '', exitCode: 0, failed: false },
        expected: { success: true, output: 'Done!', exitCode: 0 },
      },
      {
        name: 'model unavailable',
        response: {
          stdout: '',
          stderr: 'There is an issue with the selected model; it may not exist',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'There is an issue with the selected model; it may not exist',
          exitCode: 1,
          modelUnavailable: true,
        },
      },
      {
        name: 'missing executable',
        interactive: true,
        response: {
          stdout: '',
          stderr: '',
          exitCode: undefined,
          code: 'ENOENT',
          failed: true,
        },
        expected: {
          success: false,
          output: missingOutput,
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: missingOutput,
        },
      },
      {
        name: 'authentication',
        response: {
          stdout: '',
          stderr: 'Not logged in. Please run /login.',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'Not logged in. Please run /login.',
          exitCode: 1,
          authFailure: true,
        },
      },
      {
        name: 'rate limit',
        response: {
          stdout: '',
          stderr: 'Error 429: rate limit exceeded',
          exitCode: 1,
          failed: true,
        },
        expected: {
          success: false,
          output: 'Error 429: rate limit exceeded',
          exitCode: 1,
          rateLimited: true,
          waitSeconds: 300,
        },
      },
    ] as const;
    const observed = [];

    for (const fixture of cases) {
      mockExeca.mockResolvedValue(fixture.response as any);
      const result = await provider.invokeInteractive({
        ...baseOptions,
        interactive: 'interactive' in fixture && fixture.interactive,
      });
      const [, , execaOptions] = mockExeca.mock.calls.at(-1) as [
        string,
        string[],
        any,
      ];
      observed.push({
        name: fixture.name,
        result:
          result === undefined
            ? undefined
            : {
                success: result.success,
                output: result.output,
                exitCode: result.exitCode,
                modelUnavailable: result.modelUnavailable,
                providerUnavailable: result.providerUnavailable,
                providerUnavailableScope: result.providerUnavailableScope,
                providerUnavailableReason: result.providerUnavailableReason,
                authFailure: result.authFailure,
                rateLimited: result.rateLimited,
                waitSeconds: result.waitSeconds,
              },
        stdin: execaOptions.stdin,
        stdout: execaOptions.stdout,
        stderr: execaOptions.stderr,
      });
    }

    expect(observed).toEqual(
      cases.map(({ name, expected }) => ({
        name,
        result: {
          success: expected.success,
          output: expected.output,
          exitCode: expected.exitCode,
          modelUnavailable:
            'modelUnavailable' in expected
              ? expected.modelUnavailable
              : undefined,
          providerUnavailable:
            'providerUnavailable' in expected
              ? expected.providerUnavailable
              : undefined,
          providerUnavailableScope:
            'providerUnavailableScope' in expected
              ? expected.providerUnavailableScope
              : undefined,
          providerUnavailableReason:
            'providerUnavailableReason' in expected
              ? expected.providerUnavailableReason
              : undefined,
          authFailure:
            'authFailure' in expected ? expected.authFailure : undefined,
          rateLimited:
            'rateLimited' in expected ? expected.rateLimited : undefined,
          waitSeconds:
            'waitSeconds' in expected ? expected.waitSeconds : undefined,
        },
        stdin: name === 'missing executable' ? 'inherit' : 'ignore',
        stdout: ['pipe', 'inherit'],
        stderr: ['pipe', 'inherit'],
      })),
    );
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
