import {
  provisionProviderHome,
  type ProviderHome,
  type ResolvedSelfHostProvider,
} from '../../src/engine/self-host/provider-home.js';
import type { LLMProvider, SelfHostAuthContext } from '../../src/execution/llm-provider.js';
import { tmpdir } from 'node:os';
import type { LiveE2EProviderDescriptor } from './live-e2e-providers.js';

/** Provision the isolated home used by the opt-in live daemon smoke. */
export async function provisionLiveProviderHome(
  sourceRoot: string,
  descriptor: Pick<LiveE2EProviderDescriptor, 'id'>,
  provider: Pick<LLMProvider, 'prepareSelfHostAuth'>,
  baseDir?: string,
): Promise<ProviderHome> {
  // The live fixture owns cross-provider credential isolation.  The selected
  // provider repopulates its credential through prepareSelfHostAuth below;
  // neither ambient credential is allowed to leak into the other leg.
  const parentEnv = { ...process.env };
  delete parentEnv.CLAUDE_CODE_OAUTH_TOKEN;
  delete parentEnv.CODEX_API_KEY;
  const selectedProvider: ResolvedSelfHostProvider = {
    id: descriptor.id,
    prepareSelfHostAuth: provider.prepareSelfHostAuth
      ? (context) => provider.prepareSelfHostAuth!(context as SelfHostAuthContext)
      : undefined,
  };

  return provisionProviderHome({
    provider: selectedProvider,
    worktreeRoot: sourceRoot,
    parentEnv,
    // This fixture models an opt-in live smoke, not a daemon self-host
    // dispatch. Supply an explicit temporary base so production's mandatory
    // scratch-lease identity remains a compile-time requirement.
    baseDir: baseDir ?? tmpdir(),
  });
}
