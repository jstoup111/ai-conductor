// Covers: task:18
import { describe, expect, it, vi } from 'vitest';

import { resolveRemoteGitTargets } from '../../../src/engine/remote-git-targets.js';

function remoteConfig(url = 'git@github.com:Acme/Rocket.git') {
  return vi.fn().mockResolvedValue({ stdout: `${url}\n` });
}

describe('engine/remote-git-targets — explicit remote destination sets', () => {
  it('canonicalizes the configured repository and every explicit destination ref before authorization', async () => {
    const gitConfig = remoteConfig('https://github.com/Acme/Rocket.git');

    await expect(resolveRemoteGitTargets(
      ['push', '--force-with-lease', 'origin', 'HEAD:refs/heads/feature/one', 'HEAD:refs/heads/feature/two'],
      gitConfig,
    )).resolves.toEqual({
      kind: 'resolved',
      remote: 'origin',
      targets: [
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/one' },
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/two' },
      ],
    });
    expect(gitConfig).toHaveBeenCalledWith(['remote', 'get-url', '--push', 'origin']);
  });

  it('normalizes named remote deletion to its explicit destination ref', async () => {
    const gitConfig = remoteConfig();

    await expect(resolveRemoteGitTargets(
      ['push', 'origin', '--delete', 'refs/heads/feature/obsolete'],
      gitConfig,
    )).resolves.toEqual({
      kind: 'resolved',
      remote: 'origin',
      targets: [{ operation: 'remote-ref.delete', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/obsolete' }],
    });
  });

  it('recognizes an explicit empty-source deletion refspec', async () => {
    const gitConfig = remoteConfig();

    await expect(resolveRemoteGitTargets(
      ['push', 'origin', ':refs/heads/feature/obsolete'],
      gitConfig,
    )).resolves.toMatchObject({
      kind: 'resolved',
      targets: [{ operation: 'remote-ref.delete', ref: 'refs/heads/feature/obsolete' }],
    });
  });

  it.each([
    ['an implicit push destination', ['push']],
    ['an implicit ref destination', ['push', 'origin', 'feature/owned']],
    ['a wildcard refspec', ['push', 'origin', 'HEAD:refs/heads/feature/*']],
    ['an all-refs request', ['push', 'origin', '--all']],
    ['a tags request', ['push', '--tags', 'origin']],
    ['a mirror request', ['push', 'origin', '--mirror']],
    ['a remote URL that is not a canonical GitHub repository', ['push', 'origin', 'HEAD:refs/heads/feature/owned']],
  ])('refuses %s before execution or authorization', async (caseName, args) => {
    const gitConfig = remoteConfig(caseName === 'a remote URL that is not a canonical GitHub repository'
      ? 'https://example.test/acme/rocket.git'
      : undefined);

    await expect(resolveRemoteGitTargets(args, gitConfig)).resolves.toEqual({
      kind: 'refused',
      reason: 'invalid-target',
    });
  });

  it.each([
    ['status', '--porcelain'],
    ['diff', '--quiet'],
    ['commit', '-m', 'local work'],
    ['worktree', 'add', '../feature'],
  ])('leaves local git %s calls on their existing runner without config reads', async (...args) => {
    const gitConfig = remoteConfig();

    await expect(resolveRemoteGitTargets(args, gitConfig)).resolves.toEqual({ kind: 'not-remote-write' });
    expect(gitConfig).not.toHaveBeenCalled();
  });
});
