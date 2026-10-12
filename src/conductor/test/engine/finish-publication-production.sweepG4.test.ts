// Covers: task:34
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { GithubOperationRunner } from '../../src/engine/github-operations.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import type { ConductState } from '../../src/types/index.js';

function remoteMutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/widget', defaultBranch: 'main', specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/intake/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/intake/demo.md', content: 'Owner: alice\n' }],
      },
    },
  };
}

/** Fixture-owned GitHub boundary replaying typed PR operations as gh argv. */
function guardedOperations(
  gh: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>,
): GithubOperationRunner {
  return {
    async run(request) {
      if (request.operation === 'pull-request.create') {
        if (!request.payload || !('head' in request.payload) || !('base' in request.payload)) {
          throw new Error('missing PR creation payload');
        }
        await gh(['pr', 'create', '--head', request.payload.head, '--base', request.payload.base], { cwd: '/fixture' });
        return {};
      }
      throw new Error(`unexpected operation: ${request.operation}`);
    },
  };
}

describe('stacked FINISH publication (sweep G4)', () => {
  // Covers: task:34
  it('stacked FINISH publication pushes only the leaf branch and never a feat/c<k>/demo child branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-stacked-g4-'));
    try {
      const pipeline = join(root, '.pipeline');
      // Durable child state for a three-child stack: two closed children
      // with their own private branches, and the leaf.
      await mkdir(join(pipeline, 'children', '1'), { recursive: true });
      await mkdir(join(pipeline, 'children', '2'), { recursive: true });
      const state = {
        feature_desc: 'demo',
        worktree_branch: 'feat/daemon-demo',
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState;
      const prUrl = 'https://github.com/acme/widget/pull/2945';
      const remoteTip = 'b'.repeat(40);
      let created = false;
      const rawPushes: string[][] = [];
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'config') return { stdout: 'https://github.com/acme/widget.git\n' };
        if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
        if (args[0] === 'remote') return { stdout: 'origin\n' };
        if (args[0] === 'rev-list') return { stdout: '3\n' };
        if (args[0] === 'rev-parse') return { stdout: `${remoteTip}\n` };
        if (args[0] === 'for-each-ref') {
          return { stdout: 'refs/heads/feat/c1/demo\nrefs/heads/feat/c2/demo\nrefs/heads/feat/daemon-demo\n' };
        }
        if (args[0] === 'push') {
          rawPushes.push([...args]);
          return { stdout: '' };
        }
        return { stdout: '' };
      });
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === 'feat/daemon-demo') {
          if (!created) throw new Error('no open PR');
          return { stdout: JSON.stringify({ url: prUrl, state: 'OPEN' }) };
        }
        if (args[0] === 'pr' && args[1] === 'create') {
          created = true;
          return { stdout: `${prUrl}\n` };
        }
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl) {
          return { stdout: JSON.stringify({ url: prUrl, title: 'draft', body: 'draft', isDraft: true }) };
        }
        return { stdout: '' };
      });
      const remoteGit = vi.fn(async (_args: readonly string[]) => ({
        kind: 'executed' as const,
        targets: [{
          operation: 'remote-ref.push' as const, repository: 'acme/widget', kind: 'remote-ref' as const,
          ref: 'refs/heads/feat/daemon-demo', endpoint: 'https' as const,
        }],
      }));
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        git,
        gh,
        operations: guardedOperations(gh),
        remoteMutation: remoteMutation(),
        remoteGit,
        baseBranch: 'main',
        observeReleaseReadiness: async () => 'present',
      });

      const outcome = await coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => {},
      });

      const pushArgv = remoteGit.mock.calls.map(([args]) => [...args]);
      expect(pushArgv.length).toBeGreaterThan(0);
      for (const args of pushArgv) {
        expect(args.join(' ')).not.toMatch(/feat\/c\d+\/demo/);
        const refspec = args.find((arg) => arg.includes(':refs/heads/'));
        expect(refspec).toBe('HEAD:refs/heads/feat/daemon-demo');
      }
      expect(rawPushes).toEqual([]);
      expect(outcome).toEqual({ kind: 'publication_progress', transition: 'establish_pr' });
      await expect(readFile(join(pipeline, 'conduct-state.json'), 'utf8')).resolves.toContain(`"pr_url": "${prUrl}"`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
