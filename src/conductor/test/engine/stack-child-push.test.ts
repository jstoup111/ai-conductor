// Covers: task:7, task:rem-prd-audit-rem-v3-intent-restack
// Covers: task:8
import { describe, expect, it, vi } from 'vitest';

import {
  pushChildClosure,
  verifyChildChain,
  type StackPublicationChild,
} from '../../src/engine/stack-publication.js';
import type { GitRunner } from '../../src/engine/rebase.js';

const children: readonly StackPublicationChild[] = [
  { position: 1 as never, branch: 'feat/c1/demo', closure: '1'.repeat(40) },
  { position: 3 as never, branch: 'feat/c3/demo', closure: '3'.repeat(40) },
];

function result(exitCode = 0, stdout = '') {
  return { exitCode, stdout, stderr: '' };
}

describe('stack child closure publication', () => {
  it('pushes an absent child closure exactly once with the canonical plain guarded push', async () => {
    const git = vi.fn<GitRunner>(async (args) => {
      if (args[0] === 'ls-remote') return result(0, '');
      if (args[0] === 'rev-parse') return result(1);
      throw new Error(`unexpected local git: ${args.join(' ')}`);
    });
    const remoteGit = vi.fn<(args: string[], options: unknown) => Promise<{ kind: 'executed'; targets: never[] }>>(async () => ({
      kind: 'executed', targets: [],
    }));

    await expect(pushChildClosure('/fixture', 'demo', children[0]!, {
      git,
      remoteGit: remoteGit as never,
      remote: {
        config: async () => ({ stdout: 'git@github.com:acme/demo.git\n' }),
        runRemoteGit: async () => ({ stdout: '' }),
      },
    })).resolves.toEqual({ kind: 'pushed', position: 1, tip: '1'.repeat(40) });
    expect(git.mock.calls.filter(([args]) => args[0] === 'ls-remote')).toHaveLength(1);
    expect(remoteGit).toHaveBeenCalledWith([
      'push', 'origin', `${'1'.repeat(40)}:refs/heads/feat/c1/demo`,
    ], expect.anything());
    expect(remoteGit.mock.calls[0]![0]).not.toContain('--force');
  });

  it('leaves a remote child alone unless its recorded pushed tip and closure exactly agree', async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === 'ls-remote') return result(0, `${'9'.repeat(40)}\trefs/heads/feat/c3/demo\n`);
      if (args[0] === 'rev-parse' && args.at(-1) === 'refs/conductor/demo/push-intent/feat/c3/demo') return result(1);
      if (args[0] === 'rev-parse') return result(0, `${'3'.repeat(40)}\n`);
      throw new Error(`unexpected local git: ${args.join(' ')}`);
    };
    const remoteGit = vi.fn();
    await expect(pushChildClosure('/fixture', 'demo', children[1]!, {
      git, remoteGit: remoteGit as never, remote: {} as never,
    })).resolves.toEqual({ kind: 'diverged', position: 3 });
    expect(remoteGit).not.toHaveBeenCalled();
  });

  it('adopts a crash-after-push intent for an unrecorded child before comparing its remote tip', async () => {
    const intentObject = 'a'.repeat(40);
    let recorded: string | undefined;
    let intentPresent = true;
    const git = vi.fn<GitRunner>(async (args) => {
      if (args[0] === 'ls-remote') return result(0, `${children[0]!.closure}\trefs/heads/feat/c1/demo\n`);
      if (args[0] === 'rev-parse' && args.at(-1) === 'refs/conductor/demo/push-intent/feat/c1/demo') {
        return intentPresent ? result(0, `${intentObject}\n`) : result(1);
      }
      if (args[0] === 'rev-parse' && args.at(-1) === 'refs/conductor/demo/pushed/feat/c1/demo') {
        return recorded === undefined ? result(1) : result(0, `${recorded}\n`);
      }
      if (args[0] === 'cat-file') return result(0, JSON.stringify({ new: children[0]!.closure }));
      if (args[0] === 'update-ref' && args[1] === 'refs/conductor/demo/pushed/feat/c1/demo') {
        recorded = args.at(2);
        return result();
      }
      if (args[0] === 'update-ref' && args[1] === '-d') {
        intentPresent = false;
        return result();
      }
      throw new Error(`unexpected local git: ${args.join(' ')}`);
    });
    const remoteGit = vi.fn();

    await expect(pushChildClosure('/fixture', 'demo', children[0]!, {
      git, remoteGit: remoteGit as never, remote: {} as never,
    })).resolves.toEqual({ kind: 'unchanged', position: 1, tip: children[0]!.closure });

    expect(recorded).toBe(children[0]!.closure);
    expect(intentPresent).toBe(false);
    expect(remoteGit).not.toHaveBeenCalled();
  });

  it('checks every successor against its predecessor closure', async () => {
    const git: GitRunner = async (args) => result(args.includes('refs/heads/feat/c3/demo') ? 1 : 0);
    await expect(verifyChildChain('/fixture', children, { git })).resolves.toEqual({ kind: 'broken', position: 1 });
  });
});
