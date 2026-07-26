import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintLiveBoundary, verifyLiveBoundary } from '../../../src/engine/self-host/live-boundary.js';

describe('live self-host boundary', () => {
  it('accepts a feature-worktree mutation while live checkout and unrelated provider state remain identical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-'));
    const live = join(root, 'live'); const worktree = join(root, 'worktree'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(worktree), mkdir(provider)]);
    await writeFile(join(live, 'sentinel'), 'live'); await writeFile(join(provider, 'preferences'), 'unchanged');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(worktree, 'feature-change'), 'allowed');
    try { expect(await verifyLiveBoundary(baseline)).toEqual({ ok: true }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects terminal success when either live surface drifts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-boundary-drift-'));
    const live = join(root, 'live'); const provider = join(root, 'provider');
    await Promise.all([mkdir(live), mkdir(provider)]);
    await writeFile(join(live, 'sentinel'), 'before'); await writeFile(join(provider, 'preferences'), 'before');
    const baseline = await fingerprintLiveBoundary({ liveCheckout: live, unrelatedProviderState: provider });
    await writeFile(join(live, 'sentinel'), 'after');
    try { expect(await verifyLiveBoundary(baseline)).toMatchObject({ ok: false }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
});
