// Covers: task:35
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execa } from 'execa';

import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { pushedTipIntentRef, pushedTipRef, type PushLeaseGitRunner } from '../../src/engine/push-lease.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: readonly string[], input?: string): Promise<{ stdout: string; exitCode: number }> {
  // execFile has no stdin option; the injected lease runner below uses execa
  // for the one hash-object call that needs it.
  void input;
  try {
    const result = await execFile('git', [...args], { cwd });
    return { stdout: result.stdout, exitCode: 0 };
  } catch (error: any) {
    return { stdout: error.stdout ?? '', exitCode: error.code ?? 1 };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'push-lease-recording-'));
  roots.push(root);
  const repository = join(root, 'repository');
  const remote = join(root, 'origin.git');
  await mkdir(repository);
  await initTestRepo(repository);
  await writeFile(join(repository, 'fixture.txt'), 'initial\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'seed']);
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await git(repository, ['remote', 'add', 'origin', remote]);
  return { repository, remote };
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/rocket', defaultBranch: 'main', specBranch: 'spec/demo',
      featureMarker: '.docs/specs/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

function dependencies(repository: string, runner?: PushLeaseGitRunner) {
  return {
    cwd: repository,
    config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
    runRemoteGit: (args: string[]) => git(repository, args),
    mutation: mutation(),
    pushLeaseGit: runner,
  };
}

async function ref(repository: string, name: string): Promise<string | undefined> {
  const result = await git(repository, ['rev-parse', '--verify', '--quiet', name]);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

describe('feature-branch push lease recording', () => {
  it.each([
    ['plain', []],
    ['forced', ['--force']],
  ] as const)('records and clears intent after a successful %s feature push', async (_kind, flags) => {
    const { repository } = await fixture();
    await git(repository, ['checkout', '-b', 'feat/daemon-demo']);
    await writeFile(join(repository, 'fixture.txt'), 'feature\n');
    await git(repository, ['add', '.']);
    await git(repository, ['commit', '-m', 'feature']);
    const expected = await ref(repository, 'HEAD');

    await expect(executeRemoteGit(
      ['push', ...flags, 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository),
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(await ref(repository, pushedTipRef('demo', 'feat/daemon-demo'))).toBe(expected);
    expect(await ref(repository, pushedTipIntentRef('demo', 'feat/daemon-demo'))).toBeUndefined();
  });

  it('leaves no pushed-tip ref after a successful non-feature push', async () => {
    const { repository } = await fixture();
    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/main'], dependencies(repository),
    )).resolves.toMatchObject({ kind: 'executed' });

    const refs = await git(repository, ['for-each-ref', '--format=%(refname)', 'refs/conductor/']);
    expect(refs.stdout.trim()).toBe('');
  });

  it('retains the intent when a remote success cannot record its pushed tip', async () => {
    const { repository } = await fixture();
    await git(repository, ['checkout', '-b', 'feat/daemon-demo']);
    const real: PushLeaseGitRunner = async (args, input) => {
      const result = await execa('git', [...args], { cwd: repository, input, reject: false });
      return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
    };
    const failRecord: PushLeaseGitRunner = async (args, input) =>
      args[0] === 'update-ref' && args[1] === pushedTipRef('demo', 'feat/daemon-demo')
        ? { stdout: '', exitCode: 1 }
        : real(args, input);

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], dependencies(repository, failRecord),
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(await ref(repository, pushedTipRef('demo', 'feat/daemon-demo'))).toBeUndefined();
    expect(await ref(repository, pushedTipIntentRef('demo', 'feat/daemon-demo'))).toBeDefined();
  });
});
