import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { runCopyEquivalence } from '../../src/engine/copy-equivalence.js';
import { runPerTaskCommitFloor } from '../../src/engine/per-task-commit-floor.js';

describe('copy-equivalence blocking verdict', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'copy-equivalence-blocking-test-'));
    await execa('git', ['init', '-b', 'main'], { cwd: projectRoot });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: projectRoot });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
    await writeFile(join(projectRoot, '.gitkeep'), '');
    await execa('git', ['add', '.gitkeep'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'baseline'], { cwd: projectRoot });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('fails its outcome on a mismatch while an advisory floor gap remains only a report', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';
    const planPath = join(projectRoot, 'plan.md');
    await writeFile(planPath, '### Task 7: Copy equivalence\n**Files:** src/engine/target-widget.ts\n');

    const equivalence = await runCopyEquivalence(
      { kind: 'resolved', sourcePath, renameMap: [] },
      targetPath,
      async (path) => (path === sourcePath ? 'expected\n' : 'actual\n'),
    );
    const floor = await runPerTaskCommitFloor({ projectRoot, planPath });

    expect(equivalence).toMatchObject({
      success: false,
      output: 'Copy equivalence content mismatch for src/engine/target-widget.ts at line 1, column 1.',
    });
    expect(floor).toMatchObject({ satisfied: false, gaps: ['7'] });
    expect(equivalence.success).toBe(false);
  });
});
