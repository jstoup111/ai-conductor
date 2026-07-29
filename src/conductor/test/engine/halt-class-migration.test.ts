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

  it('retries an interrupted scan idempotently before publishing the watermark', async () => {
    const projectRoot = await makeRoot();
    const worktreeBase = join(projectRoot, '.worktrees');
    await writeLiveHalt(worktreeBase, 'already-stamped', 'legacy');
    await writeLiveHalt(worktreeBase, 'not-yet-stamped');

    const logs: string[] = [];
    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    expect({
      alreadyStamped: await readFile(
        join(worktreeBase, 'already-stamped', '.pipeline', 'HALT.class'),
        'utf-8',
      ),
      newlyStamped: await readFile(
        join(worktreeBase, 'not-yet-stamped', '.pipeline', 'HALT.class'),
        'utf-8',
      ),
      watermark: await readFile(
        join(projectRoot, '.daemon', 'migrations', 'halt-classification-v1'),
        'utf-8',
      ),
      logs,
    }).toEqual({
      alreadyStamped: 'legacy',
      newlyStamped: 'legacy',
      watermark: 'complete\n',
      logs: [
        '[halt-class-migration] stamped not-yet-stamped as legacy',
        '[halt-class-migration] completed halt-classification-v1',
      ],
    });
  });

  it('isolates and logs an individual stamp failure while leaving that slug unclassified', async () => {
    const projectRoot = await makeRoot();
    const worktreeBase = join(projectRoot, '.worktrees');
    await writeLiveHalt(worktreeBase, 'blocked');
    await mkdir(join(worktreeBase, 'blocked', '.pipeline', 'HALT.class.tmp'));
    await writeLiveHalt(worktreeBase, 'stampable');

    const logs: string[] = [];
    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    expect({
      blockedEntries: await readdir(join(worktreeBase, 'blocked', '.pipeline')),
      stampableClass: await readFile(
        join(worktreeBase, 'stampable', '.pipeline', 'HALT.class'),
        'utf-8',
      ),
      watermark: await readFile(
        join(projectRoot, '.daemon', 'migrations', 'halt-classification-v1'),
        'utf-8',
      ),
      logs,
    }).toEqual({
      blockedEntries: ['HALT', 'HALT.class.tmp'],
      stampableClass: 'legacy',
      watermark: 'complete\n',
      logs: [
        '[halt-class-migration] failed to stamp blocked as legacy (EISDIR); left unclassified',
        '[halt-class-migration] stamped stampable as legacy',
        '[halt-class-migration] completed halt-classification-v1',
      ],
    });
  });

  it('replaces malformed pre-boundary class content with legacy', async () => {
    const projectRoot = await makeRoot();
    const worktreeBase = join(projectRoot, '.worktrees');
    await writeLiveHalt(worktreeBase, 'malformed', 'not-a-class\n');

    const logs: string[] = [];
    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    expect({
      haltClass: await readFile(
        join(worktreeBase, 'malformed', '.pipeline', 'HALT.class'),
        'utf-8',
      ),
      logs,
    }).toEqual({
      haltClass: 'legacy',
      logs: [
        '[halt-class-migration] stamped malformed as legacy',
        '[halt-class-migration] completed halt-classification-v1',
      ],
    });
  });

  it('does not reclassify a bare marker created after the watermark', async () => {
    const projectRoot = await makeRoot();
    const worktreeBase = join(projectRoot, '.worktrees');
    const migrationDirectory = join(projectRoot, '.daemon', 'migrations');
    await mkdir(migrationDirectory, { recursive: true });
    await writeFile(
      join(migrationDirectory, 'halt-classification-v1'),
      'complete\n',
      'utf-8',
    );
    await writeLiveHalt(worktreeBase, 'post-boundary');

    const logs: string[] = [];
    await migrateLegacyHaltClasses(projectRoot, worktreeBase, (line) => logs.push(line));

    expect({
      pipelineEntries: await readdir(join(worktreeBase, 'post-boundary', '.pipeline')),
      logs,
    }).toEqual({
      pipelineEntries: ['HALT'],
      logs: [],
    });
  });
});
