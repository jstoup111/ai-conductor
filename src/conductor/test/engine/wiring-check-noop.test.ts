import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CUSTOM_COMPLETION_PREDICATES,
  WIRING_EVIDENCE,
  type WiringEvidence,
} from '../../src/engine/artifacts.js';

const predicate = CUSTOM_COMPLETION_PREDICATES.wiring_check!;

async function withFixture(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wiring-check-noop-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function staleEvidence(): WiringEvidence {
  return {
    schema: 1,
    base: 'base123',
    head: 'old-head',
    layer2: { applicable: true },
    waivers: [],
    tasks: [{ id: '1', contract: 'src/x.ts#entry', gaps: [] }],
  };
}

describe('wiring_check — deprecated no-op completion predicate', () => {
  it('reports done when the fixture contains no plan', async () => {
    await withFixture(async (dir) => {
      const result = await predicate(dir, {});

      expect(result).toEqual({ done: true });
    });
  });

  it('reports done without probing an undeterminable diff base', async () => {
    await withFixture(async (dir) => {
      let probeCalls = 0;

      const result = await predicate(dir, {
        getHeadSha: async () => 'head456',
        wiringProbe: async () => {
          probeCalls++;
          throw new Error('diff base is undeterminable');
        },
      });

      expect(result).toEqual({ done: true });
      expect(probeCalls).toBe(0);
    });
  });

  it('reports done when .pipeline is unreadable', async () => {
    await withFixture(async (dir) => {
      await writeFile(join(dir, '.pipeline'), 'not a directory', 'utf-8');

      const result = await predicate(dir, {});

      expect(result).toEqual({ done: true });
    });
  });

  it('reports done without reading stale wiring evidence', async () => {
    await withFixture(async (dir) => {
      await mkdir(join(dir, '.pipeline'));
      await writeFile(
        join(dir, WIRING_EVIDENCE),
        JSON.stringify(staleEvidence()),
        'utf-8',
      );
      let headReads = 0;

      const result = await predicate(dir, {
        getHeadSha: async () => {
          headReads++;
          return 'current-head';
        },
      });

      expect(result).toEqual({ done: true });
      expect(headReads).toBe(0);
    });
  });
});
