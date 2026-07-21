/**
 * Acceptance specs for engine-owned acceptance_specs RED-evidence determinism
 * (#741, .docs/stories/acceptance-specs-red-evidence.md,
 * .docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md).
 *
 * A unit test that calls the new `selfHealAcceptanceRed` orchestrator directly
 * can pass while the LIVE `Conductor.run` acceptance_specs step path never
 * invokes it — the exact #297/#733 failure mode this feature closes (a
 * self-healing primitive that ships with zero production callers). These
 * specs drive the REAL `Conductor.run` entry point against a real tmp
 * worktree directory carrying committed spec files and (per case) a run
 * contract / RED marker, and assert the observable artifacts: the RED marker
 * written at the worktree root, `state.acceptance_specs`, the `.pipeline/HALT`
 * marker, and `step_retry`/`loop_halt` reason text. Per-primitive unit
 * coverage (contract parsing, cwd guard, targetSpecs cross-check, marker
 * writer, nested-marker normalization, the orchestrator itself) belongs to
 * test/engine/acceptance-red-runner.test.ts written during /pipeline — this
 * file only covers the cross-module gate-miss -> self-heal -> pass/HALT flow.
 *
 * Forward-looking injectable: `acceptanceRedExec` is not yet part of
 * `ConductorOptions` (Task 9 of the plan adds it, following this codebase's
 * existing DI convention for every other subprocess boundary — `gh`, `git`,
 * `runGh`, `escalateBuildFailure`). Injected here via a `Partial<ConductorOptions>`
 * cast, mirroring the same forward-looking-injectable technique used in
 * test/acceptance/daemon-false-ship-guard.acceptance.test.ts. Today's
 * `Conductor.run` never reads this option, so every case below currently
 * exercises the OLD pure-predicate behavior (bare "marker missing" / no
 * self-heal at all) — RED for the right reason.
 *
 * Pre-implementation: none of `selfHealAcceptanceRed`, the run-contract
 * parser, or the self-heal call site exist yet, so every case below is RED
 * against today's `Conductor.run`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  return { ...actual, performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }) };
});

import type { ConductState } from '../../src/types/index.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ACCEPTANCE_SPECS_RED_EVIDENCE } from '../../src/engine/artifacts.js';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

interface AcceptanceRedExecResult {
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  summary?: string;
}
type AcceptanceRedExec = (command: string, cwd: string) => Promise<AcceptanceRedExecResult>;

function trackingRunner(): { runner: StepRunner; log: string[] } {
  const log: string[] = [];
  const runner: StepRunner = {
    run: async (step: StepName): Promise<StepRunResult> => {
      log.push(`run:${step}`);
      return { success: true };
    },
    resetSession: async () => {
      log.push('reset');
    },
  };
  return { runner, log };
}

async function seedThrough(statePath: string, upToButExcluding: StepName): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  // Mark every step EXCEPT `upToButExcluding` as already 'done' — steps
  // before it so `Conductor.run` starts exactly at `upToButExcluding`
  // (via `fromStep`), and steps AFTER it so that once this single step
  // resolves (self-heal or HALT), `Conductor.run` has nothing further to
  // execute. Without seeding the trailing steps too, the run would fall
  // through into e.g. 'build' against this synthetic worktree (no real
  // plan file) and HALT there for a reason unrelated to acceptance_specs
  // RED-evidence determinism — these specs only care about the single
  // step under test.
  for (const s of ALL_STEPS) {
    if (s.name === upToButExcluding) continue;
    state[s.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = 'feat-741';
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
}

describe('acceptance_specs RED-evidence determinism — real Conductor.run entry point', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'acceptance-red-wt-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedThrough(statePath, 'acceptance_specs');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, 'test', 'acceptance'), { recursive: true });
    await writeFile(join(dir, 'test', 'acceptance', 'feature.acceptance.test.ts'), '// spec\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function runConductor(opts: Partial<ConductorOptions> = {}) {
    const { runner, log } = trackingRunner();
    const reasons: string[] = [];
    let haltReason: string | undefined;
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry') reasons.push(e.reason);
    });
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltReason = e.reason;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'acceptance_specs',
      ...opts,
    });
    return { conductor, log, reasons, getHaltReason: () => haltReason };
  }

  it('T-1/T-6 happy: valid contract + committed specs, no marker — engine self-heals and the step passes without re-dispatching the skill', async () => {
    await writeFile(
      join(dir, '.pipeline', 'acceptance-specs-run.json'),
      JSON.stringify({
        command: 'echo RED',
        cwd: '.',
        targetSpecs: ['test/acceptance/feature.acceptance.test.ts'],
      }),
      'utf-8',
    );
    const exec: AcceptanceRedExec = async () => ({
      executed: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      errors: 0,
      summary: '1 failed',
    });

    const { conductor, log, getHaltReason } = runConductor(
      { acceptanceRedExec: exec } as Partial<ConductorOptions>,
    );
    await conductor.run();

    // Self-heal wrote the marker at the authoritative worktree-root path.
    const markerRaw = await readFile(join(dir, ACCEPTANCE_SPECS_RED_EVIDENCE), 'utf-8');
    const marker = JSON.parse(markerRaw);
    expect(marker.failed).toBe(1);
    expect(marker.executed).toBe(1);

    // The step passed WITHOUT re-dispatching the writing-system-tests skill.
    expect(log).not.toContain('run:acceptance_specs');

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).toBe('done');

    expect(await exists(join(dir, '.pipeline', 'HALT'))).toBe(false);
    expect(getHaltReason()).toBeUndefined();
  });

  it('T-4/T-6 negative (no false GREEN): a genuine PASS run never fabricates a passing marker — self-heal never masks non-RED specs', async () => {
    await writeFile(
      join(dir, '.pipeline', 'acceptance-specs-run.json'),
      JSON.stringify({
        command: 'echo GREEN',
        cwd: '.',
        targetSpecs: ['test/acceptance/feature.acceptance.test.ts'],
      }),
      'utf-8',
    );
    const exec: AcceptanceRedExec = async () => ({
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      summary: '1 passed',
    });

    const { conductor, reasons, getHaltReason } = runConductor(
      { acceptanceRedExec: exec } as Partial<ConductorOptions>,
    );
    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');

    // The existing validator's pinned reason text — reused unchanged per the
    // plan — must surface, not a silent pass and not a bare "missing".
    const allReasons = [...reasons, getHaltReason() ?? ''].join('\n');
    expect(allReasons).toMatch(/0 failed/);
  });

  it('T-5 happy: no run contract and no marker — fails safe with an explicit "run contract missing" reason (never a silent pass)', async () => {
    // No .pipeline/acceptance-specs-run.json written.
    const { conductor, reasons, getHaltReason } = runConductor();
    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');

    const allReasons = [...reasons, getHaltReason() ?? ''].join('\n');
    expect(allReasons).toMatch(/run contract missing/i);
  });

  it('T-5 negative: malformed run-contract JSON fails with an explicit "invalid run contract JSON" reason, never a crash or a blind guess', async () => {
    await writeFile(join(dir, '.pipeline', 'acceptance-specs-run.json'), '{ not valid json', 'utf-8');

    const { conductor, reasons, getHaltReason } = runConductor();
    await conductor.run();

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');

    const allReasons = [...reasons, getHaltReason() ?? ''].join('\n');
    expect(allReasons).toMatch(/invalid run contract JSON/i);
  });

  it('T-3 negative: only a stray nested .pipeline marker exists (no root marker, no contract) — fails with an explicit "not at the authoritative path" reason, never a silent pass on the stray file', async () => {
    // Simulate the cwd-misplacement bug: a marker landed under a nested
    // package .pipeline/ (e.g. `cd src/conductor && <runner>`), never at the
    // worktree root the gate actually reads.
    await mkdir(join(dir, 'src', 'conductor', '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'conductor', '.pipeline', 'acceptance-specs-red.json'),
      JSON.stringify({
        command: 'echo RED',
        targetSpecs: ['test/acceptance/feature.acceptance.test.ts'],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
      }),
      'utf-8',
    );

    const { conductor, reasons, getHaltReason } = runConductor();
    await conductor.run();

    // Never fabricate done on the stray nested file.
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.acceptance_specs).not.toBe('done');
    expect(await exists(join(dir, ACCEPTANCE_SPECS_RED_EVIDENCE))).toBe(false);

    const allReasons = [...reasons, getHaltReason() ?? ''].join('\n');
    expect(allReasons).toMatch(/authoritative/i);
  });
});
