// Covers: task:27
import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const workOrder: WorkOrder = {
  repository: 'owner/repo',
  slug: 'claimed-feature',
  baseSha: 'base-sha',
  engineVersionId: '20261107T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'],
  schemaVersion: 1,
  manifest: [],
};

const commonDeps = {
  discoverBacklog: async () => [{ slug: 'claimed-feature' }],
};

describe('engine/daemon feature-execution dependencies', () => {
  it('rejects supplying both runner and executor dependencies', () => {
    // @ts-expect-error DaemonDeps accepts exactly one feature-execution dependency.
    const deps: DaemonDeps = {
      ...commonDeps,
      runFeature: async () => ({ slug: 'claimed-feature', status: 'done' as const }),
      featureExecution: {
        createWorkOrder: async () => workOrder,
        executor: { execute: async () => ({ slug: 'claimed-feature', status: 'done' as const }) },
      },
    };

    expect(deps).toBeDefined();
  });

  it('rejects supplying neither runner nor executor dependency', () => {
    // @ts-expect-error DaemonDeps accepts exactly one feature-execution dependency.
    const deps: DaemonDeps = { ...commonDeps };

    expect(deps).toBeDefined();
  });

  it('sends the claimed item work order only to the composed executor', async () => {
    const runner = vi.fn(async () => ({ slug: 'claimed-feature', status: 'done' as const }));
    const createWorkOrder = vi.fn(async () => workOrder);
    const execute = vi.fn(async (order: WorkOrder) => ({ slug: order.slug, status: 'done' as const }));

    await runDaemon(
      {
        ...commonDeps,
        featureExecution: { createWorkOrder, executor: { execute } },
      },
      { concurrency: 1, once: true },
    );

    expect(createWorkOrder).toHaveBeenCalledWith({ slug: 'claimed-feature' });
    expect(execute).toHaveBeenCalledWith(workOrder);
    expect(runner).not.toHaveBeenCalled();
  });
});
