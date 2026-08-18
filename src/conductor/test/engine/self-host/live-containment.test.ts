import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as liveContainment from '../../../src/engine/self-host/live-containment.js';
import { LIVE_CHECKOUT_VOLATILE } from '../../../src/engine/self-host/live-boundary.js';
import type { ContainmentVerdict } from '../../../src/engine/self-host/live-containment.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createCheckout(): Promise<{ liveCheckout: string; worktreeRoot: string }> {
  const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-'));
  temporaryDirectories.push(liveCheckout);
  const worktreeRoot = join(liveCheckout, '.worktrees', 'build');
  await mkdir(worktreeRoot, { recursive: true });
  return { liveCheckout, worktreeRoot };
}

function deriveBindSet(liveCheckout: string, worktreeRoot: string): readonly string[] {
  const candidate: unknown = Reflect.get(liveContainment, 'deriveBindSet');
  if (typeof candidate !== 'function') throw new Error('deriveBindSet is not available');
  return (candidate as (live: string, worktree: string) => readonly string[])(liveCheckout, worktreeRoot);
}

describe('ContainmentVerdict', () => {
  it('narrows evidence and reason by containment', () => {
    const contained: ContainmentVerdict = { contained: true, evidence: 'bubblewrap enforced' };
    const unavailable: ContainmentVerdict = { contained: false, reason: 'bubblewrap unavailable' };

    const invalidContained: ContainmentVerdict = {
      contained: true,
      evidence: 'bubblewrap enforced',
      // @ts-expect-error A contained verdict cannot carry failure-only detail.
      reason: 'bubblewrap unavailable',
    };
    const invalidUnavailable: ContainmentVerdict = {
      contained: false,
      // @ts-expect-error An unavailable verdict cannot carry containment-only detail.
      evidence: 'bubblewrap enforced',
      reason: 'bubblewrap unavailable',
    };

    const detail = (verdict: ContainmentVerdict): string => {
      if (verdict.contained) return verdict.evidence;
      return verdict.reason;
    };

    void invalidContained;
    void invalidUnavailable;

    expect([detail(contained), detail(unavailable)]).toEqual([
      'bubblewrap enforced',
      'bubblewrap unavailable',
    ]);
  });
});

describe('deriveBindSet', () => {
  it('binds the host, live checkout, existing guard carve-outs, and node_modules in bwrap order', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    await Promise.all([
      ...LIVE_CHECKOUT_VOLATILE
        .filter((path) => path !== 'src/conductor/dist-versions')
        .map((path) => mkdir(join(liveCheckout, path), { recursive: true })),
      mkdir(join(liveCheckout, 'node_modules'), { recursive: true }),
      mkdir(join(liveCheckout, 'src', 'conductor', 'node_modules'), { recursive: true }),
    ]);

    const bindSet = deriveBindSet(liveCheckout, worktreeRoot);
    const readOnlyLiveRoot = ['--ro-bind', liveCheckout, liveCheckout];
    const expectedReadWritePaths = [
      ...LIVE_CHECKOUT_VOLATILE
        .filter((path) => path !== 'src/conductor/dist-versions')
        .map((path) => join(liveCheckout, path)),
      join(liveCheckout, 'node_modules'),
      join(liveCheckout, 'src', 'conductor', 'node_modules'),
    ];

    expect(bindSet).toEqual([
      '--dev-bind', '/', '/',
      ...readOnlyLiveRoot,
      ...expectedReadWritePaths.flatMap((path) => ['--bind', path, path]),
    ]);
  });

  it('omits guard carve-outs that are absent from this checkout', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();

    expect(deriveBindSet(liveCheckout, worktreeRoot)).not.toContain(join(liveCheckout, '.pipeline'));
  });

  it('does not discover node_modules below pruned volatile directories', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const discovered = join(liveCheckout, 'packages', 'widget', 'node_modules');
    const pruned = [
      join(liveCheckout, 'node_modules', 'nested', 'node_modules'),
      join(liveCheckout, '.git', 'objects', 'node_modules'),
      join(liveCheckout, '.worktrees', 'other', 'node_modules'),
    ];
    await Promise.all([
      mkdir(discovered, { recursive: true }),
      ...pruned.map((path) => mkdir(path, { recursive: true })),
    ]);

    const bindSet = deriveBindSet(liveCheckout, worktreeRoot);

    expect(bindSet).toEqual(expect.arrayContaining([
      '--bind', discovered, discovered,
    ]));
    for (const path of pruned) expect(bindSet).not.toContain(path);
  });
});
