import { describe, expect, it } from 'vitest';
import { listPullRequestsWithFiles } from '../../src/engine/pull-request-files.js';

describe('listPullRequestsWithFiles', () => {
  it('refuses an incomplete changed-file cursor', async () => {
    const runGh = async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'o/r' }) };
      return { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 1, url: 'u', body: '', headRefOid: 'h', headRefName: 'f', author: { login: 'me' }, files: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) };
    };
    await expect(listPullRequestsWithFiles({ runGh: runGh as never, cwd: '/repo', state: 'OPEN' })).rejects.toThrow('incomplete');
  });
});
