// Covers: task:13, task:rem-prd-audit-13
import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  readDaemonMergeTime,
  resolveDaemonWorkOrderDocumentRefs,
} from '../../src/daemon-cli.js';
import { createDaemonHaltPrOperations } from '../../src/engine/daemon-halt-pr-operations.js';
import { validateSlug } from '../../src/engine/daemon-park-cli.js';
import { executeGithubOperation } from '../../src/engine/github-operations.js';
import { readSourceRef } from '../../src/engine/monitor/halt-inventory.js';
import { readSpecOwnerStamp } from '../../src/engine/owner-gate/provenance.js';
import { readParkedIntake } from '../../src/engine/park-reconciliation.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const slug = 'f';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(entries: ReadonlyArray<{ kind: string; path: string }>): string {
  return JSON.stringify({
    schemaVersion: 1,
    slug,
    artifacts: [{ kind: 'plan', path: '.docs/f/plan.md' }, ...entries],
  });
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'manifest-routing-daemon-'));
  roots.push(root);
  return root;
}

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), content, 'utf8');
}

async function gitFixture(): Promise<{ root: string; sha: () => Promise<string> }> {
  const root = await fixture();
  await execFile('git', ['init', '-b', 'main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
  return {
    root,
    sha: async () => (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
  };
}

async function commit(root: string, message: string): Promise<void> {
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-m', message], { cwd: root });
}

function gitFiles(files: Record<string, string>): GitRunner {
  return async (args) => {
    const object = args[1] ?? '';
    const separator = object.indexOf(':');
    const path = separator === -1 ? '' : object.slice(separator + 1);
    const content = files[path];
    return content === undefined
      ? { exitCode: 1, stdout: '', stderr: 'missing' }
      : { exitCode: 0, stdout: content, stderr: '' };
  };
}

describe('daemon manifest routing', () => {
  it('keeps work-order documents and merge time at legacy paths without a manifest, then routes both to manifest paths', async () => {
    const { root, sha } = await gitFixture();
    await write(root, '.docs/plans/f.md', '# legacy plan\n');
    await write(root, '.docs/stories/f.md', '# legacy stories\n');
    await commit(root, 'legacy');
    const legacySha = await sha();

    await expect(resolveDaemonWorkOrderDocumentRefs(root, legacySha, slug)).resolves.toEqual([
      '.docs/stories/f.md', '.docs/plans/f.md',
    ]);

    await write(root, '.docs/f/plan.md', '# moved plan\n');
    await write(root, '.docs/f/stories.md', '# moved stories\n');
    await write(root, '.docs/f/manifest.json', manifest([
      { kind: 'stories', path: '.docs/f/stories.md' },
    ]));
    await commit(root, 'manifest');
    const manifestSha = await sha();

    await expect(resolveDaemonWorkOrderDocumentRefs(root, manifestSha, slug)).resolves.toEqual([
      '.docs/f/stories.md', '.docs/f/plan.md',
    ]);
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: '2026-10-24T00:00:00Z\n', stderr: '' };
    };
    await expect(readDaemonMergeTime(git, root, slug, manifestSha)).resolves.toBe('2026-10-24T00:00:00Z');
    expect(calls).toContainEqual(['log', manifestSha, '--diff-filter=A', '--format=%cI', '--', '.docs/f/plan.md']);
  });

  it('treats manifest omissions as absent and fails a malformed work-order manifest closed', async () => {
    const { root, sha } = await gitFixture();
    await write(root, '.docs/plans/f.md', '# legacy plan\n');
    await write(root, '.docs/stories/f.md', '# legacy stories\n');
    await write(root, '.docs/f/plan.md', '# moved plan\n');
    await write(root, '.docs/f/manifest.json', manifest([]));
    await commit(root, 'missing stories');
    await expect(resolveDaemonWorkOrderDocumentRefs(root, await sha(), slug)).resolves.toEqual(['.docs/f/plan.md']);

    await write(root, '.docs/f/manifest.json', '{ nope');
    await commit(root, 'malformed');
    await expect(resolveDaemonWorkOrderDocumentRefs(root, await sha(), slug)).rejects.toThrow('.docs/f/manifest.json');
  });

  it('routes owner provenance through the manifest while retaining legacy and omission behavior', async () => {
    const legacy = '# Intake\nOwner: Legacy\n';
    await expect(readSpecOwnerStamp(gitFiles({ '.docs/intake/f.md': legacy }), 'main', slug))
      .resolves.toEqual({ present: true, id: 'legacy' });

    const relocated = '# Intake\nOwner: Moved\n';
    await expect(readSpecOwnerStamp(gitFiles({
      '.docs/f/manifest.json': manifest([{ kind: 'intake', path: '.docs/f/intake.md' }]),
      '.docs/f/intake.md': relocated,
    }), 'main', slug)).resolves.toEqual({ present: true, id: 'moved' });

    await expect(readSpecOwnerStamp(gitFiles({
      '.docs/f/manifest.json': manifest([]),
      '.docs/intake/f.md': legacy,
    }), 'main', slug)).resolves.toEqual({ present: false });
  });

  it('accepts a manifest-backed non-legacy plan for park validation', async () => {
    const root = await fixture();
    await write(root, '.docs/f/plan.md', '# plan\n');
    await write(root, '.docs/f/manifest.json', manifest([]));
    await expect(validateSlug(slug, root)).resolves.toBe(true);
  });

  it('routes park reconciliation and halt inventory intake reads through the manifest', async () => {
    const root = await fixture();
    const legacy = 'Source-Ref: owner/repo#1\n';
    await write(root, '.docs/intake/f.md', legacy);
    await expect(readParkedIntake(root, slug)).resolves.toBe(legacy);

    const moved = 'Source-Ref: owner/repo#2\n';
    await write(root, '.docs/f/plan.md', '# plan\n');
    await write(root, '.docs/f/intake.md', moved);
    await write(root, '.docs/f/manifest.json', manifest([{ kind: 'intake', path: '.docs/f/intake.md' }]));
    await expect(readParkedIntake(root, slug)).resolves.toBe(moved);

    const worktree = join(root, '.worktrees', slug);
    await write(worktree, '.docs/f/plan.md', '# plan\n');
    await write(worktree, '.docs/f/intake.md', moved);
    await write(worktree, '.docs/f/manifest.json', manifest([{ kind: 'intake', path: '.docs/f/intake.md' }]));
    await expect(readSourceRef(worktree, slug)).resolves.toBe('owner/repo#2');

    await write(worktree, '.docs/f/manifest.json', manifest([]));
    await expect(readSourceRef(worktree, slug)).resolves.toBeUndefined();
  });

  it('fails closed on a malformed manifest when reading a halt inventory source ref', async () => {
    const root = await fixture();
    await write(root, '.docs/f/manifest.json', '{ nope');

    await expect(readSourceRef(root, slug)).rejects.toThrow('.docs/f/manifest.json');
  });

  it('uses manifest-selected intake bytes for daemon halt PR provenance', async () => {
    const files = {
      '.docs/f/manifest.json': manifest([{ kind: 'intake', path: '.docs/f/intake.md' }]),
      '.docs/f/intake.md': 'Owner: alice\n',
    };
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      const path = (args[1] ?? '').split(':').slice(1).join(':');
      const content = files[path as keyof typeof files];
      return content === undefined
        ? { exitCode: 1, stdout: '', stderr: 'missing' }
        : { exitCode: 0, stdout: content, stderr: '' };
    };
    const gh: GhRunner = async () => ({ stdout: '' });
    const runner = createDaemonHaltPrOperations({
      projectRoot: '/fixture', baseBranch: 'main', git, gh,
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
    })({ number: 7, url: 'https://github.com/owner/repo/pull/7', headRefName: 'feat/daemon-f' });
    if (!runner) throw new Error('expected daemon PR runner');

    await expect(executeGithubOperation({
      operation: 'pull-request.draft', repository: 'owner/repo',
      resource: { kind: 'pull-request', number: 7 }, context: { actor: 'test' },
    }, runner)).resolves.toMatchObject({ kind: 'executed' });
    expect(calls.map((args) => args.join(' '))).toContain('show main:.docs/f/intake.md');
  });
});
