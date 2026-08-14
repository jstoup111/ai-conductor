import {
  provisionProviderHome,
  type ProviderHome,
  type ResolvedSelfHostProvider,
} from '../../src/engine/self-host/provider-home.js';
import { tmpdir } from 'node:os';

/**
 * Provision the isolated Claude home used by the opt-in live daemon smoke.
 * The caller supplies the token so this fixture never reads ambient credentials.
 */
export async function provisionLiveProviderHome(
  sourceRoot: string,
  claudeCodeOauthToken?: string,
  baseDir?: string,
  provider: ResolvedSelfHostProvider = {
    id: 'claude',
    prepareSelfHostAuth: async () => ({
      env: claudeCodeOauthToken
        ? { CLAUDE_CODE_OAUTH_TOKEN: claudeCodeOauthToken }
        : {},
    }),
  },
): Promise<ProviderHome> {
  return provisionProviderHome({
    provider,
    worktreeRoot: sourceRoot,
    // This fixture models an opt-in live smoke, not a daemon self-host
    // dispatch. Supply an explicit temporary base so production's mandatory
    // scratch-lease identity remains a compile-time requirement.
    baseDir: baseDir ?? tmpdir(),
  });
}
