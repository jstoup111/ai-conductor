// Covers: task:16
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
      target: { repository: REPOSITORY, kind: 'remote-ref', ref: `refs/heads/${BRANCH}` },
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
          const response = await gh(args);
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

  it('routes post-create metadata, issue linkage, and criticality labels through the guarded boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'handoff-ownership-followups-'));
    try {
      await mkdir(join(root, '.github'), { recursive: true });
      await writeFile(
        join(root, '.github', 'pull_request_template.md'),
        'Release-Disposition: no-note\n',
        'utf8',
      );
      const context = mutation();
      const remoteWrites = vi.fn().mockResolvedValue({ stdout: '' });
      const guardedRequests: Array<{ operation: string }> = [];
      const rawWrites: string[][] = [];
      const runner = async (args: string[]) => {
        if ((args[0] === 'pr' && args[1] === 'edit') || (args[0] === 'api' && args.includes('POST'))) {
          rawWrites.push(args);
          throw new Error('raw GitHub mutation must not be called');
        }
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body: 'spec body' }) };
        if (args[0] === 'api') return { stdout: JSON.stringify([{ name: 'priority: high' }]) };
        return { stdout: '' };
      };
      const operations = {
        run: vi.fn(async (request) => {
          guardedRequests.push({ operation: request.operation });
          if (request.operation === 'pull-request.create') {
            return { created: { repository: REPOSITORY, kind: 'pull-request' as const, number: 42 } };
          }
          return {};
        }),
      };

      const result = await openSpecPr({ name: 'specs', canonicalPath: root, remote: `https://github.com/${REPOSITORY}.git` }, BRANCH, {
        runner: async (args, options) => ({
          ...(await runner(args)),
          stderr: '',
        }),
        gitRunner: async (args) => {
          if (args[0] === 'show') throw new Error('force post-create repair');
          return { stdout: '' };
        },
        ledgerOpts: { engineerDir: root },
        sourceRef: 'acme/intake#7',
        publication: {
          repository: REPOSITORY,
          remote: {
            cwd: root,
            config: async () => ({ stdout: `https://github.com/${REPOSITORY}.git\n` }),
            runRemoteGit: remoteWrites,
            mutation: context,
          },
          operations,
        },
      });

      expect(result).toEqual({ kind: 'pr-opened', url: PR_URL });
      expect(rawWrites).toEqual([]);
      expect(guardedRequests.map(({ operation }) => operation)).toEqual([
        'pull-request.create',
        'pull-request.edit',
        'pull-request.edit',
        'pull-request.label.add',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
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
