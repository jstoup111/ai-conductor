// Covers: task:4, task:7
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seams = vi.hoisted(() => ({
  executions: [] as Array<{ engineVersionId: string; baseBranch?: string }>,
}));

vi.mock('../../src/engine/child-feature-executor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/child-feature-executor.js')>(),
  createChildProcessFeatureExecutor: vi.fn(() => ({
    execute: async (order: { slug: string; engineVersionId: string }) => {
      seams.executions.push(order);
      return { slug: order.slug, status: 'done' as const };
    },
    stopAll: async () => {},
  })),
}));

vi.mock('../../src/engine/work-order.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/work-order.js')>(),
  buildWorkOrder: vi.fn(async (input) => ({
    schemaVersion: 1,
    repository: input.repository,
    slug: input.slug,
    baseSha: input.baseSha,
    ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
    engineVersionId: input.enginePin.engineVersionId,
    manifest: [],
  })),
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import {
  ENGINE_STORE_ENV_VAR,
  TEMP_ENGINE_VERSION_ID,
  useTempEngineStore,
} from '../fixtures/in-memory-executor-fork.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  seams.executions.splice(0);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runDaemonMode engineRoot', () => {
  it('pins a dispatched work order from the supplied engine root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-engine-root-option-'));
    roots.push(projectRoot);
    const store = await useTempEngineStore();

    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        maxItems: 1,
        baseBranch: 'main',
        engineRoot: store.engineRoot,
        ensureFresh: async () => {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
        workSource: { discover: async () => [{ slug: 'feature', baseSha: 'a'.repeat(40) }] },
        watch: false,
      });
    } finally {
      await store.teardown();
    }

    expect(seams.executions).toEqual([
      expect.objectContaining({ engineVersionId: TEMP_ENGINE_VERSION_ID }),
    ]);
  });

  it('carries the configured daemon base branch into the work order', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-work-order-base-branch-'));
    roots.push(projectRoot);
    const store = await useTempEngineStore();

    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        maxItems: 1,
        baseBranch: 'trunk',
        engineRoot: store.engineRoot,
        ensureFresh: async () => {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
        workSource: { discover: async () => [{ slug: 'feature', baseSha: 'a'.repeat(40) }] },
        watch: false,
      });
    } finally {
      await store.teardown();
    }

    expect(seams.executions).toEqual([
      expect.objectContaining({ baseBranch: 'trunk' }),
    ]);
  });

  it('restores the engine-store environment override on teardown', async () => {
    const prior = process.env[ENGINE_STORE_ENV_VAR];
    const store = await useTempEngineStore();

    try {
      expect(process.env[ENGINE_STORE_ENV_VAR]).not.toBe(prior);
    } finally {
      await store.teardown();
    }

    expect(process.env[ENGINE_STORE_ENV_VAR]).toBe(prior);
  });
});
