// Covers: task:1, task:2
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enumerateProjectHalts,
  type HaltInventoryDeps,
} from '../../../src/engine/monitor/halt-inventory.js';

vi.mock('../../../src/engine/park-marker.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/engine/park-marker.js')>()),
  isOperatorParked: vi.fn().mockResolvedValue(false),
}));

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

  it('keeps a halt with no class sidecar as unclassified', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    const pipeline = join(projectRoot, '.worktrees', 'missing-class', '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'HALT'), 'Operator decision required.\n', 'utf-8');

    expect(await enumerateProjectHalts(projectRoot)).toEqual([{
      project: projectRoot,
      slug: 'missing-class',
      reason: 'Operator decision required.',
      haltClass: 'unclassified',
    }]);
  });

  it('keeps an empty halt with an unstated reason', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'empty-halt', '', 'needs-human\n');

    expect(await enumerateProjectHalts(projectRoot)).toEqual([{
      project: projectRoot,
      slug: 'empty-halt',
      reason: 'unstated',
      haltClass: 'needs-human',
    }]);
  });

  it('returns no entries when the worktree collection or a former halted worktree is absent', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    expect(await enumerateProjectHalts(projectRoot)).toEqual([]);

    await writeHalt(projectRoot, 'removed-feature', 'Previously halted.\n', 'mechanical\n');
    await rm(join(projectRoot, '.worktrees', 'removed-feature'), { recursive: true });
    expect(await enumerateProjectHalts(projectRoot)).toEqual([]);
  });

  it('reports an unreadable halt without dropping another non-parked halt', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'valid-feature', 'Valid halt.\n', 'mechanical\n');
    const pipeline = join(projectRoot, '.worktrees', 'unreadable-feature', '.pipeline');
    await mkdir(join(pipeline, 'HALT'), { recursive: true });
    await writeFile(join(pipeline, 'HALT.class'), 'needs-human\n', 'utf-8');
    const isOperatorParked = vi.fn().mockResolvedValue(false);

    const entries = await enumerateProjectHalts(projectRoot, { isOperatorParked });

    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({
      project: projectRoot,
      slug: 'valid-feature',
      reason: 'Valid halt.',
      haltClass: 'mechanical',
    });
    expect(entries.find(({ slug }) => slug === 'unreadable-feature')).toEqual(expect.objectContaining({
      project: projectRoot,
      slug: 'unreadable-feature',
      reason: expect.stringMatching(/read|error|fail/i),
      haltClass: 'needs-human',
    }));
    expect(isOperatorParked).toHaveBeenCalledWith(projectRoot, 'unreadable-feature');
  });

  it('does not change the project tree while enumerating halts', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'read-only-feature', 'Awaiting review.\n', 'needs-human\n');
    const before = await projectTreeChecksum(projectRoot);

    expect(await enumerateProjectHalts(projectRoot)).toHaveLength(1);

    expect(await projectTreeChecksum(projectRoot)).toBe(before);
  });

  it('excludes a halted worktree when the injected park predicate reports it parked', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    const pipeline = join(projectRoot, '.worktrees', 'parked-feature', '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'HALT'), 'Awaiting operator decision.\n', 'utf-8');

    const isOperatorParked = vi.fn(async (root: string, slug: string) =>
      root === projectRoot && slug === 'parked-feature');
    expect(await enumerateProjectHalts(projectRoot, { isOperatorParked })).toEqual([]);
  });

  it('excludes a HALT co-present with a completion marker', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    const pipeline = join(projectRoot, '.worktrees', 'completed-feature', '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await Promise.all([
      writeFile(join(pipeline, 'HALT'), 'A stale halt.\n', 'utf-8'),
      writeFile(join(pipeline, 'DONE'), 'complete\n', 'utf-8'),
    ]);

    expect(await enumerateProjectHalts(projectRoot)).toEqual([]);
  });

  it('excludes a halted worktree when the injected park predicate fails closed', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'park-read-error', 'Awaiting operator decision.\n', 'needs-human\n');
    const isOperatorParked: HaltInventoryDeps['isOperatorParked'] = vi.fn().mockResolvedValue(true);

    expect(await enumerateProjectHalts(projectRoot, { isOperatorParked })).toEqual([]);
  });

  it('includes a retained HALT after a later enumeration finds it unparked', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'park-state-changed', 'Awaiting operator decision.\n', 'needs-human\n');
    const isOperatorParked: HaltInventoryDeps['isOperatorParked'] = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = await enumerateProjectHalts(projectRoot, { isOperatorParked });
    const second = await enumerateProjectHalts(projectRoot, { isOperatorParked });

    expect([first.map(({ slug }) => slug), second.map(({ slug }) => slug)]).toEqual([[], ['park-state-changed']]);
  });

  it('excludes a retained HALT after a later enumeration finds it parked', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await writeHalt(projectRoot, 'park-state-changed', 'Awaiting operator decision.\n', 'needs-human\n');
    const isOperatorParked: HaltInventoryDeps['isOperatorParked'] = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const first = await enumerateProjectHalts(projectRoot, { isOperatorParked });
    const second = await enumerateProjectHalts(projectRoot, { isOperatorParked });

    expect([first.map(({ slug }) => slug), second.map(({ slug }) => slug)]).toEqual([['park-state-changed'], []]);
  });

  it('excludes an unreadable HALT fallback entry when its worktree is parked', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-inventory-'));
    await mkdir(join(projectRoot, '.worktrees', 'unreadable-parked', '.pipeline', 'HALT'), { recursive: true });
    const isOperatorParked: HaltInventoryDeps['isOperatorParked'] = vi.fn().mockResolvedValue(true);

    expect(await enumerateProjectHalts(projectRoot, { isOperatorParked })).toEqual([]);
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

async function projectTreeChecksum(root: string): Promise<string> {
  const hash = createHash('sha256');
  const rootMetadata = await stat(root, { bigint: true });
  hash.update(`${root}\0directory\0${rootMetadata.mtimeNs}\0${rootMetadata.size}\0`);

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await stat(path, { bigint: true });
      hash.update(`${path}\0${entry.isDirectory() ? 'directory' : 'file'}\0${metadata.mtimeNs}\0${metadata.size}\0`);
      if (entry.isDirectory()) await visit(path);
      else hash.update(await readFile(path));
    }
  }

  await visit(root);
  return hash.digest('hex');
}
