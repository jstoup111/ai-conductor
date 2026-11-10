// Covers: task:2, task:31
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({
  selfHost: false,
  harnessRoot: '/engine-harness',
  worktreePath: '',
  options: [] as Array<{ skillNameRoot?: string | null }>,
}));

vi.mock('../../src/engine/self-host/detector.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/self-host/detector.js')>()),
  defaultSelfHostDetector: vi.fn(() => ({})),
  classifySelfHost: vi.fn(async () => fixture.selfHost),
}));
vi.mock('../../src/engine/install-freshness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/install-freshness.js')>()),
  resolveHarnessRoot: vi.fn(async () => fixture.harnessRoot),
}));
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-token' })),
}));
vi.mock('../../src/engine/daemon-deps.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/daemon-deps.js')>()),
  resolveDaemonBaseSha: vi.fn(async () => 'a'.repeat(40)),
}));
vi.mock('../../src/engine/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/config.js')>()),
  loadMergedConfig: vi.fn(async () => ({ ok: true as const, config: { llm_provider: 'codex' }, warnings: [] })),
}));
vi.mock('../../src/engine/provider-discovery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/provider-discovery.js')>()),
  discoverInstalledProviders: vi.fn(async () => ({ installed: ['codex'], missing: [] })),
}));
vi.mock('../../src/engine/provider-model-probe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/provider-model-probe.js')>()),
  validateConfiguredProviderModels: vi.fn(async () => {}),
  resolveProviderModelTiers: vi.fn(async () => {}),
}));
vi.mock('../../src/engine/work-order.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/work-order.js')>()),
  buildWorkOrder: vi.fn((input) => ({
    ...input,
    engineVersionId: input.enginePin.engineVersionId,
    schemaVersion: 1,
    manifest: [],
  })),
}));
vi.mock('../../src/engine/step-runners.js', () => ({
  DefaultStepRunner: class {
    constructor(_provider: unknown, _session: string, _project: string, options: { skillNameRoot?: string | null }) {
      fixture.options.push(options);
    }
  },
}));
vi.mock('../../src/engine/conductor.js', () => ({
  Conductor: class { async run() {} },
}));
vi.mock('../../src/engine/daemon-runner.js', async (importOriginal) => ({
  // The supervisor's child executor classifies each dispatch with the real
  // daemon-runner helpers; only the one-feature runner is bounded here.
  ...(await importOriginal<typeof import('../../src/engine/daemon-runner.js')>()),
  makeRunFeature: (deps: { beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<{ providerExecution: unknown; events: unknown; stop: () => Promise<void>; sessionId?: string }>; runConductor: (worktree: { path: string; branch: string }, item: { slug: string }, providerExecution: unknown, events: unknown, log: undefined, sessionId: string | undefined) => Promise<void> }) => async (item: { slug: string }) => {
    const worktree = { path: fixture.worktreePath, branch: `feat/${item.slug}` };
    const scope = await deps.beginFeatureRun(worktree, item);
    await deps.runConductor(worktree, item, scope.providerExecution, scope.events, undefined, scope.sessionId);
    await scope.stop();
    return { slug: item.slug, status: 'completed' as const };
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';

const roots: string[] = [];
afterEach(async () => {
  fixture.options.splice(0);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function dispatch(selfHost: boolean): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-skill-name-root-'));
  roots.push(projectRoot);
  fixture.selfHost = selfHost;
  fixture.worktreePath = join(projectRoot, '.worktrees', 'feature');
  await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true });
  await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  const store = await useTempEngineStore();
  try {
    await runDaemonMode({
      projectRoot,
      engineRoot: store.engineRoot,
      concurrency: 1,
      maxItems: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      watch: false,
      workSource: { discover: async () => [{ slug: 'feature' }] },
      executorFork: createInMemoryExecutorFork({
        projectRoot,
        createWorktree: async () => ({ path: fixture.worktreePath }),
      }),
    });
  } finally {
    await store.teardown();
  }
}

describe('daemon skill-name root wiring', () => {
  it('passes the feature worktree to a self-host runner', async () => {
    await dispatch(true);
    expect(fixture.options.map(({ skillNameRoot }) => skillNameRoot)).toContain(fixture.worktreePath);
  });

  it('passes the engine harness root to a non-self-host runner', async () => {
    await dispatch(false);
    expect(fixture.options.map(({ skillNameRoot }) => skillNameRoot)).toContain(fixture.harnessRoot);
  });
});
