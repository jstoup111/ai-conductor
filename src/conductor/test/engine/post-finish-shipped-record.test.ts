// Covers: task:22, task:rem-prd-audit-rem-v3-postfinish-refusal
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { refreshPostFinishShippedRecord } from '../../src/engine/post-finish-shipped-record.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';

const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  const result = await execa('git', args, { cwd });
  return { stdout: result.stdout };
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/demo', defaultBranch: 'origin/main', specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/intake/demo.md', publication: 'merged',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'post-finish-stack-tip-'));
  roots.push(root);
  await git(root, ['init', '-b', 'feat/daemon-demo']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test User']);
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(join(root, '.docs/plans/demo.md'), '# Demo\n');
  await mkdir(join(root, '.pipeline/children'), { recursive: true });
  await writeFile(join(root, '.pipeline/children/active'), 'active\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'seed']);
  await expect(writePublicationRecord(root, 'demo', undefined, {
    version: 1,
    members: [{ position: parseChildId(1)!, branch: 'feat/daemon-demo', pr: 1 }],
  })).resolves.toEqual({ kind: 'updated' });
  return root;
}

describe('post-finish shipped-record refresh', () => {
  it('keeps the local shipped-record commit and logs a stack-tip skip', async () => {
    const cwd = await fixture();
    const logs: string[] = [];
    const before = (await git(cwd, ['rev-parse', 'HEAD'])).stdout;

    await refreshPostFinishShippedRecord({
      cwd,
      requestedSlug: 'demo',
      pr: 'https://github.com/acme/demo/pull/1',
      runGit: (args, { cwd: commandCwd }) => git(commandCwd, args),
      gh: vi.fn(),
      remoteMutation: mutation(),
      remoteGit: (args, dependencies) => executeRemoteGit(args, {
        ...dependencies,
        config: async () => ({ stdout: 'git@github.com:acme/demo.git\n' }),
        runRemoteGit: async () => ({ stdout: '' }),
      }),
      events: { emit: vi.fn(async () => {}) },
      log: (message) => logs.push(message),
    });

    expect(logs).toEqual(['post-finish shipped-record refresh skipped: stack-tip-mismatch']);
    expect((await git(cwd, ['rev-parse', 'HEAD'])).stdout).not.toBe(before);
    expect((await git(cwd, ['show', '-s', '--format=%s', 'HEAD'])).stdout).toBe('shipped record: demo');
  });
});
