import { BUILT_IN_PROVIDERS, CLAUDE_PROVIDER, providerDescriptor } from '../execution/provider-catalog.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from './provider-model-policy-defaults.js';
import type { HarnessConfig } from '../types/config.js';

export {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
};

export const BUILT_IN_PROVIDER_MODEL_POLICIES: Readonly<Record<string, ProviderModelPolicy>> =
  Object.freeze(Object.fromEntries(
    BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.modelPolicy]),
  ));

const BUILT_IN_PROVIDER_OPT_IN_MODEL_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.optInModelIds])),
);

export function hasBuiltInProviderModelPolicy(providerKey: string): boolean {
  return Object.hasOwn(BUILT_IN_PROVIDER_MODEL_POLICIES, providerKey);
}

export interface ResolveProviderModelPolicyOptions {
  config?: Pick<HarnessConfig, 'llm_providers'>;
  warn?: (message: string) => void;
}

export function resolveProviderModelPolicy(
  providerKey: string,
  options?: ResolveProviderModelPolicyOptions | ((message: string) => void),
): ProviderModelPolicy {
  const { config, warn } = typeof options === 'function'
    ? { config: undefined, warn: options }
    : options ?? {};
  if (hasBuiltInProviderModelPolicy(providerKey)) {
    const catalogPolicy = BUILT_IN_PROVIDER_MODEL_POLICIES[providerKey];
    const configuredPolicy = config?.llm_providers?.[providerKey];
    if (configuredPolicy === undefined) return catalogPolicy;

    return Object.freeze({
      ...catalogPolicy,
      stepModels: configuredPolicy.model === undefined
        ? catalogPolicy.stepModels
        : Object.freeze(Object.fromEntries(
          Object.keys(catalogPolicy.stepModels).map((step) => [step, configuredPolicy.model!]),
        )) as ProviderModelPolicy['stepModels'],
      modelEscalationOrder: configuredPolicy.model_escalation_order === undefined
        ? catalogPolicy.modelEscalationOrder
        : Object.freeze([...configuredPolicy.model_escalation_order]),
      modelFallbackLadder: configuredPolicy.model_fallback_ladder === undefined
        ? catalogPolicy.modelFallbackLadder
        : Object.freeze([...configuredPolicy.model_fallback_ladder]),
    });
  }

  warn?.(
    `Unknown provider "${providerKey}": ${providerDescriptor(CLAUDE_PROVIDER).displayName}-compatible model defaults are being used; add a provider model policy for "${providerKey}".`,
  );
  return CLAUDE_MODEL_POLICY;
}

/** Providers reporting per-dispatch dollars need no rate-card estimate. */
export const COST_SELF_REPORTING_PROVIDERS: ReadonlySet<string> = new Set(
  BUILT_IN_PROVIDERS
    .filter((provider) =>
      'costSelfReporting' in provider.capabilities
      && provider.capabilities.costSelfReporting === true,
    )
    .map((provider) => provider.id),
);

export function rateCardModelIds(): string[] {
  const ids = new Set<string>();
  const addModelId = (model: string | undefined): void => {
    if (model) ids.add(model);
  };
  for (const [provider, policy] of Object.entries(BUILT_IN_PROVIDER_MODEL_POLICIES)) {
    if (COST_SELF_REPORTING_PROVIDERS.has(provider)) continue;
    for (const model of BUILT_IN_PROVIDER_OPT_IN_MODEL_IDS[provider] ?? []) addModelId(model);
    for (const model of Object.values(policy.stepModels)) addModelId(model);
    for (const model of policy.modelEscalationOrder) addModelId(model);
    for (const model of policy.modelFallbackLadder) addModelId(model);
    for (const tiers of Object.values(policy.stepTierOverrides)) {
      for (const override of Object.values(tiers ?? {})) {
        addModelId(override?.model);
      }
    }
  }
  return [...ids].sort();
}
