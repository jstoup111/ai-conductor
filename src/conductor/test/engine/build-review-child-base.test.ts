// Covers: task:24
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assembleBuildReviewInputs,
  MergeBaseError,
} from '../../src/engine/build-review-inputs.js';
import { runScopeFailDisposition } from '../../src/engine/build-review-disposition.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const CURRENT_PROOF = {
  status: 'CURRENT',
  evidence: { provenanceHeadSha: 'attested-head', outcome: 'PASS' },
} as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>;

interface ChildReviewFixture {
  root: string;
  planPath: string;
  parentSha: string;
  mainSha: string;
}

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function createFixture(mergeParent = true): Promise<ChildReviewFixture> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-child-base-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'review@example.test']);
  await git(root, ['config', 'user.name', 'Build review child test']);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  const planPath = join(root, '.docs', 'plans', 'demo.md');
  await writeFile(planPath, `# Demo plan

### Task 1: parent work

### Task 2: child work
`);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base']);
  const mainSha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['branch', 'feat/daemon-demo']);
  await git(root, ['checkout', '-q', '-b', 'feat/c1/demo']);
  await writeFile(join(root, 'parent.ts'), 'export const parent = true;\n');
  await git(root, ['add', 'parent.ts']);
  await git(root, ['commit', '-qm', 'parent child']);
  const parentSha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', parentSha]);
  await git(root, ['checkout', '-q', 'feat/daemon-demo']);
  if (mergeParent) await git(root, ['merge', '--ff-only', 'feat/c1/demo']);
  await writeFile(join(root, 'child.ts'), 'export const child = true;\n');
  await git(root, ['add', 'child.ts']);
  await git(root, ['commit', '-qm', 'child work']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['parent', 'child'] },
  }));
  return { root, planPath, parentSha, mainSha };
}

function options(child: 1 | 2) {
  return {
    inspectTestSuite: async () => CURRENT_PROOF,
    childBase: { slug: 'demo', child: parseChildId(child)! },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('build_review child base', () => {
  it('grades child 2 only since its parent closure without a degraded-fetch warning', async () => {
    const fixture = await createFixture();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root), fixture.planPath, options(2),
    );

    expect(inputs).toMatchObject({
      baseRef: fixture.parentSha,
      baseKind: 'child-parent',
      mergeBase: fixture.parentSha,
      trackingRefSha: null,
      remoteHeadSha: null,
      fresh: true,
    });
    expect(inputs.diff).toContain('child.ts');
    expect(inputs.diff).not.toContain('parent.ts');
    // The plan is intentionally whole, so Covers references may bind to an
    // earlier child's task while the reviewed diff remains child-local.
    expect(inputs.planBody).toContain('Task 1: parent work');
    expect(warning).not.toHaveBeenCalled();
  });

  it('keeps the default-branch ladder for the first child', async () => {
    const fixture = await createFixture();
    const gitRunner = makeGitRunner(fixture.root);
    const childOne = await assembleBuildReviewInputs(gitRunner, fixture.planPath, options(1));
    const flat = await assembleBuildReviewInputs(gitRunner, fixture.planPath, {
      inspectTestSuite: async () => CURRENT_PROOF,
    });

    expect(childOne.baseKind).toBe(flat.baseKind);
    expect(childOne.baseRef).toBe(flat.baseRef);
    expect(childOne.mergeBase).toBe(flat.mergeBase);
    expect(childOne.diff).toBe(flat.diff);
  });

  it('fails closed when the parent branch is missing or cannot be an ancestor', async () => {
    const missing = await createFixture();
    await git(missing.root, ['branch', '-D', 'feat/c1/demo']);
    await expect(assembleBuildReviewInputs(
      makeGitRunner(missing.root), missing.planPath, options(2),
    )).rejects.toMatchObject({
      name: MergeBaseError.name,
      message: expect.stringContaining('parent child 1'),
    });

    const unmerged = await createFixture(false);
    await expect(assembleBuildReviewInputs(
      makeGitRunner(unmerged.root), unmerged.planPath, options(2),
    )).rejects.toMatchObject({
      name: MergeBaseError.name,
      message: expect.stringContaining('not an ancestor'),
    });
  });

  it('uses the parent closure for scope-fail disposition without probing the default branch', async () => {
    const fixture = await createFixture();
    const calls: string[][] = [];
    const real = makeGitRunner(fixture.root);
    const gitRunner = async (args: string[]) => {
      calls.push(args);
      return real(args);
    };

    await expect(runScopeFailDisposition({
      git: gitRunner,
      root: fixture.root,
      gradedBaseSha: fixture.mainSha,
      flaggedPaths: ['parent.ts'],
      childBase: { slug: 'demo', child: parseChildId(2)! },
      regrade: async () => 'pass',
    })).resolves.toMatchObject({ kind: 'invalidated', freshBaseSha: fixture.parentSha });
    expect(calls.some((args) => args[0] === 'remote' || args[0] === 'ls-remote' || args[0] === 'fetch')).toBe(false);
  });
});
