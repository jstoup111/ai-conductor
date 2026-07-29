import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyHaltClasses } from '../../src/engine/halt-class-migration.js';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'halt-class-migration-'));
  roots.push(root);
  return root;
}

async function writeLiveHalt(
  worktreeBase: string,
  slug: string,
  haltClass?: string,
): Promise<void> {
  const pipeline = join(worktreeBase, slug, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  await writeFile(join(pipeline, 'HALT'), `${slug} halted\n`, 'utf-8');
  if (haltClass !== undefined) {
    await writeFile(join(pipeline, 'HALT.class'), haltClass, 'utf-8');
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('migrateLegacyHaltClasses', () => {
  it('atomically stamps only live unclassified HALTs, publishes the watermark last, and is idempotent', async () => {
    const projectRoot = await makeRoot();
    const worktreeBase = join(projectRoot, '.worktrees');
    await writeLiveHalt(worktreeBase, 'bare');
    await writeLiveHalt(worktreeBase, 'human', 'needs-human');
    await writeLiveHalt(worktreeBase, 'mechanical', 'mechanical');
    await writeLiveHalt(worktreeBase, 'legacy', 'legacy');
    await mkdir(join(worktreeBase, 'not-live', '.pipeline'), { recursive: true });

    const logs: string[] = [];
    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    const watermark = join(projectRoot, '.daemon', 'migrations', 'halt-classification-v1');
    const firstRun = {
      bare: await readFile(join(worktreeBase, 'bare', '.pipeline', 'HALT.class'), 'utf-8'),
      human: await readFile(join(worktreeBase, 'human', '.pipeline', 'HALT.class'), 'utf-8'),
      mechanical: await readFile(join(worktreeBase, 'mechanical', '.pipeline', 'HALT.class'), 'utf-8'),
      legacy: await readFile(join(worktreeBase, 'legacy', '.pipeline', 'HALT.class'), 'utf-8'),
      pipelineEntries: await readdir(join(worktreeBase, 'bare', '.pipeline')),
      watermark: await readFile(watermark, 'utf-8'),
      logs: [...logs],
    };

    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    expect({
      firstRun,
      secondRunAddedLogs: logs.slice(firstRun.logs.length),
      bareAfterSecondRun: await readFile(join(worktreeBase, 'bare', '.pipeline', 'HALT.class'), 'utf-8'),
    }).toEqual({
      firstRun: {
        bare: 'legacy',
        human: 'needs-human',
        mechanical: 'mechanical',
        legacy: 'legacy',
        pipelineEntries: ['HALT', 'HALT.class'],
        watermark: 'complete\n',
        logs: [
          '[halt-class-migration] stamped bare as legacy',
          '[halt-class-migration] completed halt-classification-v1',
        ],
      },
      secondRunAddedLogs: [],
      bareAfterSecondRun: 'legacy',
    });
  });
});
