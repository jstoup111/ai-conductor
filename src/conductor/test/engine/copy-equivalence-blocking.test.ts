import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { runCopyEquivalence } from '../../src/engine/copy-equivalence.js';

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

  it('fails its outcome on a mismatch', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';

    const equivalence = await runCopyEquivalence(
      { kind: 'resolved', sourcePath, renameMap: [] },
      targetPath,
      async (path) => (path === sourcePath ? 'expected\n' : 'actual\n'),
    );
    expect(equivalence).toMatchObject({
      success: false,
      output: 'Copy equivalence content mismatch for src/engine/target-widget.ts at line 1, column 1.',
    });
    expect(equivalence.success).toBe(false);
  });
});
