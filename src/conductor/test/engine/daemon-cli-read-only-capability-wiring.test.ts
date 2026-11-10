import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { runDaemonMode } from '../../src/daemon-cli.js';
import type { ReadOnlyReviewCapability } from '../../src/engine/build-review-read-only-capability.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as daemonCore from '../../src/engine/daemon.js';
import * as daemonLock from '../../src/engine/daemon-lock.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';

const seams = vi.hoisted(() => ({
  prepareWorktree: vi.fn(),
}));

vi.mock('../../src/engine/worktree-prepare.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/worktree-prepare.js')>();
  return { ...actual, prepareWorktree: seams.prepareWorktree };
});

vi.mock('../../src/engine/provider-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-discovery.js')>();
  return {
    ...actual,
    discoverInstalledProviders: async () => ({ installed: ['claude', 'codex', 'pi'], missing: [] }),
  };
});

vi.mock('../../src/engine/provider-model-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-model-probe.js')>();
  return {
    ...actual,
    validateConfiguredProviderModels: async () => {},
    resolveProviderModelTiers: async () => {},
  };
});

const roots: string[] = [];
const testTmpdir = (): string => process.env.TMPDIR ?? '/tmp';
afterEach(async () => {
  vi.restoreAllMocks();
  seams.prepareWorktree.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startWithCustomRubric(
  provider: 'codex' | 'claude',
  capability: ReadOnlyReviewCapability,
  renderEvents = false,
) {
  const projectRoot = await mkdtemp(join(testTmpdir(), 'daemon-read-only-capability-'));
  roots.push(projectRoot);
  await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), [
    'auto_restart_on_stale_engine: false', 'build_review:', '  custom_rubrics:', '    read_only:',
    '      enabled: true', '      skill: security-review', '      question: Review the change', `      llm_provider: ${provider}`,
  ].join('\n'));

  const order: string[] = [];
  const events: unknown[] = [];
  vi.spyOn(daemonLock, 'holdLock').mockResolvedValue({
    pid: process.pid, uuid: 'read-only-capability', owned: true, release: async () => {}, releaseSync: () => {},
  });
  if (renderEvents) {
    const emit = ConductorEventEmitter.prototype.emit;
    vi.spyOn(ConductorEventEmitter.prototype, 'emit').mockImplementation(async function (this: ConductorEventEmitter, event) {
      events.push(event);
      await emit.call(this, event);
    });
  } else {
    vi.spyOn(ConductorEventEmitter.prototype, 'emit').mockImplementation(async (event) => { events.push(event); });
  }
  vi.spyOn(daemonCore, 'runDaemon').mockImplementation(async () => {
    order.push('dispatch');
    return { processed: [], stoppedReason: 'backlog_drained' };
  });
  const probe = vi.fn(async () => {
    order.push('probe');
    return capability;
  });

  await runDaemonMode({
    projectRoot, concurrency: 1, baseBranch: 'main', ensureFresh: async () => {},
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
    probeReadOnlyReviewCapability: probe,
    runHaltClassMigration: async () => join(projectRoot, '.worktrees'), watch: false,
    executorFork: createInMemoryExecutorFork({ projectRoot }),
  });
  return { events, order, probe };
}

describe('Task 10 — daemon read-only review capability wiring', () => {
  it.each(['codex', 'claude'] as const)('emits enabled %s capability before dispatch', async (provider) => {
    const { events, order, probe } = await startWithCustomRubric(provider, {
      provider, platform: process.platform, status: 'available',
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'build_review_read_only_capability', provider, platform: process.platform, status: 'available',
    });
    expect(order).toEqual(['probe', 'dispatch']);
  });

  it('records unavailable Codex with its platform and reason, then still dispatches', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => { logs.push(line); });
    const { events, order } = await startWithCustomRubric('codex', {
      provider: 'codex', platform: process.platform, status: 'unavailable', reason: 'sandbox helper could not start',
    }, true);

    expect(events).toContainEqual({
      type: 'build_review_read_only_capability',
      provider: 'codex', platform: process.platform, status: 'unavailable', reason: 'sandbox helper could not start',
    });
    expect(order).toEqual(['probe', 'dispatch']);
    expect(logs.join('\n')).toContain('build_review read-only capability unavailable: codex on');
    expect(logs.join('\n')).toContain('sandbox helper could not start');
  });

  it('does not spawn a probe or emit a capability event without an enabled custom rubric', async () => {
    const projectRoot = await mkdtemp(join(testTmpdir(), 'daemon-no-read-only-capability-'));
    roots.push(projectRoot);
    const events: unknown[] = [];
    vi.spyOn(daemonLock, 'holdLock').mockResolvedValue({
      pid: process.pid, uuid: 'no-read-only-capability', owned: true, release: async () => {}, releaseSync: () => {},
    });
    vi.spyOn(ConductorEventEmitter.prototype, 'emit').mockImplementation(async (event) => { events.push(event); });
    vi.spyOn(daemonCore, 'runDaemon').mockResolvedValue({ processed: [], stoppedReason: 'backlog_drained' });
    const probe = vi.fn();

    await runDaemonMode({
      projectRoot, concurrency: 1, baseBranch: 'main', ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      probeReadOnlyReviewCapability: probe,
      runHaltClassMigration: async () => join(projectRoot, '.worktrees'), watch: false,
      executorFork: createInMemoryExecutorFork({ projectRoot }),
    });

    expect(probe).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'build_review_read_only_capability' }));
  });

  it('threads the frozen startup snapshot to an ordinary non-self-host build_review dispatch', async () => {
    const projectRoot = await mkdtemp(join(testTmpdir(), 'ordinary-read-only-capability-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), [
      'auto_restart_on_stale_engine: false', 'llm_provider: codex', 'build_review:', '  custom_rubrics:', '    read_only:',
      '      enabled: true', '      skill: security-review', '      question: Review the change', '      llm_provider: codex',
    ].join('\n'));
    await mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    await writeFile(join(projectRoot, '.docs', 'stories', 'ordinary-read-only-review.md'), '# Story\n');
    await writeFile(join(projectRoot, '.docs', 'plans', 'ordinary-read-only-review.md'), '# Plan\n');
    await writeFile(join(projectRoot, 'README.md'), 'fixture\n');
    await initTestRepo(projectRoot);
    await commitAll(projectRoot, 'fixture');
    const baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim();
    const capability: ReadOnlyReviewCapability = {
      provider: 'codex', platform: process.platform, status: 'available',
    };
    let observed: Readonly<Record<string, ReadOnlyReviewCapability>> | undefined;
    vi.spyOn(Conductor.prototype, 'run').mockImplementation(async function (this: Conductor) {
      observed = (this as unknown as {
        readOnlyReviewCapabilities?: Readonly<Record<string, ReadOnlyReviewCapability>>;
      }).readOnlyReviewCapabilities;
    });
    seams.prepareWorktree.mockResolvedValue(undefined);
    const store = await useTempEngineStore();
    try {
      await runDaemonMode({
        projectRoot, concurrency: 1, maxItems: 1, baseBranch: 'main', engineRoot: store.engineRoot,
        ensureFresh: async () => {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
        probeReadOnlyReviewCapability: async () => capability,
        workSource: { discover: async () => [{ slug: 'ordinary-read-only-review', baseSha }] },
        runHaltClassMigration: async () => join(projectRoot, '.worktrees'), watch: false,
        executorFork: createInMemoryExecutorFork({ projectRoot }),
      });
    } finally {
      await store.teardown();
    }

    expect(observed).toEqual({ codex: capability });
    expect(Object.isFrozen(observed)).toBe(true);
  });
});
