import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { unauthenticatedClaudeExecaOptions } from './claude-provider-smoke-env.js';

describe('unauthenticated Claude smoke environment', () => {
  it('removes an inherited OAuth token while retaining the isolated config directory', () => {
    const options = unauthenticatedClaudeExecaOptions({
      CLAUDE_CODE_OAUTH_TOKEN: 'workflow-secret',
      PATH: '/bin',
    }, '/tmp/empty-claude-config');

    expect(options.env).toEqual({
      CLAUDE_CONFIG_DIR: '/tmp/empty-claude-config',
      PATH: '/bin',
    });
  });

  it('pins extendEnv false, without which execa merges the parent token back in', () => {
    const options = unauthenticatedClaudeExecaOptions({}, '/tmp/empty-claude-config');

    expect(options.extendEnv).toBe(false);
  });

  // The regression guard proper. The unit assertions above describe the object;
  // only spawning a child proves the token is actually absent from it. This is
  // the failure CI hit: the parent exports the token, so an options fragment
  // that merely omits it still yields an authenticated child.
  it('spawns a child that cannot see a token exported by the parent process', async () => {
    // The token must be on the REAL process.env, not a copy — that is what CI
    // has, and it is the only condition under which execa's default merge can
    // put the parent's value back into a child whose options omitted it.
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'parent-exported-secret';
    try {
      const options = unauthenticatedClaudeExecaOptions(process.env, '/tmp/empty-claude-config');

      const observed = await execa(
        process.execPath,
        ['-e', 'process.stdout.write(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "<absent>")'],
        options,
      );

      expect(observed.stdout).toBe('<absent>');
    } finally {
      if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    }
  });
});
