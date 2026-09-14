// Covers: task:16
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { readAuthoredKeys } from '../../../src/engine/engineer/authored-ledger.js';
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
  it('refuses an absent publication composition before a raw push or PR create', async () => {
    const engineerDir = await mkdtemp(join(tmpdir(), 'handoff-ownership-'));
    try {
      const git = vi.fn();
      const gh = vi.fn();
      const result = await openSpecPr({ name: 'specs', canonicalPath: '/fixture', remote: `https://github.com/${REPOSITORY}.git` }, BRANCH, {
        runner: gh,
        gitRunner: git,
        ledgerOpts: { engineerDir },
      });

      expect(result).toEqual({ kind: 'pr-refused', reason: 'missing-provenance' });
      expect(git).not.toHaveBeenCalled();
      expect(gh).not.toHaveBeenCalled();
      await expect(readAuthoredKeys({ engineerDir })).resolves.toEqual([]);
    } finally {
      await rm(engineerDir, { recursive: true, force: true });
    }
  });

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

  it('derives guarded publication for injected CLI transports instead of using the former raw path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'handoff-cli-ownership-'));
    try {
      const registryPath = join(root, 'registry.json');
      await writeFile(registryPath, JSON.stringify([{
        schemaVersion: 1,
        name: 'specs',
        path: root,
        remote: `https://github.com/${REPOSITORY}.git`,
        status: 'registered',
        registeredAt: '2026-09-14T00:00:00.000Z',
      }]), 'utf8');
      const gitCalls: string[][] = [];
      const ghCalls: string[][] = [];
      const git = async (args: string[]) => {
        gitCalls.push(args);
        if (args[0] === 'config') return { stdout: `https://github.com/${REPOSITORY}.git\n` };
        if (args[0] === 'show') return { stdout: 'Owner: bob\n' };
        return { stdout: '' };
      };
      const gh = async (args: string[]) => {
        ghCalls.push(args);
        if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
        return { stdout: '' };
      };
      const errors: string[] = [];
      const code = await dispatchEngineer(
        { kind: 'handoff', project: 'specs', branch: BRANCH, worktree: root },
        { registryPath, engineerDir: join(root, 'engineer'), git, gh, printErr: (message) => errors.push(message) },
      );

      expect(code).toBe(1);
      expect(errors.join('')).toMatch(/publication refused \(other-owner\).*worktree kept/i);
      expect(gitCalls.some((args) => args[0] === 'push')).toBe(false);
      expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'create')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
