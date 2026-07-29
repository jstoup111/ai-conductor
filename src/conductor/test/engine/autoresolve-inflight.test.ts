/**
 * Acceptance (RED) specs for the process-wide in-flight serial guard across
 * ticks (story: "worktree story negative path — no second resolution while
 * one runs", .docs/stories/auto-resolve-open-pr-conflicts.md; plan Task 18).
 *
 * The per-slug guard inside `withResolveWorktree` (tested in
 * test/integration/autoresolve-worktree-lifecycle.test.ts) only rejects a
 * SECOND concurrent call for the SAME slug. This story requires that while
 * ANY resolution is in flight (e.g. a long suite gate run), the NEXT sweep
 * tick starts no second resolution for ANY PR — a different slug included —
 * and logs the skip with a concrete reason (FR-16 outcome line).
 *
 * Covers: the eligibility-gate half (isEligibleForResolve rejects while a
 * resolution is in flight, regardless of slug) and the flag lifecycle half
 * (set at resolution start, cleared on both success and failure/escalation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import {
  isEligibleForResolve,
  withResolveWorktree,
  isResolutionInFlight,
} from '../../src/engine/autoresolve.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — in-flight serial guard across ticks (Task 18)', () => {
  let dir: string;
  const g = (args: string[]) => execFile('git', args, { cwd: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autoresolve-inflight-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(dir, 'README.md'), '# base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat/pr-1']);
    await writeFile(join(dir, 'feature.txt'), 'pr-1 content\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'pr-1 work']);
    await g(['checkout', '-q', 'main']);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const entryA: WatchEntry = {
    prUrl: 'https://github.com/example/repo/pull/1',
    slug: 'pr-1',
    repoCwd: '/repo',
    resolveAttempts: 0,
    lastResolveAt: undefined,
  };

  const entryB: WatchEntry = {
    prUrl: 'https://github.com/example/repo/pull/2',
    slug: 'pr-2',
    repoCwd: '/repo',
    resolveAttempts: 0,
    lastResolveAt: undefined,
  };

  const prState: PrMergeState = {
    state: 'CONFLICTING',
    mergeable: 'CONFLICTING',
    hasFailingOrPendingChecks: false,
    labels: [],
    checksOutcome: 'none',
  };

  const cfg: HarnessConfig = {
    mergeable_autoresolve: {
      enabled: true,
      cooldownMinutes: 60,
    },
  };

  const fs = {
    worktreeExists: async (_path: string): Promise<boolean> => false,
  };

  async function retainFeatureWorktree(slug: string): Promise<{
    path: string;
    pipelineMarker: string;
  }> {
    const path = join(dir, '.worktrees', slug);
    const pipelineMarker = join(path, '.pipeline', 'task-evidence');
    await g(['update-ref', `refs/remotes/origin/feat/${slug}`, `feat/${slug}`]);
    await g(['worktree', 'add', path, `feat/${slug}`]);
    await mkdir(join(path, '.pipeline'), { recursive: true });
    await writeFile(pipelineMarker, 'retained evidence\n');
    return { path, pipelineMarker };
  }

  async function pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  it('reports not in flight before any resolution starts', () => {
    expect(isResolutionInFlight()).toBe(false);
  });

  it('sets the in-flight flag for the duration of a resolution and clears it on success', async () => {
    let sawInFlightDuringRun = false;

    const result = await withResolveWorktree('pr-1', 'feat/pr-1', dir, async () => {
      sawInFlightDuringRun = isResolutionInFlight();
      return { ok: true };
    });

    expect(sawInFlightDuringRun).toBe(true);
    expect(isResolutionInFlight()).toBe(false);
    expect(result).toEqual({ ok: true });
  });

  it('clears the in-flight flag even when the resolution attempt throws (failure/escalation path)', async () => {
    await expect(
      withResolveWorktree('pr-1', 'feat/pr-1', dir, async () => {
        expect(isResolutionInFlight()).toBe(true);
        throw new Error('suite gate failed');
      }),
    ).rejects.toThrow('suite gate failed');

    expect(isResolutionInFlight()).toBe(false);
  });

  it('rejects eligibility for ANY PR (a different slug) while a resolution is in flight, with a logged reason', async () => {
    const logs: string[] = [];
    let elig: { eligible: boolean; reason?: string } | undefined;

    await withResolveWorktree('pr-1', 'feat/pr-1', dir, async () => {
      // A different PR (entryB, different slug) must be rejected while pr-1's
      // resolution is in flight — the serial guard is process-wide, not
      // per-slug.
      elig = await isEligibleForResolve(entryB, prState, cfg, new Date(), fs, (m) => logs.push(m));
      return { ok: true };
    });

    expect(elig?.eligible).toBe(false);
    expect(elig?.reason).toMatch(/in.?flight/i);
    expect(logs.some((l) => l.includes('skipped') && /in.?flight/i.test(l))).toBe(true);
  });

  it('allows eligibility again for a new PR once the in-flight resolution has completed', async () => {
    await withResolveWorktree('pr-1', 'feat/pr-1', dir, async () => ({
      ok: true,
    }));

    const elig = await isEligibleForResolve(entryA, prState, cfg, new Date(), fs);
    expect(elig.eligible).toBe(true);
  });

  it('provisions and tears down the resolve worktree without changing the retained feature worktree', async () => {
    const retained = await retainFeatureWorktree('pr-1');
    let resolvePathDuringRun = '';

    await withResolveWorktree(
      'pr-1',
      'origin/feat/pr-1',
      dir,
      async (resolvePath) => {
        resolvePathDuringRun = resolvePath;
      },
      async () => {},
    );

    expect({
      resolvePathDuringRun,
      resolveStillExists: await pathExists(resolvePathDuringRun),
      retainedStillExists: await pathExists(retained.path),
      retainedEvidence: await readFile(retained.pipelineMarker, 'utf8'),
    }).toEqual({
      resolvePathDuringRun: join(dir, '.worktrees', 'resolve-pr-1'),
      resolveStillExists: false,
      retainedStillExists: true,
      retainedEvidence: 'retained evidence\n',
    });
  });

  it('does not remove the retained feature worktree when resolve preparation fails', async () => {
    const retained = await retainFeatureWorktree('pr-1');
    const resolvePath = join(dir, '.worktrees', 'resolve-pr-1');

    await expect(
      withResolveWorktree(
        'pr-1',
        'origin/feat/pr-1',
        dir,
        async () => undefined,
        async () => {
          throw new Error('prepare failed');
        },
      ),
    ).rejects.toThrow('prepare failed');

    expect({
      resolveStillExists: await pathExists(resolvePath),
      retainedStillExists: await pathExists(retained.path),
      retainedEvidence: await readFile(retained.pipelineMarker, 'utf8'),
    }).toEqual({
      resolveStillExists: false,
      retainedStillExists: true,
      retainedEvidence: 'retained evidence\n',
    });
  });

  it('force-recreates a stale resolve path without touching the retained feature worktree', async () => {
    const retained = await retainFeatureWorktree('pr-1');
    const staleResolvePath = join(dir, '.worktrees', 'resolve-pr-1');
    const staleMarker = join(staleResolvePath, 'stale-marker');
    await mkdir(staleResolvePath, { recursive: true });
    await writeFile(staleMarker, 'stale\n');
    let staleMarkerPresentDuringRun = true;

    await withResolveWorktree(
      'pr-1',
      'origin/feat/pr-1',
      dir,
      async () => {
        staleMarkerPresentDuringRun = await pathExists(staleMarker);
      },
      async () => {},
    );

    expect({
      staleMarkerPresentDuringRun,
      resolveStillExists: await pathExists(staleResolvePath),
      retainedStillExists: await pathExists(retained.path),
      retainedEvidence: await readFile(retained.pipelineMarker, 'utf8'),
    }).toEqual({
      staleMarkerPresentDuringRun: false,
      resolveStillExists: false,
      retainedStillExists: true,
      retainedEvidence: 'retained evidence\n',
    });
  });
});
