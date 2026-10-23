import { describe, expect, it } from 'vitest';
import { listPullRequestsWithFiles } from '../../src/engine/pull-request-files.js';

describe('listPullRequestsWithFiles', () => {
  it('reads all 150 OPEN changed paths with PR identity across file pages', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ path: `.docs/${index}.md` }));
    const second = Array.from({ length: 50 }, (_, index) => ({ path: `.docs/${index + 100}.md` }));
    const runGh = async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'o/r' }) };
      const isFilePage = args.some((arg) => arg.startsWith('number='));
      const payload = isFilePage
        ? { data: { repository: { pullRequest: { files: { nodes: second, pageInfo: { hasNextPage: false, endCursor: null } } } } } }
        : { data: { repository: { pullRequests: { nodes: [{ number: 7, url: 'https://example.test/pr/7', body: '', headRefOid: 'a'.repeat(40), headRefName: 'feature/alpha', author: { login: 'author' }, files: { nodes: first, pageInfo: { hasNextPage: true, endCursor: 'files-2' } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } };
      return { stdout: JSON.stringify(payload) };
    };
    await expect(listPullRequestsWithFiles({ runGh: runGh as never, cwd: '/repo', state: 'OPEN' })).resolves.toEqual([
      expect.objectContaining({ url: 'https://example.test/pr/7', author: 'author', headRef: 'feature/alpha', changedPaths: Array.from({ length: 150 }, (_, index) => `.docs/${index}.md`) }),
    ]);
  });

  it('refuses an incomplete changed-file cursor', async () => {
    const runGh = async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'o/r' }) };
      return { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 1, url: 'u', body: '', headRefOid: 'h', headRefName: 'f', author: { login: 'me' }, files: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) };
    };
    await expect(listPullRequestsWithFiles({ runGh: runGh as never, cwd: '/repo', state: 'OPEN' })).rejects.toThrow('incomplete');
  });

  it('refuses repeated file cursors as incomplete pagination', async () => {
    const runGh = async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'o/r' }) };
      const isFilePage = args.some((arg) => arg.startsWith('number='));
      const files = isFilePage
        ? { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'again' } }
        : { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'again' } };
      const payload = isFilePage
        ? { data: { repository: { pullRequest: { files } } } }
        : { data: { repository: { pullRequests: { nodes: [{ number: 1, url: 'u', body: '', headRefOid: 'h', headRefName: 'f', author: { login: 'me' }, files }], pageInfo: { hasNextPage: false, endCursor: null } } } } };
      return { stdout: JSON.stringify(payload) };
    };
    await expect(listPullRequestsWithFiles({ runGh: runGh as never, cwd: '/repo', state: 'OPEN' })).rejects.toThrow(/incomplete pagination.*repeated/i);
  });
});
