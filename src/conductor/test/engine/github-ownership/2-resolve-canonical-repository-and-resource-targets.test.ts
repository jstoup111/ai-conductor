// Covers: task:2
import { describe, expect, it, vi } from 'vitest';

import {
  githubTargetsMatch,
  resolveGithubTarget,
} from '../../../src/engine/github-target.js';
import { executeGithubOperation } from '../../../src/engine/github-operations.js';

describe('engine/github-target — canonical repository and resource targets', () => {
  it('binds a GitHub issue-form URL to the pull-request identity returned by injected discovery', async () => {
    const discovery = {
      resolve: vi.fn().mockResolvedValue({
        repository: 'acme/rocket',
        resource: { kind: 'pull-request', number: 42 },
      }),
    };

    const resolved = await resolveGithubTarget(
      { url: 'https://github.com/Acme/Rocket/issues/42' },
      discovery,
    );

    expect(discovery.resolve).toHaveBeenCalledWith({ url: 'https://github.com/Acme/Rocket/issues/42' });
    expect(resolved).toEqual({
      kind: 'resolved',
      target: {
        repository: 'acme/rocket',
        kind: 'pull-request',
        number: 42,
      },
    });
  });

  it('resolves a remote ref through discovery and never matches the same branch in another repository', async () => {
    const discovery = {
      resolve: vi.fn().mockResolvedValue({
        repository: 'acme/rocket',
        resource: { kind: 'remote-ref', ref: 'refs/heads/feature/owned' },
      }),
    };

    const resolved = await resolveGithubTarget({ ref: 'refs/heads/feature/owned' }, discovery);

    if (resolved.kind !== 'resolved') throw new Error('expected resolved GitHub target');

    expect(resolved).toEqual({
      kind: 'resolved',
      target: {
        repository: 'acme/rocket',
        kind: 'remote-ref',
        ref: 'refs/heads/feature/owned',
      },
    });
    expect(githubTargetsMatch(
      resolved.target,
      { repository: 'acme/satellite', kind: 'remote-ref', ref: 'refs/heads/feature/owned' },
    )).toBe(false);
  });

  it.each([
    ['a malformed URL', { url: 'https://example.test/not-github' }, { resolve: vi.fn() }, 'invalid-target'],
    [
      'a URL whose explicit repository conflicts with its discovered repository',
      { repository: 'acme/rocket', url: 'https://github.com/acme/rocket/pull/42' },
      { resolve: vi.fn().mockResolvedValue({ repository: 'acme/other', resource: { kind: 'pull-request', number: 42 } }) },
      'invalid-target',
    ],
    [
      'an ambiguous discovery result',
      { ref: 'refs/heads/feature/owned' },
      { resolve: vi.fn().mockResolvedValue({ ambiguous: true }) },
      'invalid-target',
    ],
    [
      'a failed or timed-out discovery read',
      { ref: 'refs/heads/feature/owned' },
      { resolve: vi.fn().mockRejectedValue(new Error('discovery timed out')) },
      'invalid-target',
    ],
  ])('refuses %s before a target can reach mutation policy', async (_caseName, input, discovery, reason) => {
    await expect(resolveGithubTarget(input, discovery)).resolves.toEqual({ kind: 'refused', reason });
  });

  it.each([
    ['a bare repository input', { repository: 'acme/rocket' }],
    ['a bare GitHub repository URL', { url: 'https://github.com/acme/rocket' }],
  ])('refuses %s when discovery identifies a specific pull request', async (_caseName, input) => {
    const discovery = {
      resolve: vi.fn().mockResolvedValue({
        repository: 'acme/rocket',
        resource: { kind: 'pull-request', number: 42 },
      }),
    };

    await expect(resolveGithubTarget(input, discovery)).resolves.toEqual({
      kind: 'refused',
      reason: 'invalid-target',
    });
  });

  it.each([
    [
      'a malformed URL alias',
      {
        operation: 'issue.comment.create',
        repository: 'acme/rocket',
        url: 'https://example.test/acme/rocket/issues/17',
        resource: { kind: 'issue', number: 17 },
        context: { actor: 'operator-1' },
        payload: { body: 'never write' },
      },
      { resolve: vi.fn() },
    ],
    [
      'an ambiguous target discovery result',
      {
        operation: 'issue.comment.create',
        repository: 'acme/rocket',
        resource: { kind: 'issue', number: 17 },
        context: { actor: 'operator-1' },
        payload: { body: 'never write' },
      },
      { resolve: vi.fn().mockResolvedValue({ ambiguous: true }) },
    ],
    [
      'a discovery result for another repository',
      {
        operation: 'issue.comment.create',
        repository: 'acme/rocket',
        resource: { kind: 'issue', number: 17 },
        context: { actor: 'operator-1' },
        payload: { body: 'never write' },
      },
      {
        resolve: vi.fn().mockResolvedValue({
          repository: 'acme/satellite',
          resource: { kind: 'issue', number: 17 },
        }),
      },
    ],
  ])('refuses %s at the live operation boundary before the runner', async (_caseName, request, targetDiscovery) => {
    const runner = { run: vi.fn().mockResolvedValue({}) };

    await expect(executeGithubOperation(request, runner, { targetDiscovery })).resolves.toEqual({
      kind: 'refused',
      reason: 'invalid-target',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('runs the canonical resolved target rather than the caller-provided repository casing', async () => {
    const targetDiscovery = {
      resolve: vi.fn().mockResolvedValue({
        repository: 'acme/rocket',
        resource: { kind: 'issue', number: 17 },
      }),
    };
    const runner = { run: vi.fn().mockResolvedValue({}) };

    await expect(executeGithubOperation({
      operation: 'issue.comment.create',
      repository: 'Acme/Rocket',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'operator-1' },
      payload: { body: 'owned write' },
    }, runner, { targetDiscovery })).resolves.toMatchObject({ kind: 'executed' });

    expect(targetDiscovery.resolve).toHaveBeenCalledOnce();
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    }));
  });
});
