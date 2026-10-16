// Covers: Task 72
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { resolveChildBase } from '../../src/engine/child-cursor.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { parseCommitSha } from '../../src/engine/restack/restack-types.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { resolveBuildReviewExecutionChild } from '../../src/engine/step-runners.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const roundId = parseRoundId('r1')!;

const currentProof = {
  status: 'CURRENT',
  evidence: { provenanceHeadSha: 'attested-head', outcome: 'PASS' },
} as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>;

interface RoutedFixture {
  readonly root: string;
  readonly planPath: string;
  readonly pinnedBase: string;
}

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function createRoutedFixture(): Promise<RoutedFixture> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-routed-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'review@example.test']);
  await git(root, ['config', 'user.name', 'Build review routed test']);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  const planPath = join(root, '.docs', 'plans', 'demo.md');
  await writeFile(planPath, '# Demo plan\n\n### Task 72: routed review\n');
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['branch', 'feat/daemon-demo']);
  await git(root, ['checkout', '-q', '-b', 'feat/c1/demo']);
  await writeFile(join(root, 'child.ts'), 'export const child = true;\n');
  await git(root, ['add', 'child.ts']);
  await git(root, ['commit', '-qm', 'already reviewed child work']);
  const pinnedBase = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', pinnedBase]);
  await writeFile(join(root, 'repair.ts'), 'export const repair = true;\n');
  await git(root, ['add', 'repair.ts']);
  await git(root, ['commit', '-qm', 'routed repair']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['parent', 'child'] },
  }));

  const created = await createRouteRecord(root, 'demo', {
    roundId,
    kind: 'audit',
    items: [],
    allocation: { [c1]: { remTaskIds: ['rem-72'], blockBodies: ['### Task rem-72\n'] } },
  });
  if (created.kind !== 'created') throw new Error(`route record create failed: ${created.kind}`);
  const stored = await readRouteRecord(root, 'demo', roundId);
  if (stored.kind !== 'record') throw new Error('route record unavailable');
  const updated = await writeRouteRecord(root, stored, {
    ...stored.record,
    phase: 'open',
    hosts: { ...stored.record.hosts, [c1]: 'repairing' },
    entry: { pinnedBase: parseCommitSha(pinnedBase)!, tree: parseCommitSha(pinnedBase)! },
  });
  if (updated.kind !== 'updated') throw new Error(`route record update failed: ${updated.kind}`);
  const marker = await writeRoutingTransaction(root, 'demo', [{ kind: 'create-marker', marker: { host: c1, roundId } }]);
  if (marker.kind !== 'updated') throw new Error(`repair marker create failed: ${marker.kind}`);
  return { root, planPath, pinnedBase };
}

async function createStackedFixture(): Promise<{ root: string; planPath: string; parentSha: string }> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-non-routed-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'review@example.test']);
  await git(root, ['config', 'user.name', 'Build review routed test']);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  const planPath = join(root, '.docs', 'plans', 'demo.md');
  await writeFile(planPath, '# Demo plan\n\n### Task 72: ordinary child review\n');
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['branch', 'feat/daemon-demo']);
  await git(root, ['checkout', '-q', '-b', 'feat/c1/demo']);
  await writeFile(join(root, 'parent.ts'), 'export const parent = true;\n');
  await git(root, ['add', 'parent.ts']);
  await git(root, ['commit', '-qm', 'parent child']);
  const parentSha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', parentSha]);
  await git(root, ['checkout', '-q', 'feat/daemon-demo']);
  await git(root, ['merge', '--ff-only', 'feat/c1/demo']);
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
  return { root, planPath, parentSha };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('build_review routed repair base', () => {
  it('selects the routed host rather than the repair-pending cursor for build_review', () => {
    expect(resolveBuildReviewExecutionChild({
      kind: 'repair-pending',
      child: c2,
      position: c2,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [c1],
      routedRepair: { child: c1, roundId },
    }, 'demo')).toEqual({
      childBase: { slug: 'demo', child: c1 },
      isLeaf: false,
    });
  });

  it('grades a routed host only from its persisted pin and keeps test-quality evidence bound to that pin', async () => {
    const fixture = await createRoutedFixture();
    const gitRunner = makeGitRunner(fixture.root);

    await expect(resolveChildBase(fixture.root, 'demo', c1, { git: gitRunner })).resolves.toEqual({
      kind: 'routed-repair', child: c1, sha: fixture.pinnedBase,
    });
    const inputs = await assembleBuildReviewInputs(gitRunner, fixture.planPath, {
      inspectTestSuite: async () => currentProof,
      childBase: { slug: 'demo', child: c1 },
      lapMembers: [{ id: 'testQuality', kind: 'builtin' }, { id: 'custom', kind: 'custom' }],
      materialization: { projectRoot: fixture.root },
    });
    try {
      expect(inputs).toMatchObject({
        baseKind: 'routed-repair',
        baseRef: fixture.pinnedBase,
        mergeBase: fixture.pinnedBase,
        sourceSnapshot: { mergeBase: fixture.pinnedBase },
      });
      expect(inputs.sourceMaterialization?.contextFor('testQuality').source.identity).toMatchObject({
        mergeBase: fixture.pinnedBase,
      });
      expect(inputs.diff).toContain('repair.ts');
      expect(inputs.diff).not.toContain('child.ts');

      const movedClosure = (await git(fixture.root, ['rev-parse', 'HEAD'])).trim();
      await git(fixture.root, ['update-ref', 'refs/conductor/demo/closed/c1', movedClosure]);
      await expect(assembleBuildReviewInputs(gitRunner, fixture.planPath, {
        inspectTestSuite: async () => currentProof,
        childBase: { slug: 'demo', child: c1 },
      })).resolves.toMatchObject({
        baseKind: 'routed-repair',
        mergeBase: fixture.pinnedBase,
        sourceSnapshot: { mergeBase: fixture.pinnedBase },
      });
    } finally {
      await inputs.sourceMaterialization?.settle('testQuality');
      await inputs.sourceMaterialization?.settle('custom');
      await inputs.sourceMaterialization?.finish?.();
    }
  });

  it('keeps N=1 and non-routed child base resolution unchanged', async () => {
    const routed = await createRoutedFixture();
    await expect(resolveChildBase(routed.root, 'demo')).resolves.toEqual({ kind: 'none' });

    const stacked = await createStackedFixture();
    const inputs = await assembleBuildReviewInputs(makeGitRunner(stacked.root), stacked.planPath, {
      inspectTestSuite: async () => currentProof,
      childBase: { slug: 'demo', child: c2 },
    });
    expect(inputs).toMatchObject({
      baseKind: 'child-parent',
      mergeBase: stacked.parentSha,
    });
  });
});
