/**
 * Execa options that run the real `claude` binary with NO credentials.
 *
 * This returns the whole options fragment, not just an environment, because
 * the environment alone cannot express the contract. Execa's default
 * `extendEnv: true` merges `options.env` over `process.env`, so deleting a key
 * from the object handed to `env` does not unset it in the child — the parent's
 * value is merged straight back in. A caller that passes only `env` therefore
 * gets an authenticated child whenever the parent exports a token, which is
 * exactly the case in CI: `live-daemon-e2e.yml` exports
 * `CLAUDE_CODE_OAUTH_TOKEN` at job level, so every "unauthenticated" negative
 * case silently ran authenticated and asserted the opposite of what it meant.
 *
 * `extendEnv: false` is what actually unsets the token, and keeping it welded
 * to the environment here means a call site cannot reintroduce the bug by
 * forgetting it.
 */
export function unauthenticatedClaudeExecaOptions(
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
): { env: NodeJS.ProcessEnv; extendEnv: false } {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    CLAUDE_CONFIG_DIR: configDirectory,
  };
  delete childEnvironment.CLAUDE_CODE_OAUTH_TOKEN;
  return { env: childEnvironment, extendEnv: false };
}
