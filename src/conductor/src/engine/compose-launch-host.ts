import {
  isBuiltInProviderId,
  type BuiltInProviderId,
} from '../execution/provider-catalog.js';
import { normalizeProviderSelection } from './provider-selection.js';
import type { HarnessConfig } from '../types/config.js';

/** Resolve the single interactive host; compose sessions never use ladder fallback. */
export function resolveComposeLaunchHost({
  providerFlag,
  config,
}: {
  providerFlag?: string;
  config: HarnessConfig;
}): BuiltInProviderId {
  const selection = providerFlag ?? (
    config.steps?.explore?.llm_provider ?? config.llm_provider
  );
  const provider = normalizeProviderSelection(selection)[0];
  const path = providerFlag === undefined ? 'llm_provider' : '--provider';

  if (!isBuiltInProviderId(provider)) {
    throw new Error(`${path} names unknown provider "${provider}".`);
  }

  return provider;
}
