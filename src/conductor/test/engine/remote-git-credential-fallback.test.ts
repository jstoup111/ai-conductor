import { describe, expect, it, vi } from 'vitest';

import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

const args = ['push', 'origin', 'HEAD:refs/heads/topic'];

function mutation(owner = 'alice'): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/repo', defaultBranch: 'main', specBranch: 'spec/topic',
      featureMarker: '.docs/specs/topic.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: owner }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/specs/topic.md', content: 'Owner: alice\n' }],
      },
    },
  };
}

function config(endpoint: 'https' | 'ssh') {
  const url = endpoint === 'https'
    ? 'https://github.com/acme/repo.git'
    : 'git@github.com:acme/repo.git';
  return vi.fn(async () => ({ stdout: `${url}\n` }));
}

describe('remote Git bot fallback', () => {
  it.each([
    ['https', 'token-unavailable'],
    ['https', 'auth-refused'],
    ['ssh', 'unsupported-remote-transport'],
  ] as const)('emits the %s refusal before one ambient-credential fallback', async (endpoint, reason) => {
    const refusal = new GithubBotAuthRefusalError(reason);
    const runRemoteGit = vi.fn()
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce({ stdout: '' });
    const events = { emit: vi.fn(async () => undefined) };

    await expect(executeRemoteGit(args, {
      cwd: '/fixture', config: config(endpoint), runRemoteGit, mutation: mutation(), events,
    })).resolves.toMatchObject({ kind: 'executed' });

    expect(events.emit).toHaveBeenCalledOnce();
    expect(events.emit).toHaveBeenCalledWith({
      type: 'github_write_credential_fallback',
      operation: 'remote-ref.push',
      target: { repository: 'acme/repo', kind: 'remote-ref', ref: 'refs/heads/topic' },
      reason,
    });
    expect(runRemoteGit).toHaveBeenNthCalledWith(1, args, {
      cwd: '/fixture', credential: 'write', endpoint,
    });
    expect(runRemoteGit).toHaveBeenNthCalledWith(2, args, {
      cwd: '/fixture', credential: 'operator', endpoint,
    });
  });

  it('returns failed without an operator attempt when fallback event delivery fails', async () => {
    const runRemoteGit = vi.fn(async () => { throw new GithubBotAuthRefusalError('auth-refused'); });
    const events = { emit: vi.fn(async () => { throw new Error('sink unavailable'); }) };

    await expect(executeRemoteGit(args, {
      cwd: '/fixture', config: config('https'), runRemoteGit, mutation: mutation(), events,
    })).resolves.toMatchObject({ kind: 'failed', error: 'sink unavailable' });

    expect(events.emit).toHaveBeenCalledOnce();
    expect(runRemoteGit).toHaveBeenCalledOnce();
    expect(runRemoteGit).toHaveBeenCalledWith(args, {
      cwd: '/fixture', credential: 'write', endpoint: 'https',
    });
  });

  it('refuses an unauthorized destination before the runner or fallback event', async () => {
    const runRemoteGit = vi.fn(async () => ({ stdout: '' }));
    const events = { emit: vi.fn(async () => undefined) };

    await expect(executeRemoteGit(args, {
      cwd: '/fixture', config: config('https'), runRemoteGit, mutation: mutation('bob'), events,
    })).resolves.toMatchObject({ kind: 'refused', reason: 'other-owner' });

    expect(runRemoteGit).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledOnce();
    expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'github_operation_refused',
    }));
  });

  it('does not emit or retry after a non-authentication push failure', async () => {
    const runRemoteGit = vi.fn(async () => { throw new Error('non-fast-forward'); });
    const events = { emit: vi.fn(async () => undefined) };

    await expect(executeRemoteGit(args, {
      cwd: '/fixture', config: config('https'), runRemoteGit, mutation: mutation(), events,
    })).resolves.toMatchObject({ kind: 'failed', error: 'non-fast-forward' });

    expect(runRemoteGit).toHaveBeenCalledOnce();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
