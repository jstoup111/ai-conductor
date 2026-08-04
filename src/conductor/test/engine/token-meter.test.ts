import { describe, expect, it, vi } from 'vitest';
import {
  TokenMeter,
  assertTokenCap,
} from '../fixtures/token-meter.js';
import type {
  AuthenticationReadiness,
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  SelfHostAuthContext,
  SelfHostAuthPreparation,
} from '../../src/execution/llm-provider.js';

const options: InvokeOptions = {
  prompt: 'complete the fixture task',
  systemPrompt: 'work carefully',
  sessionId: 'session-1',
  resume: true,
  interactive: true,
  dangerouslySkipPermissions: true,
  stepCooldown: 4,
  sessionName: 'fixture',
  model: 'sonnet',
  effort: 'high',
  cwd: '/tmp/fixture',
  diagnosticLog: () => {},
  selfHost: {
    executable: 'claude',
    env: { TEST_ONLY: '1' },
    args: ['--print'],
    teardown: async () => {},
  },
  onActivity: () => {},
  onSpawn: () => {},
  spawnPermit: () => ({ permitted: true }),
};

function result(tokenUsage?: InvokeResult['tokenUsage']): InvokeResult {
  return { success: true, output: 'done', exitCode: 0, tokenUsage };
}

describe('TokenMeter', () => {
  it('sums token usage from invoke and invokeInteractive, treating absent usage as zero', async () => {
    const provider: LLMProvider = {
      invoke: vi
        .fn<LLMProvider['invoke']>()
        .mockResolvedValueOnce(result({ input: 12, output: 3 }))
        .mockResolvedValueOnce(result()),
      invokeInteractive: vi
        .fn<LLMProvider['invokeInteractive']>()
        .mockResolvedValue(result({ input: 5, output: 7 })),
    };
    const meter = new TokenMeter(provider);

    await meter.invoke(options);
    await meter.invokeInteractive(options);
    await meter.invoke(options);

    expect(meter.totalTokens).toBe(27);
  });

  it('forwards options, results, readiness, and self-host capabilities unchanged', async () => {
    const invokeResult = result({ input: 1, output: 2 });
    const interactiveResult = result({ input: 3, output: 4 });
    const readiness = { state: 'ready', provider: 'codex', source: 'api-key' } as const satisfies AuthenticationReadiness;
    const preparation = { args: ['--auth'] } satisfies SelfHostAuthPreparation;
    const context: SelfHostAuthContext = { provider: 'codex', homeDir: '/tmp/home' };
    const provider: LLMProvider = {
      supportsSessionResume: true,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn<LLMProvider['invoke']>().mockResolvedValue(invokeResult),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>().mockResolvedValue(interactiveResult),
      readiness: vi.fn().mockResolvedValue(readiness),
      prepareSelfHostAuth: vi.fn().mockResolvedValue(preparation),
      resolveSelfHostExecutable: vi.fn().mockResolvedValue('claude'),
    };
    const meter = new TokenMeter(provider);

    await expect(meter.invoke(options)).resolves.toBe(invokeResult);
    await expect(meter.invokeInteractive(options)).resolves.toBe(interactiveResult);
    await expect(meter.readiness?.()).resolves.toBe(readiness);
    await expect(meter.prepareSelfHostAuth?.(context)).resolves.toBe(preparation);
    await expect(meter.resolveSelfHostExecutable?.()).resolves.toBe('claude');
    expect(provider.invoke).toHaveBeenCalledWith(options);
    expect(provider.invokeInteractive).toHaveBeenCalledWith(options);
    expect(provider.prepareSelfHostAuth).toHaveBeenCalledWith(context);
    expect(meter.supportsSessionResume).toBe(true);
    expect(meter.lifecycleCapability).toBe(provider.lifecycleCapability);
  });
});

describe('assertTokenCap', () => {
  it('allows a total at the cap and reports both cap and observed total on breach', () => {
    expect(() => assertTokenCap(100, 100)).not.toThrow();
    expect(() => assertTokenCap(101, 100)).toThrow('Token cap 100 exceeded: observed 101');
  });
});
