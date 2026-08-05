import { describe, expect, it } from 'vitest';

import { unauthenticatedClaudeEnvironment } from './claude-provider-smoke-env.js';

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
