import { BUILT_IN_PROVIDERS } from '../execution/provider-catalog.js';
import type { HarnessConfig, ProviderSelection } from '../types/config.js';

export type ProviderModelValue = {
  readonly model: string;
  readonly configPath: string;
  readonly step?: string;
};

export type ProviderModelSelection = {
  readonly configured: boolean;
  readonly models: readonly ProviderModelValue[];
};

/**
 * Enumerate catalog-provider selections and the model values that can reach
 * them. Config validation and boot-time model probing share this source of
 * truth so their definition of a configured provider cannot drift.
 */
export function collectProviderModelSelections(
  config: HarnessConfig,
): Readonly<Record<string, ProviderModelSelection>> {
  const configured = new Set<string>();
  const models = new Map<string, ProviderModelValue[]>();
  for (const provider of BUILT_IN_PROVIDERS) models.set(provider.id, []);

  const select = (selection: ProviderSelection | undefined): string[] =>
    selection === undefined ? [] : Array.isArray(selection) ? selection : [selection];
  const addModels = (providerIds: readonly string[], model: string | undefined, configPath: string, step?: string) => {
    if (model === undefined) return;
    for (const providerId of providerIds) {
      const providerModels = models.get(providerId);
      if (providerModels) providerModels.push({ model, configPath, ...(step === undefined ? {} : { step }) });
    }
  };
  const addSelection = (
    selection: ProviderSelection | undefined,
    model: string | undefined,
    configPath: string,
    step?: string,
  ) => {
    const providerIds = select(selection);
    for (const providerId of providerIds) {
      if (models.has(providerId)) configured.add(providerId);
    }
    addModels(providerIds, model, configPath, step);
  };

  addSelection(config.llm_provider, undefined, 'llm_provider');
  for (const [stepName, stepConfig] of Object.entries(config.steps ?? {})) {
    addSelection(stepConfig.llm_provider, stepConfig.model, `steps.${stepName}.model`, stepName);
  }
  for (const [rubricId, rubric] of Object.entries(config.build_review?.rubrics ?? {})) {
    if (!rubric) continue;
    addSelection(
      rubric.llm_provider,
      rubric.model,
      `build_review.rubrics.${rubricId}.model`,
      `build_review:${rubricId}`,
    );
  }
  for (const [rubricId, rubric] of Object.entries(config.build_review?.custom_rubrics ?? {})) {
    addSelection(
      rubric.llm_provider,
      rubric.model,
      `build_review.custom_rubrics.${rubricId}.model`,
      `build_review:${rubricId}`,
    );
  }

  for (const provider of BUILT_IN_PROVIDERS) {
    const policy = config.llm_providers?.[provider.id];
    if (!policy) continue;
    const providerModels = models.get(provider.id)!;
    if (policy.model !== undefined) {
      providerModels.push({ model: policy.model, configPath: `llm_providers.${provider.id}.model` });
    }
    for (const [key, values] of [
      ['model_escalation_order', policy.model_escalation_order],
      ['model_fallback_ladder', policy.model_fallback_ladder],
    ] as const) {
      for (const [index, model] of (values ?? []).entries()) {
        providerModels.push({ model, configPath: `llm_providers.${provider.id}.${key}[${index}]` });
      }
    }
  }

  return Object.fromEntries(BUILT_IN_PROVIDERS.map((provider) => [provider.id, {
    configured: configured.has(provider.id),
    models: models.get(provider.id)!,
  }]));
}
