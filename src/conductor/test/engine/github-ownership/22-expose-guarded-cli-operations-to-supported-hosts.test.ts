// Covers: task:22
import { describe, expect, it, vi } from 'vitest';
import { dispatchGithubOperationCommand, detectGithubOperationCommand } from '../../../src/engine/github-operations-cli.js';

const readRequest = (request: object) => vi.fn().mockResolvedValue(JSON.stringify(request));
const issueRead = {
  operation: 'issue.read', repository: 'acme/widgets', resource: { kind: 'issue', number: 7 }, context: { actor: 'alice' },
};

describe('github-operation CLI', () => {
  it('serializes executed, refused, failed, and partial guarded results with canonical targets', async () => {
    const cases = [
      { name: 'executed', response: {}, exit: 0, kind: 'executed' },
      { name: 'refused', response: { kind: 'refused' as const, reason: 'missing-provenance' as const }, exit: 1, kind: 'refused' },
      { name: 'failed', error: new Error('transport unavailable'), exit: 1, kind: 'failed' },
      {
        name: 'partial',
        response: {
          created: { repository: 'acme/widgets', kind: 'issue' as const, number: 9 },
          metadataFailures: [{ operation: 'issue.label.add' as const, error: 'label unavailable' }],
        },
        exit: 1,
        kind: 'partial',
      },
    ];

    for (const testCase of cases) {
      const write = vi.fn();
      const run = testCase.error
        ? vi.fn().mockRejectedValue(testCase.error)
        : vi.fn().mockResolvedValue(testCase.response);
      const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
        cwd: '/fixture', readRequest: readRequest(issueRead), runner: { run }, write,
      });
      const output = JSON.parse(write.mock.calls[0]?.[0] ?? '') as { kind: string; target: unknown };
      expect(exit, testCase.name).toBe(testCase.exit);
      expect(output.kind, testCase.name).toBe(testCase.kind);
      expect(output.target, testCase.name).toEqual(testCase.kind === 'partial'
        ? { repository: 'acme/widgets', kind: 'issue', number: 9 }
        : { repository: 'acme/widgets', kind: 'issue', number: 7 });
    }
  });

  it('accepts only the closed request-file command form and never forwards trailing argv', () => {
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', '--request-file', 'request.json']))
      .toEqual({ requestFile: 'request.json' });
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', 'gh', 'api'])).toBeNull();
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', '--request-file', 'request.json', 'gh', 'api'])).toBeNull();
  });

  it('grants shared authority only through an injected positive interactive confirmation for that request', async () => {
    const write = vi.fn();
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn().mockResolvedValue(true) };
    const request = {
      operation: 'label-definition.update', repository: 'acme/widgets',
      resource: { kind: 'label-definition', name: 'priority' }, context: { actor: 'alice' },
      payload: { name: 'priority', color: '123abc' },
    };
    const gh = vi.fn().mockResolvedValue({ stdout: '' });
    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), confirmation, gh, write,
    });

    expect(exit).toBe(0);
    expect(confirmation.confirm).toHaveBeenCalledOnce();
    expect(gh).toHaveBeenCalledWith(['label', 'edit', 'priority', '-R', 'acme/widgets', '--color', '123abc'], { cwd: '/fixture' });

    const noConfirmationWrite = vi.fn();
    const noConfirmationExit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), gh, write: noConfirmationWrite,
    });
    expect(noConfirmationExit).toBe(1);
    expect(gh).toHaveBeenCalledTimes(1);
    expect(noConfirmationWrite.mock.calls[0]?.[0]).toContain('explicit-authorization-required');
  });

  it('composes owned-worktree PR authority per request, refuses a foreign PR, and routes refs to guarded remote Git', async () => {
    const writes: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'branch --show-current') return { stdout: 'feat/widget\n' };
      if (args[0] === 'config') return { stdout: 'git@github.com:acme/widgets.git\n' };
      if (args.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD') return { stdout: 'refs/remotes/origin/main\n' };
      if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
      throw new Error(`unexpected git read: ${args.join(' ')}`);
    });
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ number: 7 }) };
      writes.push(args);
      return { stdout: '' };
    });
    const pr = {
      operation: 'pull-request.edit', repository: 'acme/widgets',
      resource: { kind: 'pull-request', number: 7 }, context: { actor: 'alice', feature: 'widget' },
      payload: { body: 'owned change' },
    };
    const foreign = { ...pr, resource: { kind: 'pull-request', number: 8 } };
    const output = vi.fn();

    const ownedExit = await dispatchGithubOperationCommand({ requestFile: '/owned.json' }, {
      cwd: '/fixture', readRequest: readRequest(pr), gh, git, resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }), write: output,
    });
    expect(ownedExit, JSON.stringify(output.mock.calls)).toBe(0);
    await expect(dispatchGithubOperationCommand({ requestFile: '/foreign.json' }, {
      cwd: '/fixture', readRequest: readRequest(foreign), gh, git, resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }), write: output,
    })).resolves.toBe(1);

    const remoteGit = vi.fn(async () => ({ kind: 'executed' as const, targets: [] }));
    await expect(dispatchGithubOperationCommand({ requestFile: '/push.json' }, {
      cwd: '/fixture',
      readRequest: readRequest({
        operation: 'remote-ref.push', repository: 'acme/widgets',
        resource: { kind: 'remote-ref', ref: 'refs/heads/feat/widget' },
        context: { actor: 'alice', feature: 'widget' },
      }),
      gh, git, remoteGit, resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }), write: output,
    })).resolves.toBe(0);

    expect(writes).toContainEqual(['pr', 'edit', '7', '-R', 'acme/widgets', '--body', 'owned change']);
    expect(remoteGit).toHaveBeenCalledOnce();
  });

  it('refuses a request for another feature or default branch before the push boundary', async () => {
    const git = vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'branch --show-current') return { stdout: 'feat/widget\n' };
      if (args[0] === 'config') return { stdout: 'git@github.com:acme/widgets.git\n' };
      if (args.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD') return { stdout: 'refs/remotes/origin/main\n' };
      if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
      if (args[0] === 'push') return { stdout: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const gh = vi.fn().mockResolvedValue({ stdout: 'alice\n' });
    const owner = async () => ({ resolved: true as const, id: 'alice' });

    for (const ref of ['refs/heads/feat/another-owner', 'refs/heads/main']) {
      const write = vi.fn();
      await expect(dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
        cwd: '/fixture',
        readRequest: readRequest({
          operation: 'remote-ref.push', repository: 'acme/widgets',
          resource: { kind: 'remote-ref', ref },
          context: { actor: 'alice', feature: 'widget' },
        }),
        gh, git, resolveMachineOwner: owner, write,
      })).resolves.toBe(1);
      expect(JSON.parse(write.mock.calls[0]?.[0] ?? '')).toMatchObject({ kind: 'refused', reason: 'invalid-target' });
    }
    expect(git.mock.calls.filter(([args]) => args[0] === 'push')).toEqual([]);

    await expect(dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: '/fixture',
      readRequest: readRequest({
        operation: 'remote-ref.push', repository: 'acme/widgets',
        resource: { kind: 'remote-ref', ref: 'refs/heads/feat/widget' },
        context: { actor: 'alice', feature: 'widget' },
      }),
      gh, git, resolveMachineOwner: owner, write: vi.fn(),
    })).resolves.toBe(0);
    expect(git).toHaveBeenCalledWith(['push', 'origin', 'HEAD:refs/heads/feat/widget'], { cwd: '/fixture' });
  });

  it('permits only an exact interactive initial-publication approval when no feature provenance exists', async () => {
    const request = {
      operation: 'remote-ref.push', repository: 'acme/widgets',
      resource: { kind: 'remote-ref', ref: 'refs/heads/main' }, context: { actor: 'alice' },
    };
    const git = vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'branch --show-current') return { stdout: 'main\n' };
      if (args[0] === 'config') return { stdout: 'git@github.com:acme/widgets.git\n' };
      if (args.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD') throw new Error('empty remote');
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const remoteGit = vi.fn(async () => ({ kind: 'executed' as const, targets: [] }));
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn().mockResolvedValue(true) };

    await expect(dispatchGithubOperationCommand({ requestFile: '/push.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), git, remoteGit, confirmation, write: vi.fn(),
    })).resolves.toBe(0);
    expect(remoteGit).toHaveBeenCalledOnce();
    const remoteInvocation = remoteGit.mock.calls[0] as unknown as [string[], Record<string, unknown>];
    expect(remoteInvocation[0]).toEqual(['push', 'origin', 'HEAD:refs/heads/main']);
    expect(remoteInvocation[1]).toMatchObject({
      explicitApproval: { request: expect.objectContaining({ operation: 'remote-ref.push', target: { repository: 'acme/widgets', kind: 'remote-ref', ref: 'refs/heads/main' } }) },
    });

    for (const denied of [undefined, { mode: 'interactive' as const, confirm: vi.fn().mockResolvedValue(false) }]) {
      const rejectedRemote = vi.fn(async () => ({ kind: 'executed' as const, targets: [] }));
      await expect(dispatchGithubOperationCommand({ requestFile: '/push.json' }, {
        cwd: '/fixture', readRequest: readRequest(request), git, remoteGit: rejectedRemote, confirmation: denied, write: vi.fn(),
      })).resolves.toBe(1);
      expect(rejectedRemote).not.toHaveBeenCalled();
    }

    await expect(dispatchGithubOperationCommand({ requestFile: '/push.json' }, {
      cwd: '/fixture',
      readRequest: readRequest({ ...request, repository: 'acme/other' }),
      git, confirmation, write: vi.fn(),
    })).resolves.toBe(1);
    expect(git.mock.calls.filter(([args]) => args[0] === 'push')).toEqual([]);
  });

  it('forwards exact interactive approval to intake authorization and refuses a declined request before mutation', async () => {
    const request = {
      operation: 'intake.issue.close', repository: 'acme/widgets',
      resource: { kind: 'issue', number: 7 }, context: { actor: 'alice' },
    };
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ assignees: [] }) };
      return { stdout: '' };
    });
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn().mockResolvedValue(true) };
    await expect(dispatchGithubOperationCommand({ requestFile: '/issue.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), gh, confirmation,
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }), write: vi.fn(),
    })).resolves.toBe(0);
    expect(confirmation.confirm).toHaveBeenCalledOnce();
    expect(gh).toHaveBeenLastCalledWith(['issue', 'close', '7', '-R', 'acme/widgets'], { cwd: '/fixture' });

    const refusedGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ assignees: [] }) };
      return { stdout: '' };
    });
    await expect(dispatchGithubOperationCommand({ requestFile: '/issue.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), gh: refusedGh,
      confirmation: { mode: 'interactive', confirm: vi.fn().mockResolvedValue(false) },
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }), write: vi.fn(),
    })).resolves.toBe(1);
    expect(refusedGh.mock.calls.filter(([args]) => args[0] === 'issue' && args[1] === 'close')).toEqual([]);
  });
});
