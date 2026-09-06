// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';
import type { FeatureExecutor } from '../../src/engine/feature-executor.js';
import type { WorkClaims } from '../../src/engine/work-claims.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SRC = join(__dirname, '../../src/engine/daemon.ts');

const item: BacklogItem = {
  slug: 'parked-claim',
};

describe('Task 5 — park guard covers the claim path', () => {
  it('enumerates the sole claim path and refuses a post-selection park before executor work starts', async () => {
    const source = await readFile(DAEMON_SRC, 'utf-8');
    const dispatch = source.match(
      /const dispatch = async \(item: BacklogItem\): Promise<boolean> => \{[\s\S]*?\n  \};/,
    )?.[0];
    const guardedDispatch = source.match(
      /const guardedDispatch = \(item: BacklogItem\): Promise<boolean> =>\n    guardedDispatchWith\(item, deps\.isParked, dispatch, log\);/,
    )?.[0];

    const claimPaths = [...source.matchAll(/claims\.claim\(item\.slug\)/g)];
    expect({
      guarded: guardedDispatch?.includes('deps.isParked, dispatch, log'),
      paths: claimPaths.map((path) => ({
        name: 'claim-and-dispatch',
        containedByDispatch: (path.index ?? -1) >= source.indexOf(dispatch!),
      })),
    }).toEqual({
      guarded: true,
      paths: [{ name: 'claim-and-dispatch', containedByDispatch: true }],
    });

    const claims: WorkClaims = {
      claim: vi.fn(() => true),
      release: vi.fn(),
      list: vi.fn(() => []),
      complete: vi.fn(),
      isCompleted: vi.fn(() => false),
      park: vi.fn(),
      unpark: vi.fn(),
      isParked: vi.fn(() => false),
      listParked: vi.fn(() => []),
    };
    const createWorkOrder = vi.fn(async (): Promise<WorkOrder> => ({
      repository: 'test/repository',
      slug: item.slug,
      baseSha: 'deadbeef',
      manifest: [],
    }));
    const executor: FeatureExecutor = {
      execute: vi.fn(async () => ({ slug: item.slug, status: 'done' as const })),
    };
    let parkChecks = 0;

    await runDaemon(
      {
        claims,
        discoverBacklog: async () => [item],
        isParked: async () => ++parkChecks > 1,
        runFeature: vi.fn(),
        featureExecution: { createWorkOrder, executor },
      } as DaemonDeps,
      { concurrency: 1, once: true },
    );

    expect({
      parkChecks,
      claimCalls: vi.mocked(claims.claim).mock.calls.length,
      workOrderBuilds: createWorkOrder.mock.calls.length,
      executorStarts: vi.mocked(executor.execute).mock.calls.length,
    }).toEqual({ parkChecks: 2, claimCalls: 0, workOrderBuilds: 0, executorStarts: 0 });
  });
});
