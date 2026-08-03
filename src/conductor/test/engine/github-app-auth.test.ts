import { describe, expect, it } from 'vitest';

import { releasePrGithubAppAuth } from '../../src/engine/github-app-auth.js';

describe('release PR GitHub App authentication (Task 12)', () => {
  it('declares only the credential inputs and repository permissions needed by release maintenance', () => {
    expect(releasePrGithubAppAuth).toEqual({
      appIdSecret: 'RELEASE_PR_APP_ID',
      privateKeySecret: 'RELEASE_PR_APP_PRIVATE_KEY',
      permissions: {
        contents: 'write',
        pullRequests: 'write',
      },
    });
  });
});
