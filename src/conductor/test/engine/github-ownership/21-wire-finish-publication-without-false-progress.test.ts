// Covers: task:21
import { afterEach, describe, expect, it, vi } from 'vitest';

const machineOwner = vi.hoisted(() => ({ id: 'alice' }));
vi.mock('../../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/owner-gate/machine-identity.js')>();
  return {
    ...actual,
    readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: machineOwner.id })),
  };
});
afterEach(() => { machineOwner.id = 'alice'; });

import {
  createFinishPresentationRepair,
  createProvenanceGuardedFinishPresentationRepair,
} from '../../../src/engine/conductor.js';
import { openShipDraftPr } from '../../../src/engine/ship-draft-pr.js';
import type { GithubMutationExecutionContext } from '../../../src/engine/tracker-client.js';

const REPOSITORY = 'acme/rocket';
const BRANCH = 'feat/daemon-owned';
const MARKER = '.docs/intake/owned.md';

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: REPOSITORY,
      defaultBranch: 'main',
      specBranch: BRANCH,
      featureMarker: MARKER,
      publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: vi.fn().mockResolvedValue({ resolved: true, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: vi.fn().mockResolvedValue([{ path: MARKER, content: 'Owner: alice\n' }]),
      },
    },
  };
}

describe('finish publication guarded draft boundary', () => {
  it('fails closed when capture-only halt history lacks guarded comment authority', async () => {
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: 'needs-remediation: owned', body: 'halted', isDraft: true, labels: [], comments: [],
          }),
        };
      }
      throw new Error(`raw mutation must not run: ${args.join(' ')}`);
    });
    const repair = createFinishPresentationRepair({ projectRoot: '/fixture', gh });

    await expect(repair({
      prUrl: `https://github.com/${REPOSITORY}/pull/42`,
      state: { feature_desc: 'owned', worktree_branch: BRANCH },
      mode: 'capture-only',
    })).rejects.toThrow('guarded halt-history repair refused');

    expect(gh).toHaveBeenCalledTimes(1);
    expect(gh).toHaveBeenCalledWith(
      ['pr', 'view', `https://github.com/${REPOSITORY}/pull/42`, '--json', 'title,isDraft,labels,body,comments'],
      { cwd: '/fixture' },
    );
  });

  it('resolves fresh committed provenance for live presentation repair and refuses without a ready fallback', async () => {
    let draft = true;
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: 'feat: owned', body: '## Why\n\nOwned', isDraft: draft, labels: [], comments: [],
          }),
        };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        draft = false;
        return { stdout: '' };
      }
      throw new Error(`unexpected gh command: ${args.join(' ')}`);
    });
    const git = vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'config --get remote.origin.url') {
        return { stdout: `https://github.com/${REPOSITORY}.git\n` };
      }
      if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const repair = createProvenanceGuardedFinishPresentationRepair({
      projectRoot: '/fixture', git, gh, baseBranch: 'main',
    });
    const request = {
      prUrl: `https://github.com/${REPOSITORY}/pull/42`,
      state: { feature_desc: 'owned', worktree_branch: BRANCH },
    };

    await expect(repair(request)).resolves.toBeUndefined();
    expect(git).toHaveBeenCalledWith(['show', `${BRANCH}:.docs/intake/owned.md`], { cwd: '/fixture' });
    expect(gh).toHaveBeenCalledWith(['pr', 'ready', '42', '-R', REPOSITORY], { cwd: '/fixture' });

    draft = true;
    machineOwner.id = 'bob';
    await expect(repair(request)).rejects.toThrow('guarded ready-for-review repair refused');
    expect(git).toHaveBeenCalledTimes(4);
    expect(gh.mock.calls.filter(([args]) => args[0] === 'pr' && args[1] === 'ready')).toHaveLength(1);
  });

  it('publishes an authorized explicit ref and creates the draft through guarded transports', async () => {
    const remoteGit = vi.fn().mockResolvedValue({
      kind: 'executed',
      targets: [{ operation: 'remote-ref.push', repository: REPOSITORY, kind: 'remote-ref', ref: `refs/heads/${BRANCH}` }],
    });
    const operations = { run: vi.fn().mockResolvedValue({}) };
    let created = false;
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view' && created) {
        return { stdout: JSON.stringify({ state: 'OPEN', url: `https://github.com/${REPOSITORY}/pull/42` }) };
      }
      if (args[0] === 'pr' && args[1] === 'view') throw new Error('not found');
      return { stdout: '' };
    });
    operations.run.mockImplementation(async () => {
      created = true;
      return {};
    });
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      throw new Error(`unexpected raw Git write: ${args.join(' ')}`);
    });

    await expect(openShipDraftPr({
      cwd: '/fixture', branch: BRANCH, baseBranch: 'main', featureDesc: 'owned', gh, git,
      remoteGit, remoteMutation: mutation(), operations,
    })).resolves.toEqual({ outcome: 'published', prUrl: `https://github.com/${REPOSITORY}/pull/42` });

    expect(remoteGit).toHaveBeenCalledWith(
      ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`],
      expect.objectContaining({ cwd: '/fixture', runRemoteGit: git }),
    );
    expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'pull-request.create',
      target: { repository: REPOSITORY, kind: 'repository' },
      payload: expect.objectContaining({ head: BRANCH, base: 'main', draft: true }),
    }));
    expect(git.mock.calls.map(([args]) => args)).not.toContainEqual(
      ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`],
    );
  });

  it('refuses missing guarded publication dependencies before a raw push or PR create', async () => {
    const gh = vi.fn();
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      if (args[0] === 'config' || args.join(' ') === 'remote get-url --push origin') return { stdout: `https://github.com/${REPOSITORY}.git\n` };
      throw new Error(`unexpected command: ${args.join(' ')}`);
    });

    await expect(openShipDraftPr({
      cwd: '/fixture', branch: BRANCH, baseBranch: 'main', gh, git,
    })).resolves.toEqual({
      outcome: 'push-failed',
      reason: 'guarded remote publication refused: missing-provenance',
    });
    expect(git.mock.calls.map(([args]) => args)).not.toContainEqual(
      ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`],
    );
    expect(gh).not.toHaveBeenCalled();
  });

  it('retains a guarded remote refusal without creating a PR or claiming progress', async () => {
    const gh = vi.fn();
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      throw new Error(`unexpected raw Git write: ${args.join(' ')}`);
    });
    const remoteGit = vi.fn().mockResolvedValue({ kind: 'refused', reason: 'other-owner' });

    await expect(openShipDraftPr({
      cwd: '/fixture', branch: BRANCH, baseBranch: 'main', gh, git,
      remoteGit, remoteMutation: mutation(),
    })).resolves.toEqual({
      outcome: 'push-failed',
      reason: 'guarded remote publication refused: other-owner',
    });
    expect(gh).not.toHaveBeenCalled();
    expect(git.mock.calls.map(([args]) => args)).not.toContainEqual(
      ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`],
    );
  });
});
