// RED acceptance spec for Task 16 — the post-restart dispatch parity guard.
//
// Stories: .docs/stories/2026-07-03-daemon-auto-restart-stale-engine.md
//   "Startup restart handshake" / negative path:
//   "processed markers, HALT-parked features, and in-progress worktrees exist...
//    its dispatch decisions are identical to a manual restart today — ... the
//    restart reason introduces no new dispatch, re-dispatch, or state mutation
//    (parity guard against the PR #109 / backfill class of restart-time bugs)."
//
// This drives the REAL, EXISTING startup entry points — `scanInheritedState` +
// `renderDashboard` (src/engine/daemon-dashboard.ts) and `pickEligible`
// (src/engine/daemon.ts) — against one identical on-disk fixture (a HALTED
// worktree, an IN-PROGRESS worktree, and a processed-ledger entry), booted two
// ways over the SAME fixture:
//   (a) "manual restart" — no RESTART_PENDING marker at all.
//   (b) "post engine-refresh restart" — a RESTART_PENDING marker present,
//       consumed by the not-yet-built `initStaleEngineState` handshake
//       (src/engine/stale-engine-init.ts, Task 8-9) BEFORE the scan runs.
//
// The two renders and the two `pickEligible` picks must be byte-identical.
// `initStaleEngineState` does not exist yet — the (b) boot path fails to
// resolve it, a genuine pre-implementation RED (writing-system-tests §3b: the
// spec drives the real entry points the story names, not a re-implementation).

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scanInheritedState,
  renderDashboard,
  type ScanInheritedStateDeps,
} from '../../src/engine/daemon-dashboard.js';
import { pickEligible, type PickEligibleCtx, type BacklogItem } from '../../src/engine/daemon.js';

const INIT_MOD = '../../src/engine/stale-engine-init.js';
async function loadInitStaleEngineState(): Promise<(opts: unknown) => Promise<unknown>> {
  const mod = (await import(INIT_MOD)) as Record<string, unknown>;
  const fn = mod.initStaleEngineState;
  if (typeof fn !== 'function') {
    throw new Error('expected export "initStaleEngineState" to be a function (not yet implemented)');
  }
  return fn as (opts: unknown) => Promise<unknown>;
}

async function buildFixture(): Promise<{ projectRoot: string; worktreeBase: string; processedDir: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dispatch-parity-'));
  const worktreeBase = join(projectRoot, '.worktrees');
  const processedDir = join(projectRoot, '.daemon', 'processed');
  await mkdir(processedDir, { recursive: true });

  // HALTED worktree — parked for a human.
  const haltedWt = join(worktreeBase, 'halted-feature');
  await mkdir(join(haltedWt, '.pipeline'), { recursive: true });
  await writeFile(join(haltedWt, '.pipeline', 'HALT'), 'needs human review\n', 'utf-8');
  await writeFile(
    join(haltedWt, '.pipeline', 'conduct-state.json'),
    JSON.stringify({ complexity_tier: 'M', build: 'failed' }),
    'utf-8',
  );

  // IN-PROGRESS worktree — no HALT marker.
  const inProgressWt = join(worktreeBase, 'in-progress-feature');
  await mkdir(join(inProgressWt, '.pipeline'), { recursive: true });
  await writeFile(
    join(inProgressWt, '.pipeline', 'conduct-state.json'),
    JSON.stringify({ complexity_tier: 'S', tdd: 'in_progress' }),
    'utf-8',
  );

  // Processed ledger entry — shipped, excluded from IN-PROGRESS.
  await writeFile(join(processedDir, 'shipped-feature'), JSON.stringify({ prUrl: 'https://example/pr/1' }), 'utf-8');

  return { projectRoot, worktreeBase, processedDir };
}

function discover(): () => Promise<BacklogItem[]> {
  return async () => [{ slug: 'eligible-feature', tier: 'M' }];
}

async function bootAndRender(
  fixture: { worktreeBase: string; processedDir: string },
): Promise<{ dashboard: string; picked: BacklogItem | undefined }> {
  const deps: ScanInheritedStateDeps = {
    worktreeBase: fixture.worktreeBase,
    processedDir: fixture.processedDir,
    discover: discover(),
  };
  const state = await scanInheritedState(deps);
  const dashboard = renderDashboard(state);

  const ctx: PickEligibleCtx = {
    inFlight: { has: () => false },
    parked: new Set(),
    started: new Set(),
  };
  const picked = await pickEligible({ items: await discover()() }, ctx);
  return { dashboard, picked };
}

describe('acceptance: post-restart dispatch parity guard (Task 16)', () => {
  it(
    'a manual restart and a post engine-refresh restart produce IDENTICAL dashboard + dispatch decisions over the same fixture',
    async () => {
      const manualFixture = await buildFixture();
      const refreshFixture = await buildFixture();
      try {
        // (a) Manual restart: no RESTART_PENDING marker involved at all.
        const manual = await bootAndRender(manualFixture);

        // (b) Post engine-refresh restart: a marker is present and consumed by
        // the handshake BEFORE the dashboard scan runs — mirrors the real
        // daemon-cli boot order (handshake, then renderStartupDashboard).
        await mkdir(join(refreshFixture.projectRoot, '.daemon'), { recursive: true });
        await writeFile(
          join(refreshFixture.projectRoot, '.daemon', 'RESTART_PENDING'),
          JSON.stringify({
            reason: 'stale-engine',
            fromIdentity: 'aaa',
            targetIdentity: 'bbb',
            at: new Date().toISOString(),
          }),
          'utf-8',
        );
        const initStaleEngineState = await loadInitStaleEngineState();
        await initStaleEngineState({
          repoPath: refreshFixture.projectRoot,
          entryPath: join(refreshFixture.projectRoot, 'dist', 'index.js'),
          flag: true,
          log: () => {},
        });
        const refreshed = await bootAndRender(refreshFixture);

        expect(refreshed.dashboard).toBe(manual.dashboard);
        expect(refreshed.picked?.slug).toBe(manual.picked?.slug);
      } finally {
        await rm(manualFixture.projectRoot, { recursive: true, force: true });
        await rm(refreshFixture.projectRoot, { recursive: true, force: true });
      }
    },
  );
});
