import type { HarnessConfig, ProviderSelection } from '../types/config.js';
import {
  DEFAULT_PROVIDER,
  isBuiltInProviderId,
  type BuiltInProviderId,
} from '../execution/provider-catalog.js';
import type {
  InstalledProviderDiscovery,
  ProviderDiscoveryFailureReason,
} from './provider-discovery.js';

export function normalizeProviderSelection(
  selection: ProviderSelection | undefined,
): string[] {
  if (selection === undefined) return [DEFAULT_PROVIDER];
  return Array.isArray(selection) ? [...selection] : [selection];
}

export function resolveProviderCandidates({
  configuredProviders,
  stepSelection,
}: {
  configuredProviders: readonly string[];
  stepSelection?: ProviderSelection;
}): string[] {
  const selectedProviders =
    stepSelection === undefined ? [] : normalizeProviderSelection(stepSelection);
  return stableUniqueProviders([...selectedProviders, ...configuredProviders]);
}

function stableUniqueProviders(providers: readonly string[]): string[] {
  return [...new Set(providers)];
}

/** A configured catalog provider was discovered but cannot run on this machine. */
export class ProviderNotInstalledError extends Error {
  constructor(
    readonly provider: BuiltInProviderId,
    readonly configPath: string,
    readonly reason: ProviderDiscoveryFailureReason,
  ) {
    super(
      `${configPath} names built-in provider "${provider}", but it is not installed `
      + `(discovery reason: ${reason}). Install it or select an installed provider.`,
    );
    this.name = 'ProviderNotInstalledError';
  }
}

/**
 * Reject known catalog providers that boot discovery found unavailable. This
 * deliberately runs before registry validation, so missing built-ins retain a
 * machine-configuration diagnosis instead of being reported as unknown.
 */
export function validateProviderInstallation({
  config,
  discovery,
}: {
  config: HarnessConfig;
  discovery: InstalledProviderDiscovery;
}): void {
  const installed = new Set(discovery.installed);
  const missing = new Map(discovery.missing.map(({ id, reason }) => [id, reason]));

  assertInstalledSelection(
    normalizeProviderSelection(config.llm_provider),
    'llm_provider',
    installed,
    missing,
  );

  for (const [stepName, stepConfig] of Object.entries(config.steps ?? {})) {
    if (stepConfig.llm_provider === undefined) continue;
    assertInstalledSelection(
      normalizeProviderSelection(stepConfig.llm_provider),
      `steps.${stepName}.llm_provider`,
      installed,
      missing,
    );
  }
}

function assertInstalledSelection(
  selection: readonly string[],
  path: string,
  installed: ReadonlySet<BuiltInProviderId>,
  missing: ReadonlyMap<BuiltInProviderId, ProviderDiscoveryFailureReason>,
): void {
  for (const [index, provider] of selection.entries()) {
    if (!isBuiltInProviderId(provider) || installed.has(provider)) continue;

    const configPath = selection.length > 1 ? `${path}[${index}]` : path;
    // Discovery returns one missing reason per catalog id. Keep a defensive
    // fallback for malformed injected results without turning it into unknown.
    const reason = missing.get(provider) ?? 'not-found';
    throw new ProviderNotInstalledError(provider, configPath, reason);
  }
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
