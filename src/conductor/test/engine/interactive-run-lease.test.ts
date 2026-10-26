// Covers: task:rem-as-built-rem-as-built-r6
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareManagedSessionContext } from '../../src/execution/managed-session-context.js';
import { replaceCommandState } from '../../src/engine/command-state.js';
import type { FeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import {
  prepareInteractiveConductorRunWithLease,
  runInteractiveConductorWithLease,
} from '../../src/engine/interactive-run-lease.js';
import { resolveForegroundRunId } from '../../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('interactive conductor run lease', () => {
  it('takes the stacked-feature lease before the first conductor mutation despite an operator park marker', async () => {
    const calls: string[] = [];
    const release = vi.fn(async () => {
      calls.push('lease release');
      return { ok: true } as const;
    });
    const acquire = vi.fn(async () => {
      calls.push('lease acquire');
      return { kind: 'acquired' as const, lease: { release } satisfies FeatureDispatchLease };
    });
    const run = vi.fn(async () => {
      calls.push('worktree preparation');
      calls.push('conduct-state write');
    });

    const result = await runInteractiveConductorWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      run,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire,
      },
    });

    expect(result).toEqual({ kind: 'ran' });
    expect(calls).toEqual([
      'lease acquire',
      'worktree preparation',
      'conduct-state write',
      'lease release',
    ]);
    expect(acquire).toHaveBeenCalledWith('/main', 'demo', 'interactive conductor run');
    // The interactive entry has no park predicate/dependency: a present marker
    // cannot be consulted or stop its first dispatched step.
    expect(run).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('holds the stacked-feature lease before session state creation and managed-context preparation at the interactive run boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'interactive-run-lease-'));
    temporaryDirectories.push(root);
    const worktree = join(root, '.worktrees', 'demo');
    const producerRoot = join(worktree, '.pipeline', 'session-events', 'dispatch-1');

    let leaseHeld = false;
    const release = vi.fn(async () => {
      leaseHeld = false;
      return { ok: true } as const;
    });
    const acquire = vi.fn(async () => {
      leaseHeld = true;
      return { kind: 'acquired' as const, lease: { release } satisfies FeatureDispatchLease };
    });

    const acquired = await prepareInteractiveConductorRunWithLease({
      projectRoot: worktree,
      featureDesc: 'Demo',
      prepare: async () => {
        const pipelineDir = join(worktree, '.pipeline');
        await mkdir(pipelineDir, { recursive: true });
        expect(leaseHeld).toBe(true);

        const sessionId = await resolveForegroundRunId(pipelineDir);
        expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
        await replaceCommandState(join(pipelineDir, 'conduct-state.json'), 'reset conductor state');
        expect(await readFile(join(pipelineDir, 'conduct-state.json'), 'utf8')).toBe('{}\n');
        expect(leaseHeld).toBe(true);

        await mkdir(producerRoot, { recursive: true });
        const context = await prepareManagedSessionContext({
          projectRoot: root,
          worktreeRoot: worktree,
          producerRoot,
          scope: { kind: 'project' },
          dispatchId: 'dispatch-1',
          provider: 'codex',
        });
        expect(context).toMatchObject({ ok: true });
        expect(leaseHeld).toBe(true);
      },
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root }),
        acquire,
      },
    });

    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') return;
    expect(leaseHeld).toBe(true);

    await acquired.lease.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses a live lease owner before dispatching any conductor step', async () => {
    const run = vi.fn(async () => undefined);

    const result = await runInteractiveConductorWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      run,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire: async () => ({
          kind: 'live-owner',
          owner: {
            host: 'local-host',
            pid: 4321,
            processStartTime: 'current-start',
            token: 'owner-token',
            purpose: 'operator stack land',
          },
        }),
      },
    });

    expect(result).toEqual({
      kind: 'refused',
      message: 'interactive conductor run refused: feature dispatch lease is held by operator stack land (pid 4321)',
    });
    expect(run).not.toHaveBeenCalled();
  });
});
