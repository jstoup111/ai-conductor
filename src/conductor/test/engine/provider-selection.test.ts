import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { bootDispatchingCliProviders } from '../../src/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { HarnessConfig, ProviderSelection } from '../../src/types/config.js';
import type {
  InstalledProviderDiscovery,
  ProviderDiscoveryFailureReason,
} from '../../src/engine/provider-discovery.js';

type ValidateRegisteredProviderSelections = (input: {
  config: HarnessConfig;
  registeredProviders: readonly string[];
}) => void;

type ResolveProviderCandidates = (input: {
  configuredProviders: readonly string[];
  stepSelection?: ProviderSelection;
  substitutionPolicy?: 'allow' | 'disallow';
}) => string[];

type ValidateProviderInstallation = (input: {
  config: HarnessConfig;
  discovery: InstalledProviderDiscovery;
}) => void;

type ProviderNotInstalledErrorConstructor = new (...args: never[]) => Error;

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

async function loadInstallationValidator(): Promise<{
  validateProviderInstallation?: ValidateProviderInstallation;
  validateRegisteredProviderSelections?: ValidateRegisteredProviderSelections;
  ProviderNotInstalledError?: ProviderNotInstalledErrorConstructor;
}> {
  const providerSelection = await import('../../src/engine/provider-selection.js');
  return providerSelection as typeof providerSelection & {
    validateProviderInstallation?: ValidateProviderInstallation;
    validateRegisteredProviderSelections?: ValidateRegisteredProviderSelections;
    ProviderNotInstalledError?: ProviderNotInstalledErrorConstructor;
  };
}

function discovery(
  installed: InstalledProviderDiscovery['installed'],
  missing: Array<{ id: InstalledProviderDiscovery['missing'][number]['id']; reason: ProviderDiscoveryFailureReason }>,
): InstalledProviderDiscovery {
  return { installed, missing };
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

describe('provider-dispatching CLI guard', () => {
  it('does not discover or probe configured Pi for render-diagrams', async () => {
    const discover = vi.fn();
    const probe = vi.fn();

    await expect(bootDispatchingCliProviders({
      command: 'render-diagrams',
      registry: new PluginRegistry(),
      events: new ConductorEventEmitter(),
      config: {
        llm_provider: 'pi',
        llm_providers: {
          pi: {
            model: 'anthropic/claude-opus-4-5',
            model_escalation_order: ['anthropic/claude-opus-4-5'],
            model_fallback_ladder: ['anthropic/claude-opus-4-5'],
          },
        },
      },
      rendererOpts: {
        stateFilePath: '/tmp/provider-selection-render-diagrams.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
        projectRoot: '/tmp',
      },
      providerDiscoveryRunner: discover,
      providerModelProbeRunner: probe,
    })).resolves.toBeUndefined();

    expect(discover).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('resolveProviderCandidates hardening', () => {
  it('stably de-duplicates preferred and configured provider keys', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();

    expect(
      resolveProviderCandidates?.({
        configuredProviders: ['claude', 'codex', 'claude', 'custom', 'codex'],
        stepSelection: ['codex', 'codex'],
      }),
    ).toEqual(['codex', 'claude', 'custom']);
  });

  it('does not infer a provider from the step role', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    const inputWithRoleContext = {
      configuredProviders: ['claude', 'codex'],
      stepName: 'judgement',
    };

    expect(resolveProviderCandidates?.(inputWithRoleContext)).toEqual(['claude', 'codex']);
  });

  it('does not mutate provider inputs or leak an explicit choice into the next step', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    const configuredProviders = ['claude', 'codex'];
    const explicitSelection: ProviderSelection = ['codex'];
    Object.freeze(configuredProviders);
    Object.freeze(explicitSelection);

    const explicit = resolveProviderCandidates?.({
      configuredProviders,
      stepSelection: explicitSelection,
    });
    const inherited = resolveProviderCandidates?.({ configuredProviders });

    expect({ explicit, inherited, configuredProviders, explicitSelection }).toEqual({
      explicit: ['codex', 'claude'],
      inherited: ['claude', 'codex'],
      configuredProviders: ['claude', 'codex'],
      explicitSelection: ['codex'],
    });
  });

  it('falls back from an outside-list explicit provider only through the run list', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    const inputWithRegistryContext = {
      configuredProviders: ['claude'],
      stepSelection: 'codex',
      registeredProviders: ['claude', 'codex', 'custom'],
    };

    expect(resolveProviderCandidates?.(inputWithRegistryContext)).toEqual(['codex', 'claude']);
  });

  it('narrows a selected step only when substitution is disallowed', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    expect(resolveProviderCandidates?.({
      configuredProviders: ['claude', 'codex'], stepSelection: 'codex', substitutionPolicy: 'allow',
    })).toEqual(['codex', 'claude']);
    expect(resolveProviderCandidates?.({
      configuredProviders: ['claude', 'codex'], stepSelection: 'codex', substitutionPolicy: 'disallow',
    })).toEqual(['codex']);
  });

  it('keeps the global list when a disallowed step has no selection', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();

    expect(resolveProviderCandidates?.({
      configuredProviders: ['claude', 'codex'], substitutionPolicy: 'disallow',
    })).toEqual(['claude', 'codex']);
  });

  it('applies a step-scoped disallow only to that step', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    const configuredProviders = ['claude', 'codex'];

    expect(resolveProviderCandidates?.({
      configuredProviders, stepSelection: 'codex', substitutionPolicy: 'disallow',
    })).toEqual(['codex']);
    expect(resolveProviderCandidates?.({
      configuredProviders, stepSelection: 'codex',
    })).toEqual(['codex', 'claude']);
  });

  it('lets a step-scoped allow override a global disallow while other steps retain it', async () => {
    const resolveProviderCandidates = await loadCandidateResolver();
    const configuredProviders = ['claude', 'codex'];
    const globalSubstitutionPolicy = 'disallow' as const;

    // The resolved policy for this step comes from its explicit allow setting.
    expect(resolveProviderCandidates?.({
      configuredProviders, stepSelection: 'codex', substitutionPolicy: 'allow',
    })).toEqual(['codex', 'claude']);
    // An otherwise identical step inherits the global disallow setting.
    expect(resolveProviderCandidates?.({
      configuredProviders, stepSelection: 'codex', substitutionPolicy: globalSubstitutionPolicy,
    })).toEqual(['codex']);
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

describe('validateProviderInstallation', () => {
  it.each([
    {
      name: 'a run-level provider',
      config: { llm_provider: 'pi' },
      discovery: discovery(['claude', 'codex'], [{ id: 'pi', reason: 'not-found' }]),
      path: 'llm_provider',
      provider: 'pi',
      reason: 'not-found',
    },
    {
      name: 'a named-step provider',
      config: { llm_provider: 'claude', steps: { build: { llm_provider: 'codex' } } },
      discovery: discovery(['claude', 'pi'], [{ id: 'codex', reason: 'version-failed' }]),
      path: 'steps.build.llm_provider',
      provider: 'codex',
      reason: 'version-failed',
    },
    {
      name: 'a run-level fallback-ladder entry',
      config: { llm_provider: ['claude', 'pi'] },
      discovery: discovery(['claude', 'codex'], [{ id: 'pi', reason: 'not-executable' }]),
      path: 'llm_provider[1]',
      provider: 'pi',
      reason: 'not-executable',
    },
  ] satisfies Array<{
    name: string;
    config: HarnessConfig;
    discovery: InstalledProviderDiscovery;
    path: string;
    provider: string;
    reason: ProviderDiscoveryFailureReason;
  }>)('rejects $name before it can be treated as unknown', async ({ config, discovery: installedDiscovery, path, provider, reason }) => {
    const { validateProviderInstallation, ProviderNotInstalledError } = await loadInstallationValidator();

    expect(() => validateProviderInstallation?.({ config, discovery: installedDiscovery })).toThrow(
      new RegExp(`${path.replace(/[.[\]]/g, '\\$&')}.*${provider}.*${reason}`, 'i'),
    );
    expect(() => validateProviderInstallation?.({ config, discovery: installedDiscovery })).toThrow(
      ProviderNotInstalledError,
    );
  });

  it('leaves non-catalog plugin names for registered-provider validation and lists only installed names', async () => {
    const { validateProviderInstallation, validateRegisteredProviderSelections } =
      await loadInstallationValidator();
    const config = { llm_provider: 'unregistered-plugin' };
    const installedDiscovery = discovery(['claude'], [
      { id: 'codex', reason: 'not-found' },
      { id: 'pi', reason: 'not-found' },
    ]);

    expect(() => validateProviderInstallation?.({ config, discovery: installedDiscovery })).not.toThrow();
    expect(() => validateRegisteredProviderSelections?.({
      config,
      registeredProviders: installedDiscovery.installed,
    })).toThrow(/llm_provider.*unknown.*unregistered-plugin.*available.*claude(?!.*codex|.*pi)/i);
  });

  it('accepts a configuration when every selected built-in is installed', async () => {
    const { validateProviderInstallation } = await loadInstallationValidator();
    const config = {
      llm_provider: ['claude', 'codex'],
      steps: { build: { llm_provider: ['pi', 'claude'] } },
    };

    expect(() => validateProviderInstallation?.({
      config,
      discovery: discovery(['claude', 'codex', 'pi'], []),
    })).not.toThrow();
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
