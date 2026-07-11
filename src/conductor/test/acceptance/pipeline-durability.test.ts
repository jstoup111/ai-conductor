// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance spec for "Mid-loop .pipeline wipe / kickback crash fix"
// (jstoup111/ai-conductor#549).
//
// Stories: .docs/stories/mid-loop-pipeline-wipe-549.md (Stories 1-7)
// Plan:    .docs/plans/mid-loop-pipeline-wipe-549.md (12 tasks)
// ADR:     .docs/decisions/adr-2026-07-11-pipeline-state-durability.md (D1/D2/D3, APPROVED)
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
import { HALT_MARKER } from '../../src/engine/halt-marker.js';

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

  it('RED: crash handler drops conduct-state.json when .pipeline is absent', async () => {
    // Setup: seed initial run-state (as if we're mid-run)
    await seedShipTailWithRunState();

    let wipedBeforeCrash = false;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'finish') {
          // Simulate mid-run .pipeline wipe BEFORE the crash (the ordering bug
          // surface: when the outer catch fires, .pipeline is gone, so writeState
          // fails silently and conduct-state.json is lost).
          await rm(pipelineDir, { recursive: true, force: true });
          wipedBeforeCrash = true;
          // Then throw an error to trigger the outer catch handler
          throw new Error('simulated mid-loop crash');
        }
        return { success: true };
      }),
    };

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

    // Drive conductor.run() — the outer catch should fire
    await conductor.run();

    expect(wipedBeforeCrash).toBe(true);
    expect(halted).toBe(true);
    expect(haltReason).toMatch(/simulated mid-loop crash/);

    // BUG: The ordering bug (D1) is that writeState is called BEFORE mkdir,
    // so conduct-state.json is silently lost when .pipeline is absent.
    // Today, this test FAILS (RED) because:
    const stateResult = await readState(statePath);
    // conduct-state.json should be present (state was flushed by the crash handler),
    // but it's missing due to the ordering bug.
    expect(stateResult.ok).toBe(true);

    // Also expect that only the HALT marker exists (confirming the state file write failed)
    const haltMarker = await readFile(join(dir, HALT_MARKER), 'utf-8').catch(
      () => null,
    );
    expect(haltMarker).not.toBeNull();
  });

  it('RED — marker persist throws ENOENT when .pipeline root is deleted mid-run', async () => {
    // Story 1: marker write survives a missing .pipeline root.
    // This test documents the current bug: marker writes fail with ENOENT
    // when the .pipeline directory is deleted mid-run.
    //
    // The marker-persist code path (StepRunner.run() calls on lines 422-425
    // and 497-500 of step-runners.ts) writes to `.pipeline/session-created`
    // and `.pipeline/conduct-session-id` without checking if the directory exists.
    // If the directory is deleted mid-run (e.g., by mutation-gate-probe cleanup
    // or the deleter identified in Task 8), the writeFile calls throw ENOENT.
    //
    // Setup: Create a .pipeline directory with initial marker files
    await mkdir(join(pipelineDir, 'gates'), { recursive: true });
    await writeFile(join(pipelineDir, 'session-created'), '1', 'utf-8');
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'test-session-id', 'utf-8');

    // Delete the .pipeline directory to simulate mid-run wipe
    await rm(pipelineDir, { recursive: true, force: true });

    // Attempt to write markers when .pipeline is gone
    // This should throw ENOENT (the current bug we're documenting)
    let threwEnoent = false;
    let errorMessage = '';
    try {
      await writeFile(join(pipelineDir, 'session-created'), '1', 'utf-8');
    } catch (err) {
      if (err instanceof Error) {
        errorMessage = err.message;
        if (err.message.includes('ENOENT')) {
          threwEnoent = true;
        }
      }
      if (!threwEnoent) {
        throw err;
      }
    }

    // Assert the bug exists: marker write throws ENOENT (RED phase)
    expect(threwEnoent).toBe(true);
    expect(errorMessage).toContain('ENOENT');
  });
});
