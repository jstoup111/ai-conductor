// Covers: task:49
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  allocateFrozenBlocks,
  PRD_AUDIT_REMEDIATION_GATE_SOURCE,
  writeFrozenBlocks,
  type CriterionBoundRemediationGap,
} from '../../../src/engine/remediation-append.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { initTestRepo } from '../../fixtures/git-repo.js';

const roots: string[] = [];
const slug = 'demo';
const planPath = '.docs/plans/demo.md';
const child = parseChildId(1)!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function hostBranch(): string {
  const branch = childBranchFor(slug, child);
  if (!branch.ok) throw new Error(branch.reason);
  return branch.branch;
}

async function mustSucceed(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function planAt(git: GitRunner, branch: string): Promise<string> {
  const result = await git(['show', `${branch}:${planPath}`]);
  if (result.exitCode !== 0) throw new Error(`cannot read ${branch}:${planPath}: ${result.stderr}`);
  return result.stdout;
}

function remIds(plan: string): string[] {
  return [...plan.matchAll(/^### Task (rem-[A-Za-z0-9._-]+):/gm)].map((match) => match[1]!);
}

const items: readonly { readonly gap: CriterionBoundRemediationGap; readonly gateSource: string }[] = [
  {
    gap: {
      id: 'finding-t1', disposition: 'build', category: null, rationale: 'Repair T1.',
      tasks: [{ id: 'T1', title: 'Repair T1' }],
    },
    gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE,
  },
  {
    gap: {
      id: 'finding-t3', disposition: 'build', category: null, rationale: 'Repair T3.',
      tasks: [{ id: 'T3', title: 'Repair T3' }],
    },
    gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE,
  },
];

describe('routed stack remediation ids (real local Git)', () => {
  it('reserves rem ids and ordinals already present on both the host and leaf before writing the host allocation', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'stack-id-uniqueness-'));
    roots.push(repo);
    await initTestRepo(repo);
    const git = makeGitRunner(repo);
    await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repo, planPath), '### Task T1: Base work\n');
    await mustSucceed(git, ['add', planPath]);
    await mustSucceed(git, ['commit', '-qm', 'base plan']);

    await mustSucceed(git, ['checkout', '-qb', hostBranch()]);
    await writeFile(join(repo, planPath), [
      '### Task T1: Base work', '',
      '### Task rem-prd-audit-T1: Existing host repair', '',
    ].join('\n'));
    await mustSucceed(git, ['add', planPath]);
    await mustSucceed(git, ['commit', '-qm', 'host repair']);

    const leaf = leafBranchFor(slug);
    await mustSucceed(git, ['checkout', '-qb', leaf]);
    await writeFile(join(repo, planPath), [
      '### Task T1: Base work', '',
      '### Task rem-prd-audit-T1: Existing host repair', '',
      '### Task rem-prd-audit-T3: Existing leaf repair', '',
    ].join('\n'));
    await mustSucceed(git, ['add', planPath]);
    await mustSucceed(git, ['commit', '-qm', 'leaf repair']);

    const hostPlan = await planAt(git, hostBranch());
    const leafPlan = await planAt(git, leaf);
    const allocation = await allocateFrozenBlocks({
      itemsByHost: { [child]: items },
      leafPlan,
      hostPlans: [{ branch: hostBranch(), planPath }],
      roundId: 'r1',
      git,
    });
    const frozen = allocation[child]!;
    expect(frozen.remTaskIds).toEqual(['rem-prd-audit-T1-2', 'rem-prd-audit-T3-2']);
    const existingIds = new Set([...remIds(hostPlan), ...remIds(leafPlan)]);
    expect(frozen.remTaskIds.every((id) => !existingIds.has(id))).toBe(true);
    expect(new Set(frozen.remTaskIds).size).toBe(frozen.remTaskIds.length);

    await mustSucceed(git, ['switch', hostBranch()]);
    await expect(writeFrozenBlocks({
      worktree: repo, planPath, roundId: 'r1', host: child, allocation: frozen, slug, git,
    })).resolves.toEqual({ kind: 'written' });

    const writtenHostPlan = await planAt(git, hostBranch());
    const unchangedLeafPlan = await planAt(git, leaf);
    for (const id of frozen.remTaskIds) {
      expect(remIds(writtenHostPlan).filter((candidate) => candidate === id)).toHaveLength(1);
      expect(remIds(unchangedLeafPlan).filter((candidate) => candidate === id)).toHaveLength(0);
    }
  });
});
