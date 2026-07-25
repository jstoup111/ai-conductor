import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { HarnessConfig, ProviderSelection } from '../../src/types/config.js';

type ValidateRegisteredProviderSelections = (input: {
  config: HarnessConfig;
  registeredProviders: readonly string[];
}) => void;

type ResolveProviderCandidates = (input: {
  configuredProviders: readonly string[];
  stepSelection?: ProviderSelection;
}) => string[];

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

async function loadCandidateResolver(): Promise<ResolveProviderCandidates | undefined> {
  const providerSelection = await import('../../src/engine/provider-selection.js');
  return (
    providerSelection as typeof providerSelection & {
      resolveProviderCandidates?: ResolveProviderCandidates;
    }
  ).resolveProviderCandidates;
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

describe.each([
  {
    name: 'inherits the declared first provider',
    configuredProviders: ['claude', 'codex'],
    stepSelection: undefined,
    expected: ['claude', 'codex'],
  },
  {
    name: 'keeps an explicit first provider first',
    configuredProviders: ['claude', 'codex'],
    stepSelection: 'claude',
    expected: ['claude', 'codex'],
  },
  {
    name: 'moves an explicit later provider first',
    configuredProviders: ['claude', 'codex', 'custom'],
    stepSelection: 'codex',
    expected: ['codex', 'claude', 'custom'],
  },
  {
    name: 'prepends an explicit registered provider outside the run list',
    configuredProviders: ['claude', 'custom'],
    stepSelection: 'codex',
    expected: ['codex', 'claude', 'custom'],
  },
] satisfies Array<{
  name: string;
  configuredProviders: string[];
  stepSelection: ProviderSelection | undefined;
  expected: string[];
}>)('resolveProviderCandidates: $name', ({ configuredProviders, stepSelection, expected }) => {
  it('returns selected-first candidates and preserves the configured remainder', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();

    expect(resolveProviderCandidates?.({ configuredProviders, stepSelection })).toEqual(expected);
  });
});
