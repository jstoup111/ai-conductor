import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  runContainmentFloor,
  runPerTaskCommitFloor,
  renderPerTaskFloorReport,
} from '../../src/engine/per-task-commit-floor.js';

describe('per-task-commit-floor', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-commit-floor-test-'));
    planPath = join(dir, 'plan.md');
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, '.gitkeep'), '');
    await execa('git', ['add', '.gitkeep'], { cwd: dir });
    await execa('git', ['commit', '-m', 'baseline'], { cwd: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is satisfied when every plan task is covered by a Task-trailer commit', async () => {
    await writeFile(
      planPath,
      '### Task 1: First\n**Files:** a.ts\n\n### Task 2: Second\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });
    await writeFile(join(dir, 'b.ts'), 'y');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 2\n\nTask: 2'], { cwd: dir });

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.coveredTasks.sort()).toEqual(['1', '2']);
  });

  it('reports a gap for a plan task with no covering commit and no marker', async () => {
    await writeFile(
      planPath,
      '### Task 1: First\n**Files:** a.ts\n\n### Task 2: Second\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(false);
    expect(report.gaps).toEqual(['2']);
    expect(renderPerTaskFloorReport(report)).toEqual([
      "Advisory: task 2 produced no commit carrying its Task: trailer and no verify-only/skip marker — confirm its work shipped inside another task's commit or add a **Verify-only:** marker.",
    ]);
  });

  it('does not count a Verify-only-marked task as a gap', async () => {
    await writeFile(
      planPath,
      '### Task 1: First\n**Files:** a.ts\n\n### Task 2: Second\n**Verify-only:** yes\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.markedTasks).toEqual(['2']);
  });

  it('fails soft (satisfied, no gaps) when the plan file is missing', async () => {
    const report = await runPerTaskCommitFloor({
      projectRoot: dir,
      planPath: join(dir, 'nonexistent-plan.md'),
    });

    expect(report.satisfied).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.skipNotes.length).toBeGreaterThan(0);
  });

  it('does not count a skipped task-status.json row as a gap', async () => {
    await writeFile(
      planPath,
      '### Task 1: First\n**Files:** a.ts\n\n### Task 2: Second\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '2', status: 'skipped' }] }),
    );

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.markedTasks).toEqual(['2']);
  });

  it('behaves as before (existing gap) when task-status.json is missing', async () => {
    await writeFile(
      planPath,
      '### Task 1: First\n**Files:** a.ts\n\n### Task 2: Second\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(false);
    expect(report.gaps).toEqual(['2']);
  });

  it('matches a skipped task-status.json row via canonicalTaskId when id formats differ', async () => {
    await writeFile(
      planPath,
      '### Task 6: First\n**Files:** a.ts\n\n### Task 7: Second\n**Files:** b.ts\n',
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'work on task 7\n\nTask: 7'], { cwd: dir });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '6', status: 'skipped' }] }),
    );

    const report = await runPerTaskCommitFloor({ projectRoot: dir, planPath });

    expect(report.satisfied).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(report.markedTasks).toEqual(['6']);
  });

  it('is satisfied when a Task-trailer commit changes only its declared plan paths', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await writeFile(join(dir, 'declared.ts'), 'x');
    await execa('git', ['add', 'declared.ts'], { cwd: dir });
    await execa('git', ['commit', '-m', 'contained\n\nTask: 3'], { cwd: dir });

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({ satisfied: true, violations: [] });
  });

  it('reports the Task trailer id, commit sha, and undeclared changed path', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await writeFile(join(dir, 'undeclared.ts'), 'x');
    await execa('git', ['add', 'undeclared.ts'], { cwd: dir });
    await execa('git', ['commit', '-m', 'escaped\n\nTask: 3'], { cwd: dir });
    const sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({
      satisfied: false,
      violations: [{ taskId: '3', sha, paths: ['undeclared.ts'] }],
    });
  });

  it('accepts a commit-local Scope widening and exposes it for build review', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await writeFile(join(dir, 'widened.ts'), 'x');
    await execa('git', ['add', 'widened.ts'], { cwd: dir });
    await execa('git', [
      'commit',
      '-m',
      'widened\n\nTask: 3\nScope: widened.ts — needed by the task',
    ], { cwd: dir });
    const sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({
      satisfied: true,
      violations: [],
      acceptedWidenings: [
        { path: 'widened.ts', rationale: 'needed by the task', taskId: '3', sha },
      ],
    });
  });

  it('does not record a redundant Scope trailer when the plan path matches by suffix', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** config.ts\n');
    await mkdir(join(dir, 'src/engine'), { recursive: true });
    await writeFile(join(dir, 'src/engine/config.ts'), 'x');
    await execa('git', ['add', 'src/engine/config.ts'], { cwd: dir });
    await execa('git', [
      'commit',
      '-m',
      'contained by suffix\n\nTask: 3\nScope: src/engine/config.ts — redundant declaration',
    ], { cwd: dir });

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({
      satisfied: true,
      violations: [],
      acceptedWidenings: [],
    });
  });

  it.each([
    ['an unreadable plan', async () => ({ projectRoot: dir, planPath: join(dir, 'missing.md') })],
    ['a git failure', async () => {
      await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
      return { projectRoot: join(dir, 'not-a-repository'), planPath };
    }],
    ['malformed plan input', async () => {
      await writeFile(planPath, 'this is not a task plan');
      return { projectRoot: dir, planPath };
    }],
  ])('fails soft with a skip note for %s', async (_caseName, makeArgs) => {
    const report = await runContainmentFloor(await makeArgs());

    expect(report).toMatchObject({ satisfied: true, violations: [] });
    expect(report.skipNotes).toHaveLength(1);
  });

  it('does not report a merge commit carrying a Task trailer as a violation', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await execa('git', ['checkout', '-b', 'side'], { cwd: dir });
    await writeFile(join(dir, 'undeclared.ts'), 'x');
    await execa('git', ['add', 'undeclared.ts'], { cwd: dir });
    await execa('git', ['commit', '-m', 'side work'], { cwd: dir });
    await execa('git', ['checkout', 'main'], { cwd: dir });
    await execa('git', ['merge', '--no-ff', 'side', '-m', 'merge side\n\nTask: 3'], { cwd: dir });

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({ satisfied: true, violations: [] });
  });

  it('does not report commits while a rebase replay is in progress', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await writeFile(join(dir, 'undeclared.ts'), 'x');
    await execa('git', ['add', 'undeclared.ts'], { cwd: dir });
    await execa('git', ['commit', '-m', 'replayed\n\nTask: 3'], { cwd: dir });
    await mkdir(join(dir, '.git', 'rebase-merge'));

    const report = await runContainmentFloor({ projectRoot: dir, planPath });

    expect(report).toMatchObject({ satisfied: true, violations: [] });
  });

  it('does not report commits while the engine commit exemption is set', async () => {
    await writeFile(planPath, '### Task 3: Contain\n**Files:** declared.ts\n');
    await writeFile(join(dir, 'undeclared.ts'), 'x');
    await execa('git', ['add', 'undeclared.ts'], { cwd: dir });
    await execa('git', ['commit', '-m', 'bookkeeping\n\nTask: 3'], { cwd: dir });
    const prior = process.env.CONDUCT_ENGINE_COMMIT;
    process.env.CONDUCT_ENGINE_COMMIT = '1';

    try {
      const report = await runContainmentFloor({ projectRoot: dir, planPath });
      expect(report).toMatchObject({ satisfied: true, violations: [] });
    } finally {
      if (prior === undefined) delete process.env.CONDUCT_ENGINE_COMMIT;
      else process.env.CONDUCT_ENGINE_COMMIT = prior;
    }
  });
});
