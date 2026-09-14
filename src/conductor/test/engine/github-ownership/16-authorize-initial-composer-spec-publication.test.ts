// Covers: task:16
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import { createGuardedGithubOperationRunner, type GithubMutationExecutionContext } from '../../../src/engine/tracker-client.js';

const REPOSITORY = 'acme/specs';
const BRANCH = 'spec/owned-feature';
const MARKER = '.docs/intake/owned-feature.md';
const PR_URL = `https://github.com/${REPOSITORY}/pull/42`;

function mutation(identity = 'alice'): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: REPOSITORY,
      defaultBranch: BRANCH,
      specBranch: BRANCH,
      featureMarker: MARKER,
      publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: vi.fn().mockResolvedValue({ resolved: true, id: identity }),
      provenanceDiscovery: {
        readCommittedRecords: vi.fn().mockResolvedValue([{ path: MARKER, content: 'Owner: alice\n' }]),
      },
    },
  };
}

describe('composer handoff — initial spec publication ownership', () => {
  it('uses committed spec-branch provenance before its guarded push and PR creation', async () => {
    const engineerDir = await mkdtemp(join(tmpdir(), 'handoff-ownership-'));
    try {
      const context = mutation();
      const remoteWrites = vi.fn().mockResolvedValue({ stdout: '' });
      const ghCalls: string[][] = [];
      const gh = async (args: string[]) => {
        ghCalls.push(args);
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL }) };
        return { stdout: '' };
      };
      const result = await openSpecPr({ name: 'specs', canonicalPath: '/fixture', remote: `https://github.com/${REPOSITORY}.git` }, BRANCH, {
        runner: async (args, options) => {
          const response = await gh(args, { cwd: options?.cwd ?? '/fixture' });
          return { stdout: response.stdout, stderr: '' };
        },
        gitRunner: async () => ({ stdout: '' }),
        ledgerOpts: { engineerDir },
        publication: {
          repository: REPOSITORY,
          remote: {
            cwd: '/fixture',
            config: async () => ({ stdout: `git@github.com:${REPOSITORY}.git\n` }),
            runRemoteGit: remoteWrites,
            mutation: context,
          },
          operations: createGuardedGithubOperationRunner(gh, { cwd: '/fixture', mutation: context }),
        },
      });

      expect(result).toEqual({ kind: 'pr-opened', url: PR_URL });
      expect(context.dependencies.provenanceDiscovery.readCommittedRecords).toHaveBeenCalledWith({
        repository: REPOSITORY,
        ref: BRANCH,
      });
      expect(remoteWrites).toHaveBeenCalledWith(
        ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`], { cwd: '/fixture' },
      );
      expect(ghCalls).toEqual(expect.arrayContaining([
        expect.arrayContaining(['pr', 'create']),
      ]));
    } finally {
      await rm(engineerDir, { recursive: true, force: true });
    }
  });

  it('refuses a foreign spec owner before any push, PR create, or delivered ledger record', async () => {
    const engineerDir = await mkdtemp(join(tmpdir(), 'handoff-ownership-'));
    try {
      const context = mutation('bob');
      const remoteWrites = vi.fn();
      const gh = vi.fn();
      const result = await openSpecPr({ name: 'specs', canonicalPath: '/fixture', remote: `https://github.com/${REPOSITORY}.git` }, BRANCH, {
        runner: async () => ({ stdout: PR_URL, stderr: '' }),
        gitRunner: async () => ({ stdout: '' }),
        ledgerOpts: { engineerDir },
        publication: {
          repository: REPOSITORY,
          remote: {
            cwd: '/fixture',
            config: async () => ({ stdout: `https://github.com/${REPOSITORY}.git\n` }),
            runRemoteGit: remoteWrites,
            mutation: context,
          },
          operations: createGuardedGithubOperationRunner(gh, { cwd: '/fixture', mutation: context }),
        },
      });

      expect(result).toEqual({ kind: 'pr-refused', reason: 'other-owner' });
      expect(remoteWrites).not.toHaveBeenCalled();
      expect(gh).not.toHaveBeenCalled();
    } finally {
      await rm(engineerDir, { recursive: true, force: true });
    }
  });
});
