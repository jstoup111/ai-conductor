// Covers: task:13
// An absent user-level github_bot block must preserve the ambient credential
// behavior of both guarded gh writes and authorized HTTPS pushes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { execFile as ExecFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = {
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
  failure: undefined as Error | undefined,
};

const mockExecFile = ((file: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  boundary.calls.push({ file, args, options });
  queueMicrotask(() => callback(boundary.failure ?? null, '{}', ''));
  return {};
}) as typeof ExecFile;

import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { makeProductionGit } from '../../src/engine/pr-labels.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

function featureMutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/repo', defaultBranch: 'main', specBranch: 'feature/topic',
      featureMarker: '.docs/intake/topic.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/intake/topic.md', content: 'Owner: alice\n' }],
      },
    },
  };
}

describe('unconfigured GitHub bot credential', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-unconfigured-'));
    boundary.calls.length = 0;
    boundary.failure = undefined;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps guarded writes and authorized pushes ambient without fallback telemetry', async () => {
    const events: unknown[] = [];
    const productionDependencies = {
      execFile: mockExecFile,
      readCredential: async () => ({ kind: 'unconfigured' as const }),
      readToken: async () => ({ kind: 'unavailable' as const }),
      assertRealExecAllowed: () => {},
    };
    const guarded = createGuardedGithubOperationRunner(makeProductionGh(productionDependencies), {
      cwd: root,
      creation: { authorize: async () => ({}) },
      events: { emit: async (event) => { events.push(event); } },
    });

    await guarded.run({
      operation: 'issue.comment.create', access: 'feature-write',
      target: { repository: 'acme/repo', kind: 'issue', number: 1 },
      context: { actor: 'operator' }, payload: { body: 'comment' },
    });

    // Prove the process boundary was reached before checking its unchanged options.
    expect(boundary.calls).toHaveLength(1);
    expect(boundary.calls[0]).toEqual({
      file: 'gh', args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'comment'],
      options: { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: undefined },
    });

    boundary.calls.length = 0;
    await expect(executeRemoteGit(['push', 'origin', 'HEAD:refs/heads/topic'], {
      cwd: root,
      config: async () => ({ stdout: 'https://github.com/acme/repo.git\n' }),
      runRemoteGit: makeProductionGit(productionDependencies),
      mutation: featureMutation(),
      events: { emit: async (event) => { events.push(event); } },
    })).resolves.toMatchObject({ kind: 'executed' });

    expect(boundary.calls).toHaveLength(1);
    expect(boundary.calls[0]).toEqual({
      file: 'git', args: ['push', 'origin', 'HEAD:refs/heads/topic'],
      options: { cwd: root, maxBuffer: 32 * 1024 * 1024 },
    });
    expect(events).toEqual([]);
  });

  it('returns a 401 gh failure unchanged without an operator retry', async () => {
    const failure = Object.assign(new Error('gh request failed'), {
      code: 1,
      stderr: 'HTTP 401: Bad credentials',
    });
    boundary.failure = failure;
    const events: unknown[] = [];
    const guarded = createGuardedGithubOperationRunner(makeProductionGh({
      execFile: mockExecFile,
      readCredential: async () => ({ kind: 'unconfigured' }),
      readToken: async () => ({ kind: 'unavailable' }),
      assertRealExecAllowed: () => {},
    }), {
      cwd: root,
      creation: { authorize: async () => ({}) },
      events: { emit: async (event) => { events.push(event); } },
    });

    await expect(guarded.run({
      operation: 'issue.comment.create', access: 'feature-write',
      target: { repository: 'acme/repo', kind: 'issue', number: 1 },
      context: { actor: 'operator' }, payload: { body: 'comment' },
    })).rejects.toBe(failure);

    expect(boundary.calls).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
