import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { HarnessConfig, ProviderSelection } from '../../src/types/config.js';

type ValidateRegisteredProviderSelections = (input: {
  config: HarnessConfig;
  registeredProviders: readonly string[];
}) => void;

async function loadRegisteredSelectionValidator(): Promise<
  ValidateRegisteredProviderSelections | undefined
> {
  const providerSelection = await import('../../src/engine/provider-selection.js');
  return (
    providerSelection as typeof providerSelection & {
      validateRegisteredProviderSelections?: ValidateRegisteredProviderSelections;
    }
  ).validateRegisteredProviderSelections;
}

function frozenProviderNames(): string[] {
  const registry = new PluginRegistry();
  registry.register('llm_provider', 'claude', {});
  registry.register('llm_provider', 'codex', {});
  registry.markInitialized();
  return registry.list('llm_provider');
}

describe.each([
  { name: 'absent selection', selection: undefined, expected: ['claude'] },
  { name: 'scalar selection', selection: 'codex', expected: ['codex'] },
  {
    name: 'ordered selection',
    selection: ['codex', 'claude'],
    expected: ['codex', 'claude'],
  },
] satisfies Array<{
  name: string;
  selection: ProviderSelection | undefined;
  expected: string[];
}>)('normalizeProviderSelection: $name', ({ selection, expected }) => {
  it('returns the configured provider order', async () => {
    const providerSelection = await import('../../src/engine/provider-selection.js').catch(
      () => null,
    );

    expect(providerSelection?.normalizeProviderSelection(selection)).toEqual(expected);
  });
});

describe('validateRegisteredProviderSelections', () => {
  it('exposes the post-registration validation seam', async () => {
    const validateRegistered = await loadRegisteredSelectionValidator();

    expect(validateRegistered).toBeTypeOf('function');
  });

  it.each([
    {
      name: 'registered run-level names',
      config: { llm_provider: ['claude', 'codex'] },
    },
    {
      name: 'a registered named-step provider outside the run selection',
      config: {
        llm_provider: 'claude',
        steps: { build_review: { llm_provider: 'codex' } },
      },
    },
  ] satisfies Array<{ name: string; config: HarnessConfig }>)(
    'accepts $name from a frozen registry',
    async ({ config }) => {
      const validateRegistered = await loadRegisteredSelectionValidator();

      expect(() =>
        validateRegistered?.({ config, registeredProviders: frozenProviderNames() }),
      ).not.toThrow();
    },
  );

  it('rejects an unknown run-level provider with scope and available names', async () => {
    const validateRegistered = await loadRegisteredSelectionValidator();

    expect(() =>
      validateRegistered?.({
        config: { llm_provider: ['claude', 'unknown'] },
        registeredProviders: frozenProviderNames(),
      }),
    ).toThrow(/llm_provider.*unknown.*available.*claude.*codex/i);
  });

  it('rejects an unknown named-step provider with scope and available names', async () => {
    const validateRegistered = await loadRegisteredSelectionValidator();

    expect(() =>
      validateRegistered?.({
        config: {
          llm_provider: 'claude',
          steps: { build_review: { llm_provider: 'unknown' } },
        },
        registeredProviders: frozenProviderNames(),
      }),
    ).toThrow(/steps\.build_review\.llm_provider.*unknown.*available.*claude.*codex/i);
  });
});
