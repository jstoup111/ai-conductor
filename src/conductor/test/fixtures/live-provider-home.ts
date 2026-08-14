import {
  provisionProviderHome,
  type ProviderHome,
  type ResolvedSelfHostProvider,
} from '../../src/engine/self-host/provider-home.js';
import { tmpdir } from 'node:os';

const DEFAULT_LIVE_PROVIDER: ResolvedSelfHostProvider = { id: 'claude' };

/** Provision the isolated home used by the opt-in live daemon smoke. */
export async function provisionLiveProviderHome(
  sourceRoot: string,
  providerOrLegacyToken?: ResolvedSelfHostProvider | string,
  baseDir?: string,
  legacyProvider?: ResolvedSelfHostProvider,
): Promise<ProviderHome> {
  const provider = typeof providerOrLegacyToken === 'object'
    ? providerOrLegacyToken
    : legacyProvider ?? DEFAULT_LIVE_PROVIDER;

  return provisionProviderHome({
    provider,
    worktreeRoot: sourceRoot,
    // This fixture models an opt-in live smoke, not a daemon self-host
    // dispatch. Supply an explicit temporary base so production's mandatory
    // scratch-lease identity remains a compile-time requirement.
    baseDir: baseDir ?? tmpdir(),
  });
}
