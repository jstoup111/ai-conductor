import {
  provisionProviderHome,
  type ProviderHome,
  type ResolvedSelfHostProvider,
} from '../../src/engine/self-host/provider-home.js';

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
    baseDir,
  });
}
