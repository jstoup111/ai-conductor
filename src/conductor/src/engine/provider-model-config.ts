import { BUILT_IN_PROVIDERS, DEFAULT_PROVIDER } from '../execution/provider-catalog.js';
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

  // Runtime semantics: an authored model reaches only the preferred (first)
  // candidate of its effective selection. Fallback candidates resolve their
  // own native defaults, and phase/default models belong to the inherited
  // run-level provider.
  const inheritedProvider = select(config.llm_provider)[0] ?? DEFAULT_PROVIDER;
  const preferred = (selection: ProviderSelection | undefined): string[] => {
    const first = selection === undefined ? inheritedProvider : select(selection)[0];
    return first === undefined ? [] : [first];
  };

  addSelection(config.llm_provider, undefined, 'llm_provider');
  addModels([inheritedProvider], config.defaults?.model, 'defaults.model');
  for (const [phaseName, phaseConfig] of Object.entries(config.phases ?? {})) {
    if (!phaseConfig) continue;
    addModels([inheritedProvider], phaseConfig.model, `phases.${phaseName}.model`);
    for (const [tier, tierConfig] of Object.entries(phaseConfig.by_tier ?? {})) {
      addModels([inheritedProvider], tierConfig?.model, `phases.${phaseName}.by_tier.${tier}.model`);
    }
  }
  for (const [stepName, stepConfig] of Object.entries(config.steps ?? {})) {
    addSelection(stepConfig.llm_provider, undefined, `steps.${stepName}.llm_provider`, stepName);
    const stepProvider = preferred(stepConfig.llm_provider);
    addModels(stepProvider, stepConfig.model, `steps.${stepName}.model`, stepName);
    for (const [tier, tierConfig] of Object.entries(stepConfig.by_tier ?? {})) {
      addModels(stepProvider, tierConfig?.model, `steps.${stepName}.by_tier.${tier}.model`, stepName);
    }
  }
  const buildReviewSelection = config.steps?.build_review?.llm_provider;
  const rubricEntries = [
    ...Object.entries(config.build_review?.rubrics ?? {}).map(([id, rubric]) => ['rubrics', id, rubric] as const),
    ...Object.entries(config.build_review?.custom_rubrics ?? {}).map(([id, rubric]) => ['custom_rubrics', id, rubric] as const),
  ];
  for (const [group, rubricId, rubric] of rubricEntries) {
    if (!rubric) continue;
    const step = `build_review:${rubricId}`;
    addSelection(rubric.llm_provider, undefined, `build_review.${group}.${rubricId}.llm_provider`, step);
    addModels(
      preferred(rubric.llm_provider ?? buildReviewSelection),
      rubric.model,
      `build_review.${group}.${rubricId}.model`,
      step,
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
