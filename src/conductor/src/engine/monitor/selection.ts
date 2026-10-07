import { DEFAULT_PROVIDER, findBuiltInProviderDescriptor, type BuiltInProviderDescriptor } from '../../execution/provider-catalog.js';
import type { EffortLevel, HarnessConfig } from '../../types/config.js';
import { normalizeProviderSelection } from '../provider-selection.js';

export type SelectionSource = 'override' | 'config' | 'default';
export type GuidedSessionSelection =
  | { kind: 'refused'; message: string }
  | { kind: 'selected'; provider: string; model: string; effort: EffortLevel; sources: { provider: SelectionSource; model: SelectionSource; effort: SelectionSource } };

export interface GuidedSessionSelectionInput {
  readonly config: HarnessConfig;
  readonly overrides?: { readonly provider?: string; readonly model?: string; readonly effort?: EffortLevel };
}
export interface GuidedSessionSelectionDeps {
  readonly findDescriptor?: (id: string) => BuiltInProviderDescriptor | undefined;
  readonly listCatalogModels?: (descriptor: BuiltInProviderDescriptor) => readonly string[];
}

export function resolveGuidedSessionSelection(input: GuidedSessionSelectionInput, deps: GuidedSessionSelectionDeps = {}): GuidedSessionSelection {
  const overrides = input.overrides ?? {};
  const providerSource: SelectionSource = overrides.provider ? 'override' : input.config.monitor?.llm_provider ? 'config' : 'default';
  const provider = overrides.provider ?? input.config.monitor?.llm_provider ?? normalizeProviderSelection(input.config.llm_provider)[0] ?? DEFAULT_PROVIDER;
  const descriptor = (deps.findDescriptor ?? findBuiltInProviderDescriptor)(provider);
  if (!descriptor) return { kind: 'refused', message: `monitor: unregistered provider ${provider}.` };
  if (!('interactiveLaunch' in descriptor) || !descriptor.interactiveLaunch) return { kind: 'refused', message: `monitor: provider ${provider} cannot open a guided session: missing capability interactiveLaunch (#1007).` };
  const useConfig = providerSource !== 'override';
  const effort = overrides.effort ?? (useConfig ? input.config.monitor?.effort : undefined) ?? descriptor.modelPolicy.stepEfforts.explore;
  if (!descriptor.interactiveLaunch.acceptedEfforts.includes(effort)) return { kind: 'refused', message: `monitor: effort "${effort}" is not accepted by provider ${provider}.` };
  const model = overrides.model ?? (useConfig ? input.config.monitor?.model : undefined) ?? descriptor.modelPolicy.stepModels.explore;
  if (!model || /^-|[\s\u0000-\u001f\u007f-\u009f]/.test(model)) return { kind: 'refused', message: `monitor: model "${model}" is not a valid model id for provider ${provider}.` };
  if (descriptor.modelCatalog && !(deps.listCatalogModels?.(descriptor) ?? []).includes(model)) return { kind: 'refused', message: `monitor: model "${model}" is not in provider ${provider}'s model catalog.` };
  return { kind: 'selected', provider, model, effort, sources: {
    provider: providerSource,
    model: overrides.model ? 'override' : useConfig && input.config.monitor?.model ? 'config' : 'default',
    effort: overrides.effort ? 'override' : useConfig && input.config.monitor?.effort ? 'config' : 'default',
  } };
}
