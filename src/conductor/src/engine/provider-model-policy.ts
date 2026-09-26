import { BUILT_IN_PROVIDERS } from '../execution/provider-catalog.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  deepFreezePolicy,
  type ProviderModelPolicy,
} from './provider-model-policy-defaults.js';

export {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
};

export const BUILT_IN_PROVIDER_MODEL_POLICIES: Readonly<Record<string, ProviderModelPolicy>> =
  Object.freeze(Object.fromEntries(
    BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.modelPolicy]),
  ));

const BUILT_IN_PROVIDER_OPT_IN_MODEL_IDS: Readonly<Record<string, readonly string[]>> =
  deepFreezePolicy({ codex: ['gpt-6-astra'] });

export function hasBuiltInProviderModelPolicy(providerKey: string): boolean {
  return Object.hasOwn(BUILT_IN_PROVIDER_MODEL_POLICIES, providerKey);
}

export function resolveProviderModelPolicy(
  providerKey: string,
  warn?: (message: string) => void,
): ProviderModelPolicy {
  if (hasBuiltInProviderModelPolicy(providerKey)) {
    return BUILT_IN_PROVIDER_MODEL_POLICIES[providerKey];
  }

  warn?.(
    `Unknown provider "${providerKey}": Claude-compatible model defaults are being used; add a provider model policy for "${providerKey}".`,
  );
  return CLAUDE_MODEL_POLICY;
}

/** Providers reporting per-dispatch dollars need no rate-card estimate. */
export const COST_SELF_REPORTING_PROVIDERS: ReadonlySet<string> = new Set(
  BUILT_IN_PROVIDERS
    .filter((provider) => provider.capabilities.costSelfReporting === true)
    .map((provider) => provider.id),
);

export function rateCardModelIds(): string[] {
  const ids = new Set<string>();
  for (const [provider, policy] of Object.entries(BUILT_IN_PROVIDER_MODEL_POLICIES)) {
    if (COST_SELF_REPORTING_PROVIDERS.has(provider)) continue;
    for (const model of BUILT_IN_PROVIDER_OPT_IN_MODEL_IDS[provider] ?? []) ids.add(model);
    for (const model of Object.values(policy.stepModels)) ids.add(model);
    for (const model of policy.modelEscalationOrder) ids.add(model);
    for (const model of policy.modelFallbackLadder) ids.add(model);
    for (const tiers of Object.values(policy.stepTierOverrides)) {
      for (const override of Object.values(tiers ?? {})) {
        if (override?.model) ids.add(override.model);
      }
    }
  }
  return [...ids].sort();
}
