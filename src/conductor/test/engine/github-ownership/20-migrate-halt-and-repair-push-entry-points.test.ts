// Covers: task:20
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pushRefreshedBranch } from '../../../src/engine/autoresolve.js';
import { escalateBuildFailure } from '../../../src/engine/build-failure-escalation.js';
import { pushPostFinishShippedRecord } from '../../../src/engine/conductor.js';
import { publishHaltRecord } from '../../../src/engine/halt-record.js';
import { makeProductionRepairPublisher } from '../../../src/engine/shipment-evidence-cli.js';
import type { GithubMutationExecutionContext } from '../../../src/engine/tracker-client.js';

const scratch: string[] = [];
afterEach(async () => Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

function mutationContext() {
  const resolveMachineOwner = vi.fn().mockResolvedValue({ resolved: true as const, id: 'alice' });
  const readCommittedRecords = vi.fn().mockResolvedValue([
    { path: '.docs/intake/feature.md', content: 'Owner: alice\n' },
  ]);
  return {
    provenance: {
      repository: 'acme/rocket',
      defaultBranch: 'origin/main',
      specBranch: 'feature/owned',
      featureMarker: '.docs/intake/feature.md',
      publication: 'merged' as const,
    },
    dependencies: { resolveMachineOwner, provenanceDiscovery: { readCommittedRecords } },
  } satisfies GithubMutationExecutionContext;
}

function guardedGit(pushes: string[][]) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'config') return { stdout: 'git@github.com:acme/rocket.git\n' };
    if (args[0] === 'push') pushes.push([...args]);
    return { stdout: '' };
  });
}

describe('engine remote Git publication callers', () => {
  it('authorizes halt, lease repair, and conductor publications at the real guard before the fake process seam', async () => {
    const haltPushes: string[][] = [];
    const haltMutation = mutationContext();
    await publishHaltRecord('/fixture', 'feature/halted', {
      git: guardedGit(haltPushes),
      gh: vi.fn(),
      mutation: haltMutation,
    }, 'feature');
    expect(haltMutation.dependencies.resolveMachineOwner).toHaveBeenCalledOnce();
    expect(haltPushes).toEqual([['push', 'origin', 'HEAD:refs/heads/feature/halted']]);

    const repairPushes: string[][] = [];
    const repairMutation = mutationContext();
    const repairGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'config') return { exitCode: 0, stdout: 'git@github.com:acme/rocket.git\n', stderr: '' };
      if (args[0] === 'push') repairPushes.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await expect(pushRefreshedBranch(
      repairGit,
      'feature/repaired',
      undefined,
      { mutation: repairMutation },
    )).resolves.toEqual({ pushed: true });
    expect(repairMutation.dependencies.provenanceDiscovery.readCommittedRecords).toHaveBeenCalledOnce();
    expect(repairPushes).toEqual([['push', 'origin', 'HEAD:refs/heads/feature/repaired', '--force-with-lease']]);

    const conductorPushes: string[][] = [];
    const conductorMutation = mutationContext();
    await pushPostFinishShippedRecord({
      cwd: '/fixture',
      branch: 'feature/finished',
      runGit: guardedGit(conductorPushes),
      remoteMutation: conductorMutation,
    });
    expect(conductorMutation.dependencies.resolveMachineOwner).toHaveBeenCalledOnce();
    expect(conductorPushes).toEqual([['push', 'origin', 'HEAD:refs/heads/feature/finished']]);
  });

  it('stops escalation before any PR or comment when the real guard refuses', async () => {
    const runGh = vi.fn().mockResolvedValue({ stdout: '' });
    const remoteWrites: string[][] = [];
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'feature/escalation\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'refs/remotes/origin/main\n' };
      if (args[0] === 'merge-base') return { stdout: 'base\n' };
      if (args[0] === 'config') return { stdout: 'git@github.com:acme/rocket.git\n' };
      if (args[0] === 'push') remoteWrites.push([...args]);
      return { stdout: '1\n' };
    });
    const refused = mutationContext();
    refused.dependencies.resolveMachineOwner.mockResolvedValue({ resolved: true as const, id: 'bob' });

    await expect(escalateBuildFailure({
      projectRoot: '/fixture',
      failureReason: 'failed build',
      runGit,
      runGh,
      remoteMutation: refused,
    })).resolves.toEqual({});
    expect(refused.dependencies.provenanceDiscovery.readCommittedRecords).toHaveBeenCalledOnce();
    expect(remoteWrites).toEqual([]);
    expect(runGh).not.toHaveBeenCalled();
  });

  it('authorizes shipment repair through the real guard and performs no fallback push', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'remote-git-repair-'));
    scratch.push(cwd);
    const pushes: string[][] = [];
    const mutation = mutationContext();
    const runGit = guardedGit(pushes);
    runGit.mockImplementation(async (args: string[]) => {
      if (args[0] === 'config') return { stdout: 'git@github.com:acme/rocket.git\n' };
      if (args[0] === 'diff') return { stdout: '.docs/shipped/feature.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'repair-head\n' };
      if (args[0] === 'push') pushes.push([...args]);
      return { stdout: '' };
    });
    const publisher = makeProductionRepairPublisher({
      cwd,
      implementationPr: 'https://github.com/acme/rocket/pull/42',
      slug: 'feature',
      runGh: vi.fn(),
      runGit,
      evaluateEvidence: vi.fn(),
      repo: 'acme/rocket',
      remoteMutation: mutation,
    });

    await publisher.commitRecordOnly({
      branch: 'repair/feature',
      writes: [{ path: '.docs/shipped/feature.md', content: 'record\n' }],
    });

    expect(mutation.dependencies.resolveMachineOwner).toHaveBeenCalledOnce();
    expect(pushes).toEqual([['push', 'origin', 'HEAD:refs/heads/repair/feature']]);
  });
});
