import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { ModelAvailability } from '../../src/engine/model-availability.js';

interface ProviderRuntime {
  key: string;
  provider: LLMProvider;
  policy: ProviderModelPolicy;
  builtIn: boolean;
  availability: ModelAvailability;
}

interface ProviderRuntimeSet {
  keys(): string[];
  get(key: string): ProviderRuntime;
}

type CreateProviderRuntimeSet = (
  registry: PluginRegistry,
) => ProviderRuntimeSet;

async function loadRuntimeSetFactory(): Promise<
  CreateProviderRuntimeSet | undefined
> {
  const module = await import('../../src/engine/provider-runtime.js').catch(
    () => null,
  );
  return (
    module as
      | { createProviderRuntimeSet?: CreateProviderRuntimeSet }
      | null
  )?.createProviderRuntimeSet;
}

function provider(): LLMProvider {
  return {
    invoke: vi.fn(async () => ({
      success: true,
      output: 'ok',
      exitCode: 0,
    })),
    invokeInteractive: vi.fn(async () => {}),
  };
}

describe('ProviderRuntimeSet', () => {
  it('constructs every frozen-registry provider with isolated per-run state', async () => {
    const claude = provider();
    const codex = provider();
    const custom = provider();
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'claude', claude);
    registry.register('llm_provider', 'codex', codex);
    registry.register('llm_provider', 'toString', custom);
    registry.markInitialized();

    const createRuntimeSet = await loadRuntimeSetFactory();
    const first = createRuntimeSet?.(registry);
    const second = createRuntimeSet?.(registry);
    const firstClaude = first?.get('claude');
    const firstCodex = first?.get('codex');
    const firstCustom = first?.get('toString');
    const secondClaude = second?.get('claude');
    const secondCodex = second?.get('codex');
    const secondCustom = second?.get('toString');

    expect({
      keys: first?.keys(),
      runtimeKeys: [
        firstClaude?.key,
        firstCodex?.key,
        firstCustom?.key,
      ],
      providerIdentity: [
        firstClaude?.provider === claude,
        firstCodex?.provider === codex,
        firstCustom?.provider === custom,
        secondClaude?.provider === claude,
        secondCodex?.provider === codex,
        secondCustom?.provider === custom,
      ],
      policies: [
        firstClaude?.policy === CLAUDE_MODEL_POLICY,
        firstCodex?.policy === CODEX_MODEL_POLICY,
        firstCustom?.policy === CLAUDE_MODEL_POLICY,
      ],
      builtIn: [
        firstClaude?.builtIn,
        firstCodex?.builtIn,
        firstCustom?.builtIn,
      ],
      isolatedState: [
        firstClaude !== secondClaude,
        firstCodex !== secondCodex,
        firstCustom !== secondCustom,
        firstClaude?.availability !== secondClaude?.availability,
        firstCodex?.availability !== secondCodex?.availability,
        firstCustom?.availability !== secondCustom?.availability,
        firstClaude?.availability !== firstCodex?.availability,
        firstCodex?.availability !== firstCustom?.availability,
      ],
    }).toEqual({
      keys: ['claude', 'codex', 'toString'],
      runtimeKeys: ['claude', 'codex', 'toString'],
      providerIdentity: [true, true, true, true, true, true],
      policies: [true, true, true],
      builtIn: [true, true, false],
      isolatedState: [true, true, true, true, true, true, true, true],
    });
  });
});
