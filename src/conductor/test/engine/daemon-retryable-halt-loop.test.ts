// Covers: task:7, task:11
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemon, type BacklogItem } from '../../src/engine/daemon.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';
import { buildProgressReKickDeps, buildRetryableHaltDeps } from '../../src/daemon-cli.js';

const slug = 'retryable-loop';
const item: BacklogItem = { slug };

describe('retryable HALT daemon loop', () => {
  it('bounds identical and volatile mechanical stops using the production filesystem predicates', async () => {
    const base = await mkdtemp(join(tmpdir(), 'daemon-retryable-loop-'));
    let clock = 0;
    try {
      const pipeline = join(base, slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      const logs: string[] = [];
      const retryable = buildRetryableHaltDeps(base, undefined);
      const progress = buildProgressReKickDeps({ build_progress_halt: { enabled: false, dispatch_ceiling: 4 } } as any, base);
      let dispatches = 0;

      await runDaemon({
        claims: new InMemoryWorkClaims(),
        discoverBacklog: async () => [item],
        isHalted: async () => {
          try { await import('node:fs/promises').then(({ access }) => access(join(pipeline, 'HALT'))); return true; } catch { return false; }
        },
        readHaltClass: async () => 'mechanical',
        ...retryable,
        ...progress,
        log: (line) => logs.push(line),
        runFeature: async () => {
          dispatches++;
          await writeFile(join(pipeline, 'HALT'), dispatches === 1 ? 'same mechanical halt\n' : `volatile mechanical halt ${dispatches}\n`);
          await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
          await writeFile(join(pipeline, 'task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }));
          return { slug, status: 'halted' as const };
        },
        now: () => clock,
        sleep: async () => { clock += 10_000; },
      }, { concurrency: 1, once: false, maxIdlePolls: 8, idlePollMs: 0 });

      // The initial dispatch plus at most four bounded re-kicks; the first
      // re-kick proves the real archived HALT body is consulted.
      expect(dispatches).toBeLessThanOrEqual(5);
      expect(logs.filter((line) => line.includes('dispatch ceiling (4) reached'))).toHaveLength(1);
      expect(logs.filter((line) => line.includes(`resume ${slug}`)).length).toBeLessThanOrEqual(4);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('admits an unreadable archived HALT once through the prompt path', async () => {
    const base = await mkdtemp(join(tmpdir(), 'daemon-retryable-unreadable-'));
    try {
      const pipeline = join(base, slug, '.pipeline');
      await mkdir(join(pipeline, 'HALT.rekicked'), { recursive: true });
      await writeFile(join(pipeline, 'HALT'), 'mechanical\n');
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
      const retryable = buildRetryableHaltDeps(base, undefined);
      const claims = new InMemoryWorkClaims();
      claims.park(slug);
      let dispatches = 0;
      await runDaemon({
        claims, discoverBacklog: async () => [item],
        isHalted: async () => dispatches === 0,
        readHaltClass: async () => 'mechanical', ...retryable,
        runFeature: async () => ({ slug, status: (++dispatches, 'done' as const) }),
      }, { concurrency: 1, once: true });
      expect(dispatches).toBe(1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
