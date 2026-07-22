import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  runPerTaskCommitFloor,
  renderPerTaskFloorReport,
} from '../../src/engine/per-task-commit-floor.js';

describe('per-task-commit-floor', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-commit-floor-test-'));
    planPath = join(dir, 'plan.md');
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
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
});
