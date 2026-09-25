import { describe, expect, it, vi } from 'vitest';

import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: { repository: 'acme/repo', defaultBranch: 'main', specBranch: 'spec/topic', featureMarker: '.docs/specs/topic.md', publication: 'initial' },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/topic.md', content: 'Owner: alice\n' }] },
    },
  };
}

describe('remote Git bot fallback', () => {
  it('does not silently retry when the warning sink is unavailable', async () => {
    const runRemoteGit = vi.fn(async () => { throw new GithubBotAuthRefusalError('auth-refused'); });
    const result = await executeRemoteGit(['push', 'origin', 'HEAD:refs/heads/topic'], {
      cwd: '/fixture',
      config: async () => ({ stdout: 'https://github.com/acme/repo.git\n' }),
      runRemoteGit,
      mutation: mutation(),
    });
    expect(result.kind).toBe('failed');
    expect(runRemoteGit).toHaveBeenCalledTimes(1);
  });
});
