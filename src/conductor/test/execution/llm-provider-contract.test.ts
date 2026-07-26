import { describe, expect, it } from 'vitest';
import type {
  AuthenticationReadiness,
  AuthenticationSource,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';

type ProviderUnavailableClassification = {
  scope: 'run';
  reason: string;
};

type ClassifyProviderAttempt = (
  result: InvokeResult,
) => ProviderUnavailableClassification | undefined;

describe('InvokeResult provider-unavailable contract', () => {
  it('lets built-in providers expose a sanitized optional authentication readiness verdict', async () => {
    const readiness: AuthenticationReadiness = {
      provider: 'codex',
      source: 'api-key' satisfies AuthenticationSource,
      state: 'unusable',
      remediation: 'Replace the API key, restart the daemon, and requeue the work.',
    };
    const provider: LLMProvider = {
      async invoke(): Promise<InvokeResult> {
        return {
          success: true,
          output: 'ok',
          exitCode: 0,
          authentication: readiness,
        };
      },
      async invokeInteractive(): Promise<void> {},
      async readiness(): Promise<AuthenticationReadiness> {
        return readiness;
      },
    };

    expect({
      readiness: await provider.readiness?.(),
      result: await provider.invoke({ prompt: 'check', sessionId: 'check', resume: false }),
    }).toEqual({
      readiness,
      result: { success: true, output: 'ok', exitCode: 0, authentication: readiness },
    });
  });

  it('keeps void-returning custom interactive providers valid and non-classifying', async () => {
    const legacyProvider: LLMProvider = {
      async invoke(): Promise<InvokeResult> {
        return { success: true, output: 'ok', exitCode: 0 };
      },
      async invokeInteractive(_options: InvokeOptions): Promise<void> {},
    };

    const completion = await legacyProvider.invokeInteractive({
      prompt: 'legacy custom provider',
      sessionId: 'legacy-session',
      resume: false,
    });

    expect(completion).toBeUndefined();
  });

  it('classifies only explicit run-wide provider unavailability and preserves every existing failure class', async () => {
    const module = await import('../../src/engine/provider-execution.js');
    const classify = (
      module as { classifyProviderAttempt?: ClassifyProviderAttempt }
    ).classifyProviderAttempt;
    const cases: Array<{
      name: string;
      result: InvokeResult;
      expected?: ProviderUnavailableClassification;
    }> = [
      {
        name: 'provider unavailable for run',
        result: {
          success: false,
          output: 'codex executable missing',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
          providerUnavailableReason: 'codex executable missing',
        },
        expected: {
          scope: 'run',
          reason: 'codex executable missing',
        },
      },
      {
        name: 'unscoped provider flag',
        result: {
          success: false,
          output: 'provider unavailable for one attempt',
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableReason: 'provider unavailable for one attempt',
        },
      },
      {
        name: 'run-wide provider flag without explicit reason',
        result: {
          success: false,
          output: 'provider process cannot start',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableScope: 'run',
        },
        expected: {
          scope: 'run',
          reason: 'provider process cannot start',
        },
      },
      {
        name: 'model unavailable',
        result: {
          success: false,
          output: 'model unavailable',
          exitCode: 1,
          modelUnavailable: true,
        },
      },
      {
        name: 'authentication',
        result: {
          success: false,
          output: 'not logged in',
          exitCode: 1,
          authFailure: true,
        },
      },
      {
        name: 'rate limit',
        result: {
          success: false,
          output: 'rate limited',
          exitCode: 1,
          rateLimited: true,
        },
      },
      {
        name: 'session expiry',
        result: {
          success: false,
          output: 'session expired',
          exitCode: 1,
          sessionExpired: true,
        },
      },
      {
        name: 'ordinary failure',
        result: {
          success: false,
          output: 'command failed',
          exitCode: 1,
        },
      },
      {
        name: 'misleading provider-unavailable prose',
        result: {
          success: false,
          output: 'provider unavailable because command failed',
          exitCode: 1,
        },
      },
      {
        name: 'legacy custom-provider success',
        result: {
          success: true,
          output: 'ok',
          exitCode: 0,
        },
      },
    ];

    expect({
      classifierDefined: classify !== undefined,
      observed: cases.map(({ name, result }) => ({
        name,
        classification: classify?.(result),
      })),
    }).toEqual({
      classifierDefined: true,
      observed: cases.map(({ name, expected }) => ({
        name,
        classification: expected,
      })),
    });
  });
});
