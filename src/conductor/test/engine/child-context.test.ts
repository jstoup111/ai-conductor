// Covers: task:2
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CHILD_ID,
  childStateExists,
  isRegionStep,
  listExistingChildren,
  parseChildId,
  pipelinePathFor,
} from '../../src/engine/child-context.js';
import { MAX_PLAN_SLICES } from '../../src/engine/plan-slices.js';

describe('parseChildId', () => {
  it('accepts string child ids 1..9', () => {
    for (let id = 1; id <= MAX_CHILD_ID; id += 1) {
      expect(parseChildId(String(id))).toBe(id);
    }
  });

  it('accepts numeric child ids 1..9', () => {
    for (let id = 1; id <= MAX_CHILD_ID; id += 1) {
      expect(parseChildId(id)).toBe(id);
    }
  });

  it('rejects invalid string and numeric inputs', () => {
    for (const raw of ['0', '10', 'two', '-1', '1.5', '']) {
      expect(parseChildId(raw)).toBeUndefined();
    }
    for (const raw of [0, 10, -1, 1.5]) {
      expect(parseChildId(raw)).toBeUndefined();
    }
  });
});

describe('MAX_PLAN_SLICES bound', () => {
  it('keeps the plan slice count within the child id range', () => {
    expect(MAX_PLAN_SLICES).toBeLessThanOrEqual(MAX_CHILD_ID);
  });
});

describe('pipelinePathFor', () => {
  it('forms the flat pipeline path without a child', () => {
    const root = '/repo';
    expect(pipelinePathFor(root, 'task-status.json')).toBe(
      join(root, '.pipeline', 'task-status.json'),
    );
  });

  it('forms a child pipeline path under children/<id>/', () => {
    const root = '/repo';
    expect(pipelinePathFor(root, 'task-status.json', parseChildId('3')!)).toBe(
      join(root, '.pipeline', 'children', '3', 'task-status.json'),
    );
  });
});

describe('isRegionStep', () => {
  it('is true for exactly the four region steps', () => {
    for (const step of ['acceptance_specs', 'build', 'test_suite', 'build_review']) {
      expect(isRegionStep(step)).toBe(true);
    }
    for (const step of ['coverage_binding', 'engineer', 'land', 'plan-slices', '']) {
      expect(isRegionStep(step)).toBe(false);
    }
  });
});

describe('child state probes', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'child-context-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('childStateExists', () => {
    it('is true only when the child path is a directory', async () => {
      const child = parseChildId('1')!;
      const missing = parseChildId('2')!;
      const fileChild = parseChildId('3')!;

      const childrenDir = join(root, '.pipeline', 'children');
      await mkdir(join(childrenDir, '1'), { recursive: true });
      await writeFile(join(childrenDir, '3'), 'not a directory');

      await expect(childStateExists(root, child)).resolves.toBe(true);
      await expect(childStateExists(root, missing)).resolves.toBe(false);
      await expect(childStateExists(root, fileChild)).resolves.toBe(false);
    });
  });

  describe('listExistingChildren', () => {
    it('returns ascending accepted child ids, skipping foo, 12, and files', async () => {
      const childrenDir = join(root, '.pipeline', 'children');
      await mkdir(join(childrenDir, '1'), { recursive: true });
      await mkdir(join(childrenDir, '2'), { recursive: true });
      await mkdir(join(childrenDir, 'foo'), { recursive: true });
      await mkdir(join(childrenDir, '12'), { recursive: true });
      await writeFile(join(childrenDir, '3'), 'not a directory');

      await expect(listExistingChildren(root)).resolves.toEqual([1, 2]);
    });

    it('returns [] when children/ is absent and never creates anything', async () => {
      await expect(listExistingChildren(root)).resolves.toEqual([]);

      const missing = await stat(join(root, '.pipeline')).catch(
        (error) => error as NodeJS.ErrnoException,
      );
      expect(missing).toMatchObject({ code: 'ENOENT' });
    });
  });
});