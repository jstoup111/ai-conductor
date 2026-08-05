import {
  provisionProviderHome,
  type ProviderHome,
} from '../../src/engine/self-host/provider-home.js';

/**
 * Provision the isolated Claude home used by the opt-in live daemon smoke.
 * The caller supplies the token so this fixture never reads ambient credentials.
 */
export async function provisionLiveProviderHome(
  sourceRoot: string,
  claudeCodeOauthToken?: string,
  baseDir?: string,
): Promise<ProviderHome> {
  return provisionProviderHome({
    provider: {
      id: 'claude',
      prepareSelfHostAuth: async () => ({
        env: claudeCodeOauthToken
          ? { CLAUDE_CODE_OAUTH_TOKEN: claudeCodeOauthToken }
          : {},
      }),
    },
    worktreeRoot: sourceRoot,
    baseDir,
  });
}

/**
 * Use the live smoke's isolated home and always remove it before returning or
 * propagating a caller failure.
 */
export async function withLiveProviderHome<T>(
  sourceRoot: string,
  use: (home: ProviderHome) => Promise<T>,
  claudeCodeOauthToken?: string,
  baseDir?: string,
): Promise<T> {
  const home = await provisionLiveProviderHome(sourceRoot, claudeCodeOauthToken, baseDir);
  try {
    return await use(home);
  } finally {
    await home.teardown();
  }
}
