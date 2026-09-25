import type { HarnessConfig, ProviderSelection, ProviderSubstitutionPolicy } from '../types/config.js';

export function normalizeProviderSelection(
  selection: ProviderSelection | undefined,
): string[] {
  if (selection === undefined) return ['claude'];
  return Array.isArray(selection) ? [...selection] : [selection];
}

export function resolveProviderCandidates({
  configuredProviders,
  stepSelection,
  substitutionPolicy,
}: {
  configuredProviders: readonly string[];
  stepSelection?: ProviderSelection;
  substitutionPolicy?: ProviderSubstitutionPolicy;
}): string[] {
  const selectedProviders =
    stepSelection === undefined ? [] : normalizeProviderSelection(stepSelection);
  if (substitutionPolicy === 'disallow' && selectedProviders.length > 0) {
    return stableUniqueProviders(selectedProviders);
  }
  return stableUniqueProviders([...selectedProviders, ...configuredProviders]);
}

function stableUniqueProviders(providers: readonly string[]): string[] {
  return [...new Set(providers)];
}

export function validateRegisteredProviderSelections({
  config,
  registeredProviders,
}: {
  config: HarnessConfig;
  registeredProviders: readonly string[];
}): void {
  const registered = new Set(registeredProviders);

  assertRegistered(
    normalizeProviderSelection(config.llm_provider),
    'llm_provider',
    registered,
    registeredProviders,
  );

  for (const [stepName, stepConfig] of Object.entries(config.steps ?? {})) {
    if (stepConfig.llm_provider === undefined) continue;
    assertRegistered(
      normalizeProviderSelection(stepConfig.llm_provider),
      `steps.${stepName}.llm_provider`,
      registered,
      registeredProviders,
    );
  }
}

function assertRegistered(
  selection: readonly string[],
  path: string,
  registered: ReadonlySet<string>,
  available: readonly string[],
): void {
  for (const provider of selection) {
    if (!registered.has(provider)) {
      throw new Error(
        `${path} names unknown provider "${provider}". ` +
          `Available registered providers: ${available.join(', ') || '(none)'}`,
      );
    }
  }
}
