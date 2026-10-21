// Covers: task:21
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDaemonMode } from '../../src/daemon-cli.js';
import { runDaemon } from '../../src/engine/daemon.js';
import type { DaemonDeps } from '../../src/engine/daemon.js';
import type { FeatureExecutor, FeatureExecutionOutcome } from '../../src/engine/feature-executor.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const seams = vi.hoisted(() => ({
  childFactory: vi.fn(),
  inProcessFactory: vi.fn(),
  sweepExecutorRecordsOnBoot: vi.fn(),
}));

vi.mock('../../src/engine/child-feature-executor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/child-feature-executor.js')>(),
  createChildProcessFeatureExecutor: seams.childFactory,
}));

vi.mock('../../src/engine/feature-executor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/feature-executor.js')>(),
  createInProcessFeatureExecutor: seams.inProcessFactory,
}));

vi.mock('../../src/engine/executor-records.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/executor-records.js')>(),
  sweepExecutorRecordsOnBoot: seams.sweepExecutorRecordsOnBoot,
}));

const workDirs: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function executor(): FeatureExecutor & { stopAll(): Promise<void> } {
  return {
    execute: vi.fn(async (order: WorkOrder) => ({ slug: order.slug, status: 'done' as const })),
    stopAll: vi.fn(async () => {}),
  };
}

async function project(config?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-executor-wiring-'));
  workDirs.push(root);
  if (config !== undefined) {
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), config, 'utf8');
  }
  return root;
}

function workOrder(slug: string): WorkOrder {
  return {
    repository: 'owner/repo',
    slug,
    baseSha: 'base-sha',
    engineVersionId: '20261019T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'],
    schemaVersion: 1,
    manifest: [],
  };
}

beforeEach(() => {
  seams.childFactory.mockReset();
  seams.inProcessFactory.mockReset();
  seams.sweepExecutorRecordsOnBoot.mockReset().mockResolvedValue(undefined);
  vi.spyOn(process, 'once').mockImplementation((() => process) as typeof process.once);
  vi.spyOn(process, 'on').mockImplementation((() => process) as typeof process.on);
});

afterEach(async () => {
  vi.restoreAllMocks();
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('daemon executor-isolation composition', () => {
  it('defaults to the child adapter, composes its broker, and sweeps records before runDaemon can claim', async () => {
    const root = await project();
    const child = executor();
    const inProcess = executor();
    seams.childFactory.mockReturnValue(child);
    seams.inProcessFactory.mockReturnValue(inProcess);
    const calls: string[] = [];
    seams.sweepExecutorRecordsOnBoot.mockImplementation(async () => { calls.push('sweep'); });
    const daemon = await import('../../src/engine/daemon.js');
    vi.spyOn(daemon, 'runDaemon').mockImplementation(async (deps) => {
      calls.push('runDaemon');
      expect(deps.featureExecution?.executor).toBe(child);
      return { processed: [], stoppedReason: 'backlog_drained' };
    });

    await runDaemonMode({
      projectRoot: root,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      workSource: { discover: async () => [] },
      watch: false,
    });

    expect(calls).toEqual(['sweep', 'runDaemon']);
    expect(seams.childFactory).toHaveBeenCalledOnce();
    expect(seams.childFactory.mock.calls[0]?.[0]).toMatchObject({
      projectRoot: root,
      attachBroker: expect.any(Function),
    });
  });

  it('keeps the legacy adapter as an explicit rollback and reports disabled pinning', async () => {
    const root = await project('executor_isolation: in-process\n');
    const child = executor();
    const inProcess = executor();
    seams.childFactory.mockReturnValue(child);
    seams.inProcessFactory.mockReturnValue(inProcess);
    const logs: string[] = [];
    console.log = vi.fn((...args: unknown[]) => logs.push(args.join(' ')));
    const daemon = await import('../../src/engine/daemon.js');
    vi.spyOn(daemon, 'runDaemon').mockImplementation(async (deps) => {
      expect(deps.featureExecution?.executor).toBe(inProcess);
      return { processed: [], stoppedReason: 'backlog_drained' };
    });

    await runDaemonMode({
      projectRoot: root,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      workSource: { discover: async () => [] },
      watch: false,
    });

    expect(logs.join('\n')).toContain('executor isolation: in-process; per-dispatch engine pinning is disabled');
  });

  it('collects a child terminal outcome and applies its root effects only after releasing the claim', async () => {
    const claims = new InMemoryWorkClaims();
    const observations: Array<{ active: readonly string[]; outcome: FeatureExecutionOutcome }> = [];
    const child: FeatureExecutor = {
      execute: vi.fn(async (order) => ({
        slug: order.slug,
        status: 'done' as const,
        terminalEffects: {
          markProcessed: { prUrl: 'https://example.test/pr/1' },
          enrollWatch: { prUrl: 'https://example.test/pr/1' },
        },
      })),
    };
    const deps: DaemonDeps = {
      claims,
      discoverBacklog: async () => [{ slug: 'child-feature' }],
      runFeature: async () => {
        throw new Error('the child executor owns this dispatch');
      },
      featureExecution: {
        createWorkOrder: async (item) => workOrder(item.slug),
        executor: child,
      },
      onFeatureTerminalEffects: async (outcome) => {
        observations.push({ active: claims.list(), outcome });
      },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true, idlePollMs: 0 });

    expect(child.execute).toHaveBeenCalledWith(workOrder('child-feature'));
    expect(observations).toEqual([{ active: [], outcome: result.processed[0] }]);
    expect(result.processed[0]?.terminalEffects).toEqual({
      markProcessed: { prUrl: 'https://example.test/pr/1' },
      enrollWatch: { prUrl: 'https://example.test/pr/1' },
    });
  });
});
