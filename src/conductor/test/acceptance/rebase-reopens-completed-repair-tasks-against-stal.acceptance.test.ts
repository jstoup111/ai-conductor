/**
 * Covers: S1.1, S1.2, S1.3, S1.4, S2.1, S2.2, S3.3, task:3, task:4
 *
 * Acceptance coverage for repair boundaries crossing the real rebase entry.
 * Each fixture creates a real branch history, persists engine repair state,
 * invokes performRebase with the production translator, and observes the
 * translated store or the later task-progress result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { makeGitRunner, performRebase } from '../../src/engine/rebase.js';
import { translateAfterRebase } from '../../src/engine/rebase-translate.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { resolveTaskIdsWithDiagnostics } from '../../src/engine/task-progress.js';

const PLAN_PATH = '.docs/plans/feature.md';

interface ReplayFixture {
  rootCommit: string;
  directBoundary: string;
  residueBoundary: string;
  successorBoundary: string;
  originalHead: string;
}

function obligation(id: string, taskId: string, head: string) {
  return {
    id,
    planIdentity: PLAN_PATH,
    taskIds: [taskId],
    source: {
      findingId: `finding-${id}`,
      authority: 'build_review',
      instruction: `repair ${taskId}`,
    },
    baseline: {
      head,
      tree: `tree-${id}`,
      resolvedTaskIds: [],
      resolvedCount: 0,
    },
    settlement: 'unsettled',
    tasks: { [taskId]: { status: 'open' } },
  };
}

function engineState(fixture: ReplayFixture) {
  const records = {
    direct: obligation('direct', '1', fixture.directBoundary),
    successor: obligation('successor', '2', fixture.residueBoundary),
    boundaryOnly: obligation('boundaryOnly', '3', fixture.directBoundary),
    outside: obligation('outside', '4', fixture.rootCommit),
  };
  return {
    activePlanPath: PLAN_PATH,
    appendedTaskIds: ['T9'],
    repairObligations: {
      version: 1,
      records,
      currentByPlan: {
        [PLAN_PATH]: {
          '1': 'direct',
          '2': 'successor',
          '3': 'boundaryOnly',
          '4': 'outside',
        },
      },
      admissionsByPlan: { [PLAN_PATH]: {} },
    },
  };
}

describe('acceptance: rebase translates persisted repair boundaries', () => {
  let projectRoot: string;

  const git = (...args: string[]) => execa('git', args, { cwd: projectRoot });

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'repair-boundary-rebase-'));
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'acceptance@example.com');
    await git('config', 'user.name', 'Acceptance Fixture');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(projectRoot, 'base.ts'), 'base\n');
    await git('add', 'base.ts');
    await git('commit', '-q', '-m', 'base');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function createReplayFixture(): Promise<ReplayFixture> {
    const rootCommit = (await git('rev-parse', 'HEAD')).stdout.trim();
    await git('checkout', '-q', '-b', 'feature');

    await writeFile(join(projectRoot, 'direct.ts'), 'direct\n');
    await git('add', 'direct.ts');
    await git('commit', '-q', '-m', 'direct boundary\n\nTask: T3');
    const directBoundary = (await git('rev-parse', 'HEAD')).stdout.trim();

    await writeFile(join(projectRoot, 'absorbed.ts'), 'already upstream\n');
    await git('add', 'absorbed.ts');
    await git('commit', '-q', '-m', 'absorbed boundary');
    const residueBoundary = (await git('rev-parse', 'HEAD')).stdout.trim();

    await writeFile(join(projectRoot, 'successor.ts'), 'successor\n');
    await git('add', 'successor.ts');
    await git('commit', '-q', '-m', 'surviving successor');
    const successorBoundary = (await git('rev-parse', 'HEAD')).stdout.trim();
    const originalHead = successorBoundary;

    await git('checkout', '-q', 'main');
    await writeFile(join(projectRoot, 'absorbed.ts'), 'already upstream\n');
    await git('add', 'absorbed.ts');
    await git('commit', '-q', '-m', 'upstream absorbed boundary');
    await writeFile(join(projectRoot, 'upstream.ts'), 'base advanced\n');
    await git('add', 'upstream.ts');
    await git('commit', '-q', '-m', 'advance base');
    await git('checkout', '-q', 'feature');

    return { rootCommit, directBoundary, residueBoundary, successorBoundary, originalHead };
  }

  async function seedRepairState(fixture: ReplayFixture): Promise<Record<string, unknown>> {
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    await writeFile(join(projectRoot, PLAN_PATH), '# Plan\n\n### Task 1: Direct\n');
    const state = engineState(fixture);
    await writeFile(
      join(projectRoot, '.pipeline', 'engine-state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'T1', status: 'pending', commit: fixture.directBoundary }] }),
    );
    await writeFile(
      join(projectRoot, '.pipeline', 'task-evidence.json'),
      JSON.stringify({
        evidenceStamps: {
          T1: {
            sha: fixture.directBoundary,
            citedShas: [fixture.directBoundary],
          },
        },
      }),
    );
    return state;
  }

  async function performProductionTranslation(): Promise<Record<string, string>> {
    const runner = makeGitRunner(projectRoot);
    const outcome = await performRebase(runner, projectRoot, 'main', {
      translateAfterRebase,
    });
    expect(outcome.kind).toBe('changed');
    return JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'rebase-rewrites.json'), 'utf8'),
    ) as Record<string, string>;
  }

  it('rewrites direct and absorbed boundaries while preserving unrelated state and the other translated stores', async () => {
    const fixture = await createReplayFixture();
    const before = await seedRepairState(fixture);

    const rewrites = await performProductionTranslation();
    const after = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8'),
    ) as ReturnType<typeof engineState>;
    const beforeTyped = before as ReturnType<typeof engineState>;

    expect(rewrites[fixture.directBoundary]).toMatch(/^[0-9a-f]{40}$/);
    expect(rewrites[fixture.successorBoundary]).toMatch(/^[0-9a-f]{40}$/);
    expect(after.repairObligations.records.direct.baseline.head)
      .toBe(rewrites[fixture.directBoundary]);
    expect(after.repairObligations.records.successor.baseline.head)
      .toBe(rewrites[fixture.successorBoundary]);
    expect(after.repairObligations.records.outside)
      .toEqual(beforeTyped.repairObligations.records.outside);
    expect(after.activePlanPath).toBe(beforeTyped.activePlanPath);
    expect(after.appendedTaskIds).toEqual(beforeTyped.appendedTaskIds);

    const status = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8'),
    ) as { tasks: Array<{ commit: string }> };
    const evidence = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'task-evidence.json'), 'utf8'),
    ) as { evidenceStamps: Record<string, { sha: string; citedShas: string[] }> };
    expect(status.tasks[0]?.commit).toBe(rewrites[fixture.directBoundary]);
    expect(evidence.evidenceStamps.T1).toMatchObject({
      sha: rewrites[fixture.directBoundary],
      citedShas: [rewrites[fixture.directBoundary]],
    });
  }, 20_000);

  it('resolves trailers after direct and successor boundaries but excludes a trailer on the boundary', async () => {
    const fixture = await createReplayFixture();
    await seedRepairState(fixture);
    await performProductionTranslation();

    await writeFile(join(projectRoot, 'repair.ts'), 'repair\n');
    await git('add', 'repair.ts');
    await git('commit', '-q', '-m', 'repair both obligations\n\nTask: T1\nTask: T2');

    const resolution = await resolveTaskIdsWithDiagnostics(projectRoot, ['1', '2', '3']);
    expect(resolution.resolved).toEqual(new Set(['1', '2']));
    expect([...resolution.unavailableReasons.entries()]).toEqual([]);
  }, 20_000);

  it('leaves malformed repair state byte-identical while translating sibling stores and rotating the seal', async () => {
    await git('checkout', '-q', '-b', 'feature');
    await writeFile(join(projectRoot, 'feature.ts'), 'feature\n');
    await git('add', 'feature.ts');
    await git('commit', '-q', '-m', 'feature boundary');
    const originalHead = (await git('rev-parse', 'HEAD')).stdout.trim();
    await createProtectedArtifactSeal({ projectRoot, baselineCommit: originalHead });

    await git('checkout', '-q', 'main');
    await writeFile(join(projectRoot, 'upstream.ts'), 'upstream\n');
    await git('add', 'upstream.ts');
    await git('commit', '-q', '-m', 'advance base');
    await git('checkout', '-q', 'feature');

    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const malformed = '{\n  "activePlanPath": ".docs/plans/feature.md",\n  "repairObligations": "garbage"\n}\n';
    await writeFile(join(projectRoot, '.pipeline', 'engine-state.json'), malformed);
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'T1', status: 'pending', commit: originalHead }] }),
    );
    await writeFile(
      join(projectRoot, '.pipeline', 'task-evidence.json'),
      JSON.stringify({ evidenceStamps: { T1: { sha: originalHead, citedShas: [originalHead] } } }),
    );

    const onRebaseline = vi.fn();
    const runner = makeGitRunner(projectRoot);
    const outcome = await performRebase(runner, projectRoot, 'main', {
      translateAfterRebase: (gitRunner, root, onto, origHead, head) =>
        translateAfterRebase(gitRunner, root, onto, origHead, head, undefined, onRebaseline),
    });
    expect(outcome.kind).toBe('changed');
    const newHead = (await git('rev-parse', 'HEAD')).stdout.trim();

    expect(await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8'))
      .toBe(malformed);
    expect(JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8'),
    ).tasks[0].commit).toBe(newHead);
    expect(JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'task-evidence.json'), 'utf8'),
    ).evidenceStamps.T1.sha).toBe(newHead);
    expect(onRebaseline).toHaveBeenCalledTimes(1);

    const resolution = await resolveTaskIdsWithDiagnostics(projectRoot, ['T1']);
    expect(resolution.resolved).toEqual(new Set());
    expect(resolution.unavailableReasons.get('T1'))
      .toContain('repair state is unavailable');
    await expect(access(join(projectRoot, '.pipeline', 'engine-state.json'))).resolves.toBeUndefined();
  }, 20_000);
});

