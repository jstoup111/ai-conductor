// Covers: task:8
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { createClaudeProviderFake } from '../fixtures/claude-provider-fake.js';
import { createCodexProviderFake } from '../fixtures/codex-provider-fake.js';
import { createPiProviderFake } from '../fixtures/pi-provider-fake.js';
import {
  createDefaultLlmRealProvider,
  defineLlmRealLeg,
  meterLlmProvider,
} from './llm-real-leg.js';
import { assertTokenCap } from '../fixtures/live-e2e-run-body.js';

const providers = {
  claude: createClaudeProviderFake,
  codex: createCodexProviderFake,
  pi: createPiProviderFake,
} as const;

const meteringEmitted: string[] = [];

describe('llm real leg injected providers', () => {
  for (const [adapter, createFake] of Object.entries(providers)) {
    defineLlmRealLeg(adapter, { createProvider: () => createFake().provider });
  }
});

describe('llm real leg metering', () => {
  defineLlmRealLeg('claude', {
    createProvider: () => createClaudeProviderFake(() => ({
      success: true,
      output: 'metered',
      exitCode: 0,
      tokenUsage: { input: 200, output: 200 },
      finalStructuredResult: {},
    })).provider,
    environment: { DAEMON_E2E_LIVE_TOKEN_CAP: '900' },
    emit: (message) => meteringEmitted.push(message),
  });

  it('does not meter the denied-permit expectation or notify its spawn observer', async () => {
    const onSpawn = vi.fn();
    const provider = meterLlmProvider({
      ...createClaudeProviderFake().provider,
      invoke: async (options: InvokeOptions): Promise<InvokeResult> => {
        const permit = options.spawnPermit?.();
        if (permit && !permit.permitted) throw new Error(`denied: ${permit.reason}`);
        options.onSpawn?.();
        return { success: true, output: 'x', exitCode: 0, tokenUsage: { input: 400, output: 500 } };
      },
    });

    await expect(provider.invoke({
      prompt: 'one line',
      sessionId: 'metering-test',
      resume: false,
      onSpawn,
      spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
    })).rejects.toThrow('revoked');
    expect(onSpawn).not.toHaveBeenCalled();
    expect(provider.totalTokens).toBe(0);
  });

  it('sums only input and output token usage', async () => {
    const provider = meterLlmProvider({
      ...createClaudeProviderFake().provider,
      invoke: async () => ({
        success: true,
        output: 'x',
        exitCode: 0,
        tokenUsage: { input: 400, output: 500, cacheRead: 100, cacheCreation: 50 },
      }),
    });

    await provider.invoke({ prompt: 'one line', sessionId: 'metering-test', resume: false });
    expect(provider.totalTokens).toBe(900);
    expect(() => assertTokenCap(provider.totalTokens, provider.unmetered, 500))
      .toThrow('Token cap 500 exceeded: observed 900');
  });
});

afterAll(() => {
  expect(meteringEmitted).toEqual(['llm contract [claude real] tokens: 800 (cap 900)']);
});

describe('llm real leg boundaries', () => {
  it('uses the default descriptor factory for every adapter', () => {
    expect(createDefaultLlmRealProvider('claude').constructor.name).toBe('ClaudeProvider');
    expect(createDefaultLlmRealProvider('codex').constructor.name).toBe('CodexProvider');
    expect(createDefaultLlmRealProvider('pi').constructor.name).toBe('PiProvider');
  });

  it('keeps each smoke source credential-gated, contract-importing, and option-free', async () => {
    for (const adapter of Object.keys(providers)) {
      const source = await readFile(
        fileURLToPath(new URL(`./llm-${adapter}.contract.smoke.test.ts`, import.meta.url)),
        'utf8',
      );

      expect(source).toContain(`const smokeCapability = 'credentialed:${adapter}';`);
      expect(source).toContain("import './llm.contract.js';");
      expect(source).toContain(`defineLlmRealLeg('${adapter}');`);
      expect(source).not.toContain(`defineLlmRealLeg('${adapter}',`);
    }
  });
});
