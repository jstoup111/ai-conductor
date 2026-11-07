// Covers: task:6
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  acquire: vi.fn(),
  parked: vi.fn(),
}));

vi.mock('../../src/engine/feature-dispatch-lease.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/feature-dispatch-lease.js')>();
  return {
    ...actual,
    acquireFeatureDispatchLease: async (...args: Parameters<typeof actual.acquireFeatureDispatchLease>) => {
      seams.acquire(...args);
      return actual.acquireFeatureDispatchLease(...args);
    },
  };
});

vi.mock('../../src/engine/park-marker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/park-marker.js')>();
  return {
    ...actual,
    isOperatorParked: async (...args: Parameters<typeof actual.isOperatorParked>) => {
      seams.parked(...args);
      return actual.isOperatorParked(...args);
    },
  };
});

import type { BacklogItem } from '../../src/engine/daemon.js';
import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';

const ITEM: BacklogItem = { slug: 'stacked' };
const roots: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runnerDeps(root: string, runConductor = vi.fn()): Omit<FeatureRunnerDeps, 'dispatchAdmission'> {
  return {
    createWorktree: async (slug) => ({ path: join(root, '.worktrees', slug), branch: `feat/${slug}` }),
    runConductor,
    readOutcome: async () => ({ done: false, halted: true, reason: 'halted for test' }),
    teardownWorktree: async () => {},
    markProcessed: async () => {},
    daemon: true,
    project: 'repo',
    projectRoot: root,
  };
}

async function durableChildRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-runner-dispatch-admission-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'children', 'c1'), { recursive: true });
  return root;
}

// @ts-expect-error dispatch admission is required at every feature-runner composition boundary.
const missingDispatchAdmission: FeatureRunnerDeps = {
  createWorktree: async (slug) => ({ path: `/repo/.worktrees/${slug}`, branch: `feat/${slug}` }),
  runConductor: async () => {},
  readOutcome: async () => ({ done: false, halted: false }),
  teardownWorktree: async () => {},
  markProcessed: async () => {},
  daemon: true,
  project: 'repo',
  projectRoot: '/repo',
};
void missingDispatchAdmission;

describe('engine/daemon-runner dispatch admission', () => {
  it('acquires and parks when another live holder owns a durable child dispatch', async () => {
    const root = await durableChildRoot();
    const held = await acquireFeatureDispatchLease(root, ITEM.slug, 'other dispatcher');
    if (held.kind !== 'acquired') throw new Error('test could not acquire lease');
    seams.acquire.mockClear();

    try {
      await expect(makeRunFeature({ ...runnerDeps(root), dispatchAdmission: 'acquire' })(ITEM)).resolves.toEqual({
        slug: ITEM.slug,
        status: 'parked',
        reason: 'feature-lease-held',
      });
      expect(seams.acquire).toHaveBeenCalledWith(root, ITEM.slug, 'daemon dispatch');
    } finally {
      await held.lease.release();
    }
  });

  it('runs an admitted durable child dispatch while its caller holds the lease', async () => {
    const root = await durableChildRoot();
    const held = await acquireFeatureDispatchLease(root, ITEM.slug, 'child admission');
    if (held.kind !== 'acquired') throw new Error('test could not acquire lease');
    const runConductor = vi.fn();
    seams.acquire.mockClear();
    seams.parked.mockClear();

    try {
      await expect(makeRunFeature({ ...runnerDeps(root, runConductor), dispatchAdmission: 'admitted' })(ITEM)).resolves.toMatchObject({
        slug: ITEM.slug,
        status: 'halted',
      });
      expect(runConductor).toHaveBeenCalledTimes(1);
      expect(seams.acquire).not.toHaveBeenCalled();
      expect(seams.parked).not.toHaveBeenCalled();
    } finally {
      await held.lease.release();
    }
  });
});
