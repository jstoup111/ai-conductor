// Covers: task:2, task:22, task:rem-prd-audit-W5
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { resolveCitedPaths, selectHost } from '../../../src/engine/routing/cannot-host.js';
import { initTestRepo } from '../../fixtures/git-repo.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function child(value: number): ChildId {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error(`invalid fixture child ${value}`);
  return parsed;
}

function childBranch(slug: string, position: ChildId): string {
  const branch = childBranchFor(slug, position);
  if (!branch.ok) throw new Error(branch.reason);
  return branch.branch;
}

async function mustSucceed(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function threeChildStack() {
  const repo = await mkdtemp(join(tmpdir(), 'cannot-host-'));
  roots.push(repo);
  await initTestRepo(repo);
  const realGit = makeGitRunner(repo);

  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  await mustSucceed(realGit, ['add', '.']);
  await mustSucceed(realGit, ['commit', '-qm', 'base']);

  await mustSucceed(realGit, ['checkout', '-qb', childBranch('demo', child(1))]);
  await mustSucceed(realGit, ['update-ref', closureRefFor('demo', child(1)), 'HEAD']);

  await mustSucceed(realGit, ['checkout', '-qb', childBranch('demo', child(2))]);
  await writeFile(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
  await mustSucceed(realGit, ['add', 'src/b.ts']);
  await mustSucceed(realGit, ['commit', '-qm', 'child two']);
  await mustSucceed(realGit, ['update-ref', closureRefFor('demo', child(2)), 'HEAD']);

  await mustSucceed(realGit, ['checkout', '-qb', leafBranchFor('demo')]);
  await mkdir(join(repo, 'src', 'engine', 'restack'), { recursive: true });
  await mkdir(join(repo, 'src', 'cli'), { recursive: true });
  await Promise.all([
    writeFile(join(repo, 'src', 'engine', 'a.ts'), 'export const engineA = 1;\n'),
    writeFile(join(repo, 'src', 'engine', 'register-artifact-cli.ts'), 'export const register = true;\n'),
    writeFile(join(repo, 'src', 'engine', 'restack', 'restack-sync.ts'), 'export const sync = true;\n'),
    writeFile(join(repo, 'src', 'engine', 'index.ts'), 'export {};\n'),
    writeFile(join(repo, 'src', 'cli', 'index.ts'), 'export {};\n'),
  ]);
  await mustSucceed(realGit, ['add', '.']);
  await mustSucceed(realGit, ['commit', '-qm', 'leaf citation paths']);
  const calls: string[][] = [];
  const git: GitRunner = async (args, options) => {
    calls.push([...args]);
    return realGit(args, options);
  };
  return { repo, git, calls };
}

describe('cannot-host (real local Git)', () => {
  it('resolves exact and unique suffix citations from one leaf listing', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const resolved = await resolveCitedPaths([
      'register-artifact-cli.ts',
      'restack/restack-sync.ts',
      'src/engine/a.ts',
      'brand-new.ts',
      'index.ts',
    ], leafTip, stack.git);

    expect(resolved).toEqual({
      inputs: [
        'src/engine/register-artifact-cli.ts',
        'src/engine/restack/restack-sync.ts',
        'src/engine/a.ts',
      ],
      outputs: ['brand-new.ts'],
      dropped: [{ path: 'index.ts', kind: 'dropped-ambiguous' }],
    });
    expect(stack.calls.filter((args) => args.join(' ') === `ls-tree -r --name-only ${leafTip}`)).toHaveLength(1);
  });

  it('drops directory citations rather than treating them as files or outputs', async () => {
    const stack = await threeChildStack();
    const resolved = await resolveCitedPaths(['src/engine/', 'src/engine'], leafBranchFor('demo'), stack.git);

    expect(resolved).toEqual({
      inputs: [],
      outputs: [],
      dropped: [
        { path: 'src/engine/', kind: 'dropped-directory' },
        { path: 'src/engine', kind: 'dropped-directory' },
      ],
    });
  });

  it('halts when its one leaf listing cannot be read', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const unreadable: GitRunner = async (args, options) => args.join(' ') === `ls-tree -r --name-only ${leafTip}`
      ? { exitCode: 1, stdout: '', stderr: 'missing leaf' }
      : stack.git(args, options);

    expect(await resolveCitedPaths(['src/engine/a.ts'], leafTip, unreadable))
      .toMatchObject({ kind: 'halt', detail: expect.stringContaining(leafTip) });
  });

  it('moves a T1 repair for a leaf prerequisite to child 2 without changing task ownership', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const classified = await resolveCitedPaths(['src/b.ts'], leafTip, stack.git);
    if ('kind' in classified) throw new Error(classified.detail);
    const selected = await selectHost({
      owner: child(1),
      inputs: classified.inputs,
      positions: [child(1), child(2), child(3)],
      leafTip,
      git: stack.git,
    });

    expect({
      selected,
      closure: closureRefFor('demo', child(2)),
      writes: stack.calls.filter(([command]) => ['add', 'branch', 'checkout', 'commit', 'reset', 'update-ref'].includes(command)),
    }).toEqual({
      selected: { host: child(2), reason: 'prerequisite-paths' },
      closure: 'refs/conductor/demo/closed/c2',
      writes: [],
    });
  });

  it('treats a path absent from the leaf as an output and leaves its T1 repair with child 1', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const classified = await resolveCitedPaths(['src/new.ts'], leafTip, stack.git);
    if ('kind' in classified) throw new Error(classified.detail);
    const selected = await selectHost({
      owner: child(1),
      inputs: classified.inputs,
      positions: [child(1), child(2), child(3)],
      leafTip,
      git: stack.git,
    });

    expect({ classified, selected }).toEqual({
      classified: { inputs: [], outputs: ['src/new.ts'], dropped: [] },
      selected: { host: child(1), reason: 'owner' },
    });
  });

  it('only moves upward and requires every input in the same closure', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    await writeFile(join(stack.repo, 'src', 'leaf-only.ts'), 'export const leaf = true;\n');
    await mustSucceed(makeGitRunner(stack.repo), ['add', 'src/leaf-only.ts']);
    await mustSucceed(makeGitRunner(stack.repo), ['commit', '-qm', 'leaf only']);
    const classified = await resolveCitedPaths(['src/b.ts', 'src/leaf-only.ts'], leafTip, stack.git);
    if ('kind' in classified) throw new Error(classified.detail);
    expect(await selectHost({
      owner: child(1), inputs: classified.inputs, positions: [child(1), child(2), child(3)], leafTip, git: stack.git,
    })).toEqual({ host: child(3), reason: 'prerequisite-paths' });
  });

  it('returns halts for unreadable closure and leaf trees', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const failingClosure: GitRunner = async (args, options) => args.includes(closureRefFor('demo', child(2)))
      ? { exitCode: 1, stdout: '', stderr: 'missing closure' }
      : stack.git(args, options);
    expect(await selectHost({
      owner: child(1), inputs: ['src/b.ts'], positions: [child(1), child(2), child(3)], leafTip, git: failingClosure,
    })).toMatchObject({ kind: 'halt', detail: expect.stringContaining('2') });
    expect(await resolveCitedPaths(['src/b.ts'], 'feat/daemon-missing', stack.git))
      .toMatchObject({ kind: 'halt', detail: expect.stringContaining('feat/daemon-missing') });
  });

  it('refuses the leaf fallback when a prerequisite disappears before host selection', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const selected = await selectHost({
      owner: child(1), inputs: ['src/missing.ts'], positions: [child(1), child(2), child(3)], leafTip, git: stack.git,
    });

    expect(selected).toEqual({
      kind: 'halt',
      detail: 'leaf branch feat/daemon-demo is missing prerequisite path: src/missing.ts',
    });
  });
});
