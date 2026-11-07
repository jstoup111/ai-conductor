import {
  BUILT_IN_PROVIDERS,
  type BuiltInProviderId,
} from '../execution/provider-catalog.js';
import { PluginRegistry } from './plugin-registry.js';
import { ensureGitGuardForDispatch } from './git-guard.js';

export interface BuiltInLlmProviderRegistrationOptions {
  readonly installed?: ReadonlySet<BuiltInProviderId>;
  readonly codexDoctorTimeoutMs: number;
}

/** Registers every discovered built-in LLM provider with the shared plugin registry. */
export function registerBuiltInLlmProviders(
  registry: PluginRegistry,
  { installed, codexDoctorTimeoutMs }: BuiltInLlmProviderRegistrationOptions,
): void {
  const installedBuiltIns = installed ?? new Set<BuiltInProviderId>(
    BUILT_IN_PROVIDERS.map((provider) => provider.id),
  );
  for (const provider of BUILT_IN_PROVIDERS) {
    if (!installedBuiltIns.has(provider.id)) continue;
    registry.register(
      'llm_provider',
      provider.id,
      provider.createAdapter({ codexDoctorTimeoutMs, dispatchGitGuard: ensureGitGuardForDispatch }),
    );
  }
}
