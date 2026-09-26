// Covers: task:13
// An absent user-level github_bot block must preserve the ambient credential
// behavior of both guarded gh writes and authorized HTTPS pushes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundary = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>,
  failure: undefined as Error | undefined,
}));

// Exercise the real production transports, but replace their sole process
// boundary before either module is imported.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((file, args: string[], options: Record<string, unknown>, callback) => {
      boundary.calls.push({ file, args, options });
      queueMicrotask(() => callback(boundary.failure, { stdout: '{}', stderr: '' }));
      return {};
    }),
  };
});

import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { makeProductionGit } from '../../src/engine/pr-labels.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from '../../src/engine/tracker-client.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

const savedEnvironment = new Map<string, string | undefined>();

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
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    // Deliberately present user config with no github_bot block.
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), 'spec_owner: alice\n');
    for (const key of ['AI_CONDUCTOR_NO_REAL_EXEC', 'HOME', 'GH_TOKEN', 'GITHUB_TOKEN']) {
      savedEnvironment.set(key, process.env[key]);
    }
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    process.env.HOME = join(root, 'home');
    process.env.GH_TOKEN = 'operator-token';
    process.env.GITHUB_TOKEN = 'operator-github-token';
    boundary.calls.length = 0;
    boundary.failure = undefined;
    vi.mocked(execFileCb).mockClear();
  });

  afterEach(async () => {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEnvironment.clear();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps guarded writes and authorized pushes ambient without fallback telemetry', async () => {
    const events: unknown[] = [];
    const guarded = createGuardedGithubOperationRunner(makeProductionGh(), {
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
    expect(execFileCb).toHaveBeenCalledOnce();
    expect(boundary.calls[0]).toEqual({
      file: 'gh', args: ['issue', 'comment', '1', '-R', 'acme/repo', '--body', 'comment'],
      options: { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: undefined },
    });

    boundary.calls.length = 0;
    vi.mocked(execFileCb).mockClear();
    await expect(executeRemoteGit(['push', 'origin', 'HEAD:refs/heads/topic'], {
      cwd: root,
      config: async () => ({ stdout: 'https://github.com/acme/repo.git\n' }),
      runRemoteGit: makeProductionGit(),
      mutation: featureMutation(),
      events: { emit: async (event) => { events.push(event); } },
    })).resolves.toMatchObject({ kind: 'executed' });

    expect(execFileCb).toHaveBeenCalledOnce();
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
    const guarded = createGuardedGithubOperationRunner(makeProductionGh(), {
      cwd: root,
      creation: { authorize: async () => ({}) },
      events: { emit: async (event) => { events.push(event); } },
    });

    await expect(guarded.run({
      operation: 'issue.comment.create', access: 'feature-write',
      target: { repository: 'acme/repo', kind: 'issue', number: 1 },
      context: { actor: 'operator' }, payload: { body: 'comment' },
    })).rejects.toBe(failure);

    expect(execFileCb).toHaveBeenCalledOnce();
    expect(boundary.calls).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
