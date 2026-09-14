import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';

function runtimes(first: 'codex' | 'claude', calls: string[]) {
  const provider = (name: 'codex' | 'claude'): LLMProvider => ({
    lifecycleCapability: { synchronousSpawnPermit: name !== first },
    invoke: vi.fn(async () => { calls.push(name); return { success: true, output: name, exitCode: 0 }; }),
  });
  return new ProviderRuntimeSet([
    { key: 'codex', provider: provider('codex'), policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
    { key: 'claude', provider: provider('claude'), policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
  ]);
}

describe('non-self-host provider setup routing', () => {
  it.each([['codex', 'claude'], ['claude', 'codex']] as const)('skips unsupported %s then dispatches %s without self-host preparation', async (first, second) => {
    const calls: string[] = [];
    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: [first, second], runtimes: runtimes(first, calls),
      sessions: new ProviderSessionScope(vi.fn()), options: { prompt: 'build', cwd: '/workspace', spawnPermit: () => ({ permitted: true }) },
    });
    expect(result).toMatchObject({ success: true, actualProvider: second, attempts: expect.arrayContaining([{ provider: first, invoked: false, skipReason: 'setup-unavailable' }]) });
    expect(result.success).toBe(true);
    expect(result.actualProvider).toBe(second);
    expect(result.attempts[0]).toMatchObject({ provider: first, invoked: false, skipReason: 'setup-unavailable' });
    expect(calls).toEqual([second]);
  });
});
