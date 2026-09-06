import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';

describe('runDaemon — gh version floor gate', () => {
  it('blocks picks once per unchanged diagnostic and resumes after it clears', async () => {
    let blocked = true;
    const logs: string[] = [];
    const runFeature = vi.fn(async (item: BacklogItem) => ({ slug: item.slug, status: 'done' as const }));
    const deps: DaemonDeps = {
      discoverBacklog: async () => [{ slug: 'feature' }],
      runFeature,
      getGhVersionFloorDiagnostic: async () => blocked
        ? 'gh 2.14.1 cannot satisfy the required 2.73.0; upgrade gh before dispatch resumes.'
        : null,
      log: (line) => logs.push(line),
      sleep: async () => { blocked = false; },
    };

    const result = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 3 });

    expect(runFeature).toHaveBeenCalledOnce();
    expect(result.processed).toHaveLength(1);
    expect(logs.filter((line) => line.includes('gh 2.14.1'))).toHaveLength(1);
  });
});
