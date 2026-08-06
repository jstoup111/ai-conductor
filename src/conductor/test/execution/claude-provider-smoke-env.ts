export function unauthenticatedClaudeEnvironment(
  environment: NodeJS.ProcessEnv,
  configDirectory: string,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    CLAUDE_CONFIG_DIR: configDirectory,
  };
  delete childEnvironment.CLAUDE_CODE_OAUTH_TOKEN;
  return childEnvironment;
}
