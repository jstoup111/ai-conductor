// Covers: task:15
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pipelinePathFor, parseChildId } from '../../src/engine/child-context.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { readState } from '../../src/engine/state.js';
import type { StateMutation } from '../../src/engine/conduct-state-store.js';
import type { ConductState } from '../../src/types/state.js';

describe('conduct-state store at a child path', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'child-conduct-state-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const childPath = (child: number): string =>
    pipelinePathFor(root, 'conduct-state.json', parseChildId(String(child))!);
  const flatPath = (): string => pipelinePathFor(root, 'conduct-state.json');

  async function seed(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf-8');
  }

  async function assertNoTempFiles(directory: string): Promise<void> {
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  }

  it('writes only the child-2 state file while flat and child-3 bytes are unchanged', async () => {
    const flatStatePath = flatPath();
    const child2StatePath = childPath(2);
    const child3StatePath = childPath(3);

    await seed(flatStatePath, `{
  "bootstrap": "done",
  "last_step": "bootstrap"
}
`);
    await seed(child3StatePath, `{
  "build": "done",
  "last_step": "build"
}
`);

    const flatBefore = await readFile(flatStatePath, 'utf-8');
    const child3Before = await readFile(child3StatePath, 'utf-8');

    const store = createFilesystemConductStateStore(child2StatePath);
    await expect(store.replace({
      intent: 'seed child-2 region statuses',
      next: {
        acceptance_specs: 'done',
        build: 'done',
        test_suite: 'done',
        build_review: 'done',
        last_step: 'build_review',
      },
      privileged: true,
    })).resolves.toEqual({ kind: 'applied' });

    await expect(readFile(child2StatePath, 'utf-8')).resolves.toBe(`{
  "acceptance_specs": "done",
  "build": "done",
  "test_suite": "done",
  "build_review": "done",
  "last_step": "build_review"
}
`);
    await expect(readFile(flatStatePath, 'utf-8')).resolves.toBe(flatBefore);
    await expect(readFile(child3StatePath, 'utf-8')).resolves.toBe(child3Before);
    await assertNoTempFiles(dirname(child2StatePath));
  });

  it('reads a missing child state file exactly as a missing flat file and creates nothing', async () => {
    const flatResult = await readState(flatPath());
    const childResult = await readState(childPath(2));

    expect(childResult).toEqual(flatResult);
    expect(childResult).toEqual({ ok: true, value: {} });

    const childrenProbe = await stat(join(root, '.pipeline', 'children')).catch(
      (error) => error as NodeJS.ErrnoException,
    );
    expect(childrenProbe).toMatchObject({ code: 'ENOENT' });
  });

  it('reports a typed conflict for the second writer and preserves the first writer value', async () => {
    const child2StatePath = childPath(2);
    await seed(child2StatePath, '{"build":"pending"}\n');

    const storeA = createFilesystemConductStateStore(child2StatePath);
    const storeB = createFilesystemConductStateStore(child2StatePath);

    const snapshotA = await storeA.read();
    const snapshotB = await storeB.read();
    expect(snapshotA).toEqual(snapshotB);

    const completeBuild: StateMutation<ConductState> = {
      field: 'build',
      expected: 'pending',
      intent: 'complete build step',
      next: 'done',
    };
    const invalidateBuild: StateMutation<ConductState> = {
      field: 'build',
      expected: 'pending',
      intent: 'invalidate build step',
      next: 'stale',
    };

    await expect(storeA.apply(completeBuild)).resolves.toEqual({ kind: 'applied' });

    const secondResult = await storeB.apply(invalidateBuild);
    expect(secondResult).toMatchObject({ kind: 'conflict' });
    if (secondResult.kind === 'conflict') {
      expect(secondResult.message).toContain('build');
      expect(secondResult.message).toContain('invalidate build step');
    }

    await expect(readFile(child2StatePath, 'utf-8')).resolves.toBe('{\n  "build": "done"\n}\n');
    await assertNoTempFiles(dirname(child2StatePath));
  });

  it('writes whole-feature step statuses through the flat store only, never under children/', async () => {
    const flatStatePath = flatPath();
    const child2StatePath = childPath(2);

    await seed(child2StatePath, `{
  "build": "done",
  "last_step": "build"
}
`);
    await seed(flatStatePath, `{
  "prd_audit": "pending",
  "manual_test": "pending"
}
`);

    const childBefore = await readFile(child2StatePath, 'utf-8');

    const store = createFilesystemConductStateStore(flatStatePath);
    await expect(store.applyBatch({
      name: 'record whole-feature step statuses',
      mutations: [
        {
          field: 'prd_audit',
          expected: 'pending',
          intent: 'complete prd audit',
          next: 'done',
        },
        {
          field: 'manual_test',
          expected: 'pending',
          intent: 'complete manual test',
          next: 'done',
        },
      ],
    })).resolves.toEqual({ kind: 'applied' });

    await expect(readFile(flatStatePath, 'utf-8')).resolves.toBe(`{
  "prd_audit": "done",
  "manual_test": "done"
}
`);
    await expect(readFile(child2StatePath, 'utf-8')).resolves.toBe(childBefore);
    await assertNoTempFiles(dirname(flatStatePath));
  });
});