// Covers: task:103
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  allocateFrozenBlocks,
  PRD_AUDIT_REMEDIATION_GATE_SOURCE,
  type CriterionBoundRemediationGap,
} from '../../../src/engine/remediation-append.js';
import { appendConductorRemediationTasks } from '../../../src/engine/remediation-task-append.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { initTestRepo } from '../../fixtures/git-repo.js';

const roots: string[] = [];
const planPath = '.docs/plans/demo.md';
const c1 = parseChildId(1)!;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mustSucceed(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function readBranchPlan(git: GitRunner, branch: string): Promise<string> {
  const result = await git(['show', `${branch}:${planPath}`]);
  if (result.exitCode !== 0) throw new Error(`could not read ${branch}:${planPath}: ${result.stderr}`);
  return result.stdout;
}

function childBranch(position: number): string {
  const resolved = childBranchFor('demo', position);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.branch;
}

const t1Gap: CriterionBoundRemediationGap = {
  id: 'finding-t1',
  disposition: 'build',
  category: null,
  rationale: 'T1 needs its admitted repair.',
  criterion: 'S1.1',
  parentTask: 'T1',
  tasks: [{ id: 'T1', title: 'Repair T1' }],
};

async function threeChildStack() {
  const repo = await mkdtemp(join(tmpdir(), 'frozen-allocation-'));
  roots.push(repo);
  await initTestRepo(repo);
  const git = makeGitRunner(repo);

  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repo, planPath), '### Task 1: Base work\n');
  await mustSucceed(git, ['add', '.']);
  await mustSucceed(git, ['commit', '-qm', 'base']);

  await mustSucceed(git, ['checkout', '-qb', childBranch(1)]);
  await mustSucceed(git, ['checkout', '-qb', childBranch(2)]);
  await writeFile(join(repo, planPath), [
    '### Task 1: Base work',
    '',
    '### Task rem-prd-audit-T1: Existing child repair',
    '',
  ].join('\n'));
  await mustSucceed(git, ['add', planPath]);
  await mustSucceed(git, ['commit', '-qm', 'child two plan']);

  await mustSucceed(git, ['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(repo, planPath), [
    '### Task 1: Base work',
    '',
    '### Task rem-prd-audit-existing-leaf: Existing leaf repair',
    '',
  ].join('\n'));
  await mustSucceed(git, ['add', planPath]);
  await mustSucceed(git, ['commit', '-qm', 'leaf plan']);

  return { repo, git, branches: [childBranch(1), childBranch(2), leafBranchFor('demo')] };
}

function withoutRouteLines(block: string): string {
  return block.replace(/^\*\*(?:Child|Round):\*\* .*\n/gm, '');
}

function remTaskIds(planText: string): string[] {
  return [...planText.matchAll(/^#{1,6}\s+Task\s+(rem-[A-Za-z0-9._-]+)\s*:/gm)].map((match) => match[1]!);
}

describe('frozen remediation allocation (real local Git)', () => {
  it('renders unique complete blocks without changing any branch plan', async () => {
    const stack = await threeChildStack();
    const before = await Promise.all(stack.branches.map(async (branch) => readBranchPlan(stack.git, branch)));
    const allocation = await allocateFrozenBlocks({
      itemsByHost: { 1: [{ gap: t1Gap, gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE }] },
      leafPlan: before[2]!,
      hostPlans: [
        { branch: childBranch(1), planPath },
        { branch: childBranch(2), planPath },
      ],
      roundId: 'r1',
      git: stack.git,
    });
    const after = await Promise.all(stack.branches.map(async (branch) => readBranchPlan(stack.git, branch)));
    const allocated = allocation[c1]!;
    const existingIds = new Set(before.flatMap(remTaskIds));
    const allocatedIds = Object.values(allocation).flatMap(({ remTaskIds }) => remTaskIds);

    expect({
      body: allocated.blockBodies[0],
      unchanged: after,
      ids: allocated.remTaskIds,
    }).toEqual({
      body: expect.stringContaining('**Child:** 1'),
      unchanged: before,
      ids: ['rem-prd-audit-T1-2'],
    });
    expect(allocated.blockBodies[0]).toContain('**Round:** r1');
    expect(existingIds).toContain('rem-prd-audit-T1');
    expect(new Set(allocatedIds).size).toBe(allocatedIds.length);
    expect(new Set([...existingIds, ...allocatedIds]).size).toBe(existingIds.size + allocatedIds.length);
  });

  it('matches the N=1 appender rendering once its routing lines are removed', async () => {
    const stack = await threeChildStack();
    const leafPlan = await readBranchPlan(stack.git, leafBranchFor('demo'));
    const allocation = await allocateFrozenBlocks({
      itemsByHost: { 1: [{ gap: t1Gap, gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE }] },
      leafPlan,
      hostPlans: [{ branch: childBranch(2), planPath }],
      roundId: 'r1',
      git: stack.git,
    });
    const n1Plan = join(stack.repo, '.docs', 'plans', 'n1.md');
    const n1Seed = [
      '### Task 1: Base work',
      '',
      '### Task rem-prd-audit-T1: Existing repair',
      '',
    ].join('\n');
    await writeFile(n1Plan, n1Seed);
    const appended = await appendConductorRemediationTasks(
      stack.repo,
      n1Plan,
      [],
      { criterionBoundGaps: [t1Gap], gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE },
    );
    if (!appended.success) throw new Error(appended.error);
    const renderedByN1 = (await readFile(n1Plan, 'utf8')).slice(n1Seed.length).replace(/^\n+/, '');

    expect(withoutRouteLines(allocation[c1]!.blockBodies[0]!)).toBe(renderedByN1);
  });
});
