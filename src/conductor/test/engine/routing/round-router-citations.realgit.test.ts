// Covers: task:3, task:4, task:5
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import type { CriterionBoundRemediationGap } from '../../../src/engine/remediation-append.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { citedRepositoryPaths } from '../../../src/engine/routing/cited-repository-paths.js';
import { routeAdmittedRound } from '../../../src/engine/routing/round-router.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import type { RoundId } from '../../../src/engine/routing/route-types.js';
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
  const repo = await mkdtemp(join(tmpdir(), 'round-router-citations-'));
  roots.push(repo);
  await initTestRepo(repo);
  const git = makeGitRunner(repo);

  await mkdir(join(repo, 'src', 'engine'), { recursive: true });
  await writeFile(join(repo, 'src', 'engine', 'a.ts'), 'export const a = 1;\n');
  await mustSucceed(git, ['add', '.']);
  await mustSucceed(git, ['commit', '-qm', 'base']);

  await mustSucceed(git, ['checkout', '-qb', childBranch('demo', child(1))]);
  await mustSucceed(git, ['update-ref', closureRefFor('demo', child(1)), 'HEAD']);

  await mustSucceed(git, ['checkout', '-qb', childBranch('demo', child(2))]);
  await mustSucceed(git, ['update-ref', closureRefFor('demo', child(2)), 'HEAD']);

  await mustSucceed(git, ['checkout', '-qb', leafBranchFor('demo')]);
  await mkdir(join(repo, 'src', 'engine', 'restack'), { recursive: true });
  await mkdir(join(repo, 'src', 'cli'), { recursive: true });
  await Promise.all([
    writeFile(join(repo, 'src', 'engine', 'register-artifact-cli.ts'), 'export const register = true;\n'),
    writeFile(join(repo, 'src', 'engine', 'restack', 'restack-sync.ts'), 'export const sync = true;\n'),
    writeFile(join(repo, 'src', 'engine', 'index.ts'), 'export {};\n'),
    writeFile(join(repo, 'src', 'cli', 'index.ts'), 'export {};\n'),
  ]);
  await mustSucceed(git, ['add', '.']);
  await mustSucceed(git, ['commit', '-qm', 'leaf citation paths']);
  return { repo, git };
}

const gap: CriterionBoundRemediationGap = {
  id: 'citation-repair', disposition: 'build', category: null,
  rationale: 'Route the cited repair.', criterion: 'The routed repair uses its resolved cited input.',
  tasks: [{ id: 'citation-repair', title: 'Route cited repair' }],
};

function residueJudge() {
  return async () => ({
    success: true,
    output: JSON.stringify({
      version: 'v1',
      items: [{ itemId: 'citation-repair', child: 1, candidates: [1], rationale: 'Child one owns this repair.' }],
    }),
  });
}

async function route(citations: readonly string[], options: { gap?: CriterionBoundRemediationGap; existingTask?: boolean } = {}) {
  const stack = await threeChildStack();
  return routeStack(stack, citations, stack.git, options);
}

async function routeStack(
  stack: Awaited<ReturnType<typeof threeChildStack>>,
  citations: readonly string[],
  git = stack.git,
  options: { gap?: CriterionBoundRemediationGap; existingTask?: boolean } = {},
) {
  return routeAdmittedRound({
    admitted: [{
      id: 'citation-repair', gap: options.gap ?? gap, gateSource: 'prd-audit', citedPaths: citations,
      provenance: { kind: 'taskless-obligation' },
      ...(options.existingTask ? { existingTask: true, ownerTaskIds: ['T1'] } : {}),
    }],
    sliceMembership: { taskSlices: {}, titles: [] }, planText: '', appendedChildren: {},
    declaredPositions: [child(1), child(2), child(3)], leafTip: leafBranchFor('demo'),
    roundId: 'r1' as RoundId, judge: residueJudge(), git,
  });
}

describe('routeAdmittedRound citations (real local Git)', () => {
  it.each([
    ['register-artifact-cli.ts', ['src/engine/register-artifact-cli.ts']],
    ['restack/restack-sync.ts', ['src/engine/restack/restack-sync.ts']],
  ])('routes the unique suffix citation %s to the leaf', async (citation, prerequisitePaths) => {
    const routed = await route([citation]);

    expect(routed).toMatchObject({ kind: 'routed' });
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({
      findingId: 'citation-repair', owner: child(1), host: child(3), reason: 'prerequisite-paths', prerequisitePaths,
    })]);
  });

  it('routes a wrapped citation using the cleaned repository path', async () => {
    const citedPaths = citedRepositoryPaths('(register-artifact-cli.ts)');
    const routed = await route(citedPaths);

    expect(citedPaths).toEqual(['register-artifact-cli.ts']);
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({
      host: child(3), prerequisitePaths: ['src/engine/register-artifact-cli.ts'],
    })]);
    expect(routed.items[0]!.prerequisitePaths?.some((path) => path.startsWith('('))).toBe(false);
  });

  it('keeps a resolved child-one input with the residue-judged owner', async () => {
    const routed = await route(['src/engine/a.ts']);

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({
      findingId: 'citation-repair', owner: child(1), host: child(1), reason: 'residue-judged',
      prerequisitePaths: ['src/engine/a.ts'],
    })]);
  });

  it.each([
    [['src/engine/', 'src/engine/a.ts'], child(1), ['src/engine/a.ts']],
    [['src/engine/', 'register-artifact-cli.ts'], child(3), ['src/engine/register-artifact-cli.ts']],
  ])('drops directory citations while routing remaining inputs', async (citations, host, prerequisitePaths) => {
    const routed = await route(citations);

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({
      owner: child(1), host, prerequisitePaths,
    })]);
  });

  it('keeps a directory-only citation with its residue-judged owner and no prerequisite paths', async () => {
    const routed = await route(['src/engine/']);

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toEqual(expect.objectContaining({
      owner: child(1), host: child(1), reason: 'residue-judged',
    }));
    expect(routed.items[0]).not.toHaveProperty('prerequisitePaths');
  });

  it('drops ambiguous citations while retaining unambiguous inputs', async () => {
    const routed = await route(['index.ts', 'src/engine/a.ts']);

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toEqual(expect.objectContaining({
      owner: child(1), host: child(1), prerequisitePaths: ['src/engine/a.ts'],
    }));
    expect(routed.items[0]?.prerequisitePaths).not.toContain('src/engine/index.ts');
    expect(routed.items[0]?.prerequisitePaths).not.toContain('src/cli/index.ts');
  });

  it('treats unmatched citations as outputs rather than prerequisite paths', async () => {
    const routed = await route(['brand-new.ts']);

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toEqual(expect.objectContaining({ owner: child(1), host: child(1) }));
    expect(routed.items[0]).not.toHaveProperty('prerequisitePaths');
  });

  it('halts needs-human before route allocation when the leaf listing is unreadable', async () => {
    const stack = await threeChildStack();
    const leafTip = leafBranchFor('demo');
    const before = await mustSucceed(stack.git, ['for-each-ref', 'refs/conductor/demo/']);
    const unreadable: GitRunner = async (args, options) => args.join(' ') === `ls-tree -r --name-only ${leafTip}`
      ? { exitCode: 1, stdout: '', stderr: 'missing leaf' }
      : stack.git(args, options);

    const routed = await routeStack(stack, ['src/engine/a.ts'], unreadable);

    expect(routed).toMatchObject({
      kind: 'halt', haltClass: 'needs-human', detail: expect.stringContaining('feat/daemon-demo'),
    });
    expect(await mustSucceed(stack.git, ['for-each-ref', 'refs/conductor/demo/'])).toBe(before);
  });

  it('uses governing-clause citations from a new remediation block to select the leaf host', async () => {
    const routed = await route(['src/engine/a.ts'], {
      gap: { ...gap, governingClause: 'Repair register-artifact-cli.ts before continuing.' },
    });

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toMatchObject({
      host: child(3), reason: 'prerequisite-paths',
      prerequisitePaths: expect.arrayContaining(['src/engine/register-artifact-cli.ts']),
    });
  });

  it('keeps block text that names only owner files and outputs on its owner and freezes its block', async () => {
    const routed = await route([], {
      gap: { ...gap, governingClause: 'Inspect src/engine/a.ts and create brand-new.ts.' },
    });

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toMatchObject({ host: child(1), reason: 'residue-judged' });
    expect(routed.allocation[child(1)]?.blockBodies.join('\n')).toContain('Inspect src/engine/a.ts and create brand-new.ts.');
  });

  it('does not use block text for existing-task work', async () => {
    const routed = await route(['src/engine/a.ts'], {
      existingTask: true,
      gap: { ...gap, governingClause: 'Repair register-artifact-cli.ts before continuing.' },
    });

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items[0]).toMatchObject({ host: child(1), prerequisitePaths: ['src/engine/a.ts'] });
  });

  it('halts before allocation when a block-text citation cannot read its owner closure', async () => {
    const stack = await threeChildStack();
    const before = await mustSucceed(stack.git, ['for-each-ref', 'refs/conductor/demo/']);
    const unreadable: GitRunner = async (args, options) => args.join(' ') === `ls-tree ${closureRefFor('demo', child(1))} -- src/engine/register-artifact-cli.ts`
      ? { exitCode: 1, stdout: '', stderr: 'missing closure' }
      : stack.git(args, options);

    const routed = await routeStack(stack, [], unreadable, {
      gap: { ...gap, governingClause: 'Repair register-artifact-cli.ts before continuing.' },
    });

    expect(routed).toMatchObject({ kind: 'halt', haltClass: 'needs-human', detail: expect.stringContaining('child 1') });
    expect(await mustSucceed(stack.git, ['for-each-ref', 'refs/conductor/demo/'])).toBe(before);
  });
});
