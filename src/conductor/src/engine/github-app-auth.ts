/**
 * Shared contract for GitHub Actions that obtain a repository App installation
 * token. Keep secret names and the requested permission surface in one typed
 * place so action adapters never need an ambient `GITHUB_TOKEN` fallback.
 */
export const releasePrGithubAppAuth = Object.freeze({
  appIdSecret: 'RELEASE_PR_APP_ID',
  privateKeySecret: 'RELEASE_PR_APP_PRIVATE_KEY',
  permissions: Object.freeze({
    contents: 'write',
    pullRequests: 'write',
  }),
});
