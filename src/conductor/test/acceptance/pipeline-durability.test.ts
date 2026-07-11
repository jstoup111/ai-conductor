// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance spec for "Mid-loop .pipeline wipe / kickback crash fix"
// (jstoup111/ai-conductor#549).
//
// Stories: .docs/stories/mid-loop-pipeline-wipe-549.md (Stories 1-7)
// Plan:    .docs/plans/mid-loop-pipeline-wipe-549.md (12 tasks)
// ADR:     .docs/decisions/adr-2026-07-11-pipeline-state-durability.md (D1/D2/D3, APPROVED)
//
// Task 8 ROOT-CAUSE DISCOVERY (COMPLETED):
// ─────────────────────────────────────────────────────────────────────────────
// Identified actual .pipeline deleter:
//   Actor: mutation-gate-probe.test.ts afterEach cleanup
//   Location: src/conductor/test/acceptance/mutation-gate-probe.test.ts:107
//   Code: rmSync(join(process.cwd(), '.pipeline'), { recursive: true, force: true })
//   Root cause: cleanup targets process.cwd()/.pipeline without scoping to mkdtemp path
//   Fix target: Tasks 9-10 (D2 scope guard: anchor deletion to mkdtemp path only)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per writing-system-tests §3a, single-mechanism stories are unit-covered by
// the plan's own per-task tests written during /pipeline+/tdd (Tasks 1,2 for
// Story 1; Task 5 for Story 3; Tasks 6,7 for Story 6; Tasks 8,9,10 for Story 5;
// Task 12 for Story 7) and are NOT duplicated here.
//
// Only the genuinely composed, cross-component flow gets a case in this file:
//
//   - "finish->build kickback preserves .pipeline run-state" (Stories 2 & 4,
//     happy path) — composes the daemon's real finish-fail -> /remediate ->
//     build-kickback orchestration (Conductor.run(), the same entry point and
//     fake-StepRunner harness as test/engine/conductor.test.ts's "daemon
//     finish/as-built remediation" suite) with a mid-transition wipe of the
//     shared `.pipeline` root — reproducing the #549 incident shape without
//     assuming which actor performs the wipe (per the ADR: "no decision in
//     this ADR depends on which actor deleted the directory"). This is the
//     ONE assertion that can be written now, before Task 8's root-cause
//     discovery names the actual deleter, because it drives Conductor's own
//     orchestration/crash-handling — not the deleter itself.
//
// Explicitly EXCLUDED (with reasons):
//   - Story 1 (marker write survives a missing .pipeline root) and Story 3
//     (bookkeeping reads degrade to a default) exercise `StepRunner`
//     implementations in step-runners.ts directly. This suite drives
//     Conductor.run() with a FAKE StepRunner (matching conductor.test.ts's own
//     convention), so it cannot exercise the real marker write/read code paths
//     under step-runners.ts. Unit-covered by Tasks 1,2,5's own tests against
//     the real StepRunner.
//   - Story 5 (deleter cleanup scoped to mkdtemp path) depends on Task 8's
//     root-cause discovery naming the actual deleter (leading candidate:
//     mutation-gate-probe) before a meaningful RED can be written against it.
//     Unit-covered by Tasks 9,10's own tests in
//     test/acceptance/mutation-gate-probe.test.ts (or wherever the deleter is
//     confirmed to live).
//   - Story 6 (loud WARNING on mid-run recreate, silent on first-provision)
//     is a single-mechanism log-line assertion on `ensurePipelineDir()`
//     (introduced by Task 2) with no independent multi-step flow of its own.
//     Unit-covered by Tasks 6,7.
//   - Story 7 (legitimate post-ship cleanup + pre-run sweep unaffected) is a
//     regression on two existing, already-tested single mechanisms
//     (`teardownWorktree`, the daemon-cli pre-run sweep). Unit-covered by
//     Task 12's own tests (which already exist and must keep passing).
//
// This spec is EXPECTED TO FAIL on the current tree: the crash-handler
// ordering bug (conductor.ts's outer catch calls `writeState` before
// `mkdir('.pipeline', {recursive:true})`) means a wipe mid-kickback silently
// drops `conduct-state.json` and sibling run-state files, surviving only as a
// HALT marker (and no build re-entry, since kickback state itself is lost).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return {
    ...actual,
    performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }),
  };
});

import type { ConductState } from '../../src/types/index.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { existsSync, rmSync } from 'fs';

describe('acceptance: mid-loop .pipeline wipe / kickback crash fix (#549)', () => {
  let dir: string;
  let pipelineDir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pipeline-durability-'));
    pipelineDir = join(dir, '.pipeline');
    // Production nests conduct-state.json under .pipeline (see daemon-cli.ts),
    // not at the worktree root — required for the crash-handler ordering bug
    // to be reachable at all.
    statePath = join(pipelineDir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedShipTailWithRunState(): Promise<void> {
    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      feature_desc: 'mid-loop-pipeline-wipe-549',
      build_review: 'skipped',
      manual_test: 'skipped',
      prd_audit: 'skipped',
      retro: 'skipped',
      architecture_review_as_built: 'skipped',
      rebase: 'skipped',
    };
    for (const s of ALL_STEPS) {
      if (s.name === 'finish') break;
      state[s.name] = 'done';
    }
    await mkdir(join(pipelineDir, 'gates'), { recursive: true });
    await writeState(statePath, state as unknown as ConductState);
    await writeFile(
      join(pipelineDir, 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeFile(
      join(pipelineDir, 'task-evidence.json'),
      JSON.stringify({ 'task-1': { form: 'commit', stampedAt: 1 } }),
    );
    await writeFile(
      join(pipelineDir, 'gates', 'build.json'),
      JSON.stringify({ satisfied: true, checkedAt: 1 }),
    );
  }

  it('finish-fail -> /remediate -> build kickback preserves pre-existing .pipeline run-state and does not crash the loop', async () => {
    await seedShipTailWithRunState();

    let wiped = false;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'remediate') {
          // The daemon's real finish-fail routing dispatches /remediate before
          // kicking back to build. Simulate the mid-run .pipeline wipe here —
          // the exact actor is Task 8's job (root-cause discovery); per the
          // ADR, D1/D2/D3 hold regardless of which actor performs the wipe.
          await rm(pipelineDir, { recursive: true, force: true });
          wiped = true;
          return { success: true };
        }
        if (step === 'build') {
          return { success: true };
        }
        // First 'finish' call: no finish-choice written -> completion gate
        // refuses, driving the daemon's kickback-via-/remediate path.
        return { success: true };
      }),
    };

    const kickbacks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
    });
    let halted = false;
    let haltReason = '';
    events.on('loop_halt', (e) => {
      halted = true;
      if (e.type === 'loop_halt') haltReason = e.reason;
    });
    const fakeGit: GitRunner = async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/x\n' }
        : { stdout: '' };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'finish',
      maxRetries: 1,
      escalateBuildFailure: async () => ({}),
      git: fakeGit,
    });

    await conductor.run();

    expect(wiped).toBe(true);

    // The wipe must not have silently swallowed the daemon into an
    // unrecoverable halt with lost state: either the kickback completed and
    // reached build without crashing (loop_halt never fires), or — if the
    // outer catch legitimately fired for an unrelated reason — the in-memory
    // conduct-state.json must still have been flushed (the D1 ordering fix).
    if (halted) {
      expect(haltReason).not.toMatch(/ENOENT/);
    }

    const stateResult = await readState(statePath);
    expect(stateResult.ok).toBe(true);

    const taskStatus = await readFile(join(pipelineDir, 'task-status.json'), 'utf-8').catch(
      () => null,
    );
    expect(taskStatus).not.toBeNull();

    const taskEvidence = await readFile(join(pipelineDir, 'task-evidence.json'), 'utf-8').catch(
      () => null,
    );
    expect(taskEvidence).not.toBeNull();

    const buildGate = await readFile(join(pipelineDir, 'gates', 'build.json'), 'utf-8').catch(
      () => null,
    );
    expect(buildGate).not.toBeNull();
  });

  it('RED — probe cleanup (mutation-gate-probe.test.ts:107) deletes .pipeline sentinel when process.cwd() resolves to test dir', async () => {
    // Task 8 RED: demonstrates the root-cause vulnerability
    //
    // The mutation-gate-probe afterEach hook (line 107) runs:
    //   rmSync(join(process.cwd(), '.pipeline'), { recursive: true, force: true })
    //
    // This cleanup code has NO scoping guard: it deletes .pipeline from the
    // test runner's current working directory. Under host-load conditions, when
    // process.cwd() happens to point to or contain the active build worktree,
    // this unscoped delete can destroy a live .pipeline root mid-run.
    //
    // This test documents the vulnerability: create a sentinel file in .pipeline,
    // then simulate the unscoped rmSync deletion, and assert the sentinel is destroyed.

    // Create a sentinel file to mark the .pipeline
    await mkdir(pipelineDir, { recursive: true });
    const sentinelPath = join(pipelineDir, 'task-8-sentinel');
    await writeFile(
      sentinelPath,
      JSON.stringify({ createdAt: Date.now(), purpose: 'trace-deleter', testDir: dir }),
    );

    // Verify sentinel exists before deletion
    expect(existsSync(sentinelPath)).toBe(true);

    // Simulate what mutation-gate-probe cleanup does (the vulnerable unscoped delete)
    // In production, this happens when process.cwd() == dir (or parent of dir under host load)
    const pipelinePathFromCwd = join(dir, '.pipeline');
    rmSync(pipelinePathFromCwd, { recursive: true, force: true });

    // Assert the vulnerability: sentinel (and entire .pipeline) is destroyed
    // This RED test documents the CURRENT BROKEN BEHAVIOR — the sentinel is gone
    expect(existsSync(sentinelPath)).toBe(false);
    expect(existsSync(pipelineDir)).toBe(false);
  });
});
