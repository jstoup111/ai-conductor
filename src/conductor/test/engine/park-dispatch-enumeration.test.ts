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
import type { WorkClaims } from '../../src/engine/work-claims.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SRC = join(__dirname, '../../src/engine/daemon.ts');

const item: BacklogItem = {
  slug: 'parked-claim',
};

describe('Task 5 — park guard covers the claim path', () => {
  it('derives the claim path as a guarded dispatch entry point', async () => {
    const source = await readFile(DAEMON_SRC, 'utf-8');
    const dispatch = source.match(
      /const dispatch = async \(item: BacklogItem\): Promise<boolean> => \{[\s\S]*?\n  \};/,
    )?.[0];
    const guardedDispatch = source.match(
      /const guardedDispatch = \(item: BacklogItem\): Promise<boolean> =>\n    guardedDispatchWith\(item, deps\.isParked, dispatch, log\);/,
    )?.[0];

    const claimIndex = dispatch!.indexOf('claims.claim(item.slug)');
    const dispatchIndex = dispatch!.indexOf('.runFeature(item)');
    expect({
      guarded: guardedDispatch?.includes('deps.isParked, dispatch, log'),
      paths: [{
        name: 'claim-and-dispatch',
        claimPrecedesDispatch: claimIndex > -1 && dispatchIndex > claimIndex,
      }],
    }).toEqual({
      guarded: true,
      paths: [{ name: 'claim-and-dispatch', claimPrecedesDispatch: true }],
    });
  });

  it('refuses a slug parked after selection before claiming or dispatching it', async () => {
    const claims: WorkClaims = {
      claim: vi.fn(() => true),
      release: vi.fn(),
      list: vi.fn(() => []),
    };
    const runFeature = vi.fn(async () => ({ slug: item.slug, status: 'done' as const }));
    let parkChecks = 0;

    await runDaemon(
      {
        claims,
        discoverBacklog: async () => [item],
        isParked: async () => ++parkChecks > 1,
        runFeature,
      } as DaemonDeps,
      { concurrency: 1, once: true },
    );

    expect({
      parkChecks,
      claimCalls: vi.mocked(claims.claim).mock.calls.length,
      worktreeStarts: runFeature.mock.calls.length,
    }).toEqual({ parkChecks: 2, claimCalls: 0, worktreeStarts: 0 });
  });
});
