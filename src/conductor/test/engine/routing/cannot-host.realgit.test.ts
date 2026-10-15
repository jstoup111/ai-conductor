// Covers: task:22
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { classifyCitedPaths, selectHost } from '../../../src/engine/routing/cannot-host.js';
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
  const envelope = { taskSlices: { T1: 1 } };
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'coverage-binding-envelope.json'), JSON.stringify(envelope));

  const calls: string[][] = [];
  const git: GitRunner = async (args, options) => {
    calls.push([...args]);
    return realGit(args, options);
  };
  return { repo, git, calls, envelope };
}

describe('cannot-host (real local Git)', () => {
  it('moves a T1 repair for a leaf prerequisite to child 2 without changing task ownership', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const classified = await classifyCitedPaths(['src/b.ts'], leafTip, stack.git);
    const selected = await selectHost({
      owner: child(1),
      inputs: classified.inputs,
      positions: [child(1), child(2), child(3)],
      leafTip,
      git: stack.git,
    });

    expect({
      selected,
      envelope: JSON.parse(await readFile(join(stack.repo, '.pipeline', 'coverage-binding-envelope.json'), 'utf8')),
      closure: closureRefFor('demo', child(2)),
      writes: stack.calls.filter(([command]) => ['add', 'branch', 'checkout', 'commit', 'reset', 'update-ref'].includes(command)),
      coverageReads: stack.calls.filter((args) => args.includes('.pipeline/coverage-binding-envelope.json')),
    }).toEqual({
      selected: { host: child(2), reason: 'prerequisite-paths' },
      envelope: stack.envelope,
      closure: 'refs/conductor/demo/closed/c2',
      writes: [],
      coverageReads: [],
    });
  });

  it('treats a path absent from the leaf as an output and leaves its T1 repair with child 1', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const classified = await classifyCitedPaths(['src/new.ts'], leafTip, stack.git);
    const selected = await selectHost({
      owner: child(1),
      inputs: classified.inputs,
      positions: [child(1), child(2), child(3)],
      leafTip,
      git: stack.git,
    });

    expect({ classified, selected }).toEqual({
      classified: { inputs: [], outputs: ['src/new.ts'] },
      selected: { host: child(1), reason: 'owner' },
    });
  });
});
