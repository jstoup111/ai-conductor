// Covers: task:35
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { pushedTipIntentRef, pushedTipRef, type PushLeaseGitRunner } from '../../src/engine/push-lease.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: readonly string[], input?: string): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', [...args], { cwd, input, reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
}

async function ref(cwd: string, name: string): Promise<string | undefined> {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', name]);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
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

describe('executeRemoteGit feature-branch tip recording (sweep G4)', () => {
  // Covers: task:35
  it('records the pushed SHA for plain and forced feat/daemon-demo pushes, deletes the intent only after the tip is recorded, and keeps the intent when recording fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'push-lease-recording-g4-'));
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
    await git(repository, ['checkout', '-b', 'feat/daemon-demo']);

    const pushedRef = pushedTipRef('demo', 'feat/daemon-demo');
    const intentRef = pushedTipIntentRef('demo', 'feat/daemon-demo');
    const ops: string[] = [];
    let failRecording = false;
    const leaseGit: PushLeaseGitRunner = async (args, input) => {
      if (args[0] === 'update-ref') {
        const deleting = args[1] === '-d';
        const target = deleting ? args[2] : args[1];
        const label = `${deleting ? 'delete' : 'write'} ${target === intentRef ? 'intent' : target === pushedRef ? 'pushed' : target}`;
        ops.push(label);
        if (failRecording && label === 'write pushed') return { stdout: '', exitCode: 1 };
      }
      return git(repository, args, input);
    };
    const dependencies = {
      cwd: repository,
      config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
      runRemoteGit: async (args: string[]) => {
        ops.push('remote push');
        return git(repository, args);
      },
      mutation: mutation(),
      pushLeaseGit: leaseGit,
    };

    // Plain push.
    await writeFile(join(repository, 'fixture.txt'), 'feature\n');
    await git(repository, ['commit', '-am', 'feature']);
    const plainTip = await ref(repository, 'HEAD');
    await expect(executeRemoteGit(['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], dependencies))
      .resolves.toMatchObject({ kind: 'executed' });
    expect(await ref(remote, 'refs/heads/feat/daemon-demo')).toBe(plainTip);
    expect(await ref(repository, pushedRef)).toBe(plainTip);
    expect(await ref(repository, intentRef)).toBeUndefined();
    expect(ops).toEqual(['write intent', 'remote push', 'write pushed', 'delete intent']);

    // Forced push of a rewritten (non-fast-forward) tip.
    ops.length = 0;
    await writeFile(join(repository, 'fixture.txt'), 'rewritten\n');
    await git(repository, ['commit', '-a', '--amend', '-m', 'feature rewritten']);
    const forcedTip = await ref(repository, 'HEAD');
    await expect(executeRemoteGit(['push', '--force', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], dependencies))
      .resolves.toMatchObject({ kind: 'executed' });
    expect(await ref(remote, 'refs/heads/feat/daemon-demo')).toBe(forcedTip);
    expect(await ref(repository, pushedRef)).toBe(forcedTip);
    expect(await ref(repository, intentRef)).toBeUndefined();
    expect(ops).toEqual(['write intent', 'remote push', 'write pushed', 'delete intent']);

    // A remote success whose tip recording fails keeps the intent naming the new SHA.
    ops.length = 0;
    failRecording = true;
    await writeFile(join(repository, 'fixture.txt'), 'third\n');
    await git(repository, ['commit', '-am', 'third']);
    const unrecordedTip = await ref(repository, 'HEAD');
    await expect(executeRemoteGit(['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], dependencies))
      .resolves.toMatchObject({ kind: 'executed' });
    expect(await ref(remote, 'refs/heads/feat/daemon-demo')).toBe(unrecordedTip);
    expect(await ref(repository, pushedRef)).toBe(forcedTip);
    const intent = await ref(repository, intentRef);
    expect(intent).toBeDefined();
    expect(JSON.parse((await git(repository, ['cat-file', 'blob', intent!])).stdout)).toEqual({
      expected: forcedTip, new: unrecordedTip,
    });
    expect(ops).toEqual(['write intent', 'remote push', 'write pushed']);
  });
});
