// Covers: task:1
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateProjectHalts } from '../../../src/engine/monitor/halt-inventory.js';

describe('Task 1 — per-project halt inventory', () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns each halted worktree with its project, first-line reason, and halt-class disposition', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));

    await Promise.all([
      writeHalt(projectRoot, 'needs-review', 'Choose a migration path\nThe existing state is incompatible.\n', 'needs-human\n'),
      writeHalt(projectRoot, 'retry-build', 'Retry after the dependency is available.\n', 'mechanical\n'),
    ]);

    expect(await enumerateProjectHalts(projectRoot)).toEqual([
      {
        project: projectRoot,
        slug: 'needs-review',
        reason: 'Choose a migration path',
        haltClass: 'needs-human',
      },
      {
        project: projectRoot,
        slug: 'retry-build',
        reason: 'Retry after the dependency is available.',
        haltClass: 'mechanical',
      },
    ]);
  });
});

async function writeHalt(projectRoot: string, slug: string, reason: string, haltClass: string) {
  const pipeline = join(projectRoot, '.worktrees', slug, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  await Promise.all([
    writeFile(join(pipeline, 'HALT'), reason, 'utf-8'),
    writeFile(join(pipeline, 'HALT.class'), haltClass, 'utf-8'),
  ]);
}
