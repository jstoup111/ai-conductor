import { describe, expect, it } from 'vitest';

function unauthenticatedClaudeEnvironment(
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

describe('unauthenticated Claude smoke environment', () => {
  it('removes an inherited OAuth token while retaining the isolated config directory', () => {
    const environment = unauthenticatedClaudeEnvironment({
      CLAUDE_CODE_OAUTH_TOKEN: 'workflow-secret',
      PATH: '/bin',
    }, '/tmp/empty-claude-config');

    expect(environment).toEqual({
      CLAUDE_CONFIG_DIR: '/tmp/empty-claude-config',
      PATH: '/bin',
    });
  });
});
