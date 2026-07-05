/**
 * Acceptance: harness-daemon-profile (#174) — TR-3 real-composition story.
 *
 * A unit test that calls `classifyVersionSignal` or `evaluateVersionApproval`
 * directly can pass while the LIVE `runSelfHostFinishGates` call site never
 * threads a changed-files thunk into `versionGate` at all — the classifier
 * would ship correct but orphaned. This drives a real `Conductor` through the
 * ACTUAL self-build finish-gate path with the REAL `versionGate` primitive
 * (only `relink`/`provisionSandbox`/`resolveHarnessRoot`/`releaseGate` are
 * spied — they are irrelevant to this story and covered elsewhere), a stubbed
 * git diff (the only injection point), and asserts the observable artifacts:
 * an auto-pass writes `.pipeline/version-signal.json`, a HALT does not, and
 * `finish` is dispatched only on the pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const gitDiffOutput = vi.hoisted(() => ({ current: '' }));

// Never fork a real process; the git diff line is the only thing under test.
vi.mock('execa', () => ({
  execa: vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'diff') {
      return { exitCode: 0, stdout: gitDiffOutput.current, stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }),
}));

import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { runVersionApprovalGate } from '../../src/engine/self-host/version-gate.js';

const NOOP_ESCALATION = async () => ({});

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function preBuildDoneState(): ConductState {
  return {
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'done',
    plan: 'done',
    architecture_diagram: 'done',
    architecture_review: 'done',
    acceptance_specs: 'done',
    complexity_tier: 'M',
    track: 'technical',
    feature_desc: 'self-build-feat',
  } as ConductState;
}

describe('harness-daemon-profile — real version-gate composition (TR-3)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'harness-daemon-profile-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    gitDiffOutput.current = '';
    await writeFile(join(dir, 'VERSION'), '0.99.19\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function realVersionGateConductor(releaseGateSpy: SelfHostGuardrails['releaseGate']): {
    conductor: Conductor;
    seen: Array<{ step: StepName }>;
  } {
    const seen: Array<{ step: StepName }> = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        seen.push({ step });
        return { success: true };
      }),
    };
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => dir),
      relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => {
        throw new Error('sandbox must not be provisioned — sandbox_build_env is disabled');
      }),
      versionGate: runVersionApprovalGate, // the REAL primitive — no marker, no freeze.
      releaseGate: releaseGateSpy,
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      selfHost: true,
      baseBranch: 'main',
      fromStep: 'build',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
      config: { harness_self_host: { sandbox_build_env: false } },
    } as ConstructorParameters<typeof Conductor>[0]);
    return { conductor, seen };
  }

  it('a docs-only self-build diff auto-passes through the REAL classifier and dispatches finish', async () => {
    gitDiffOutput.current = 'M\tREADME.md\nM\t.docs/plans/foo.md\n';
    await writeState(statePath, preBuildDoneState());

    let capturedChangedFiles: (() => Promise<unknown>) | undefined;
    const releaseGate = vi.fn(async (opts: { changedFiles: () => Promise<unknown> }) => {
      capturedChangedFiles = opts.changedFiles;
      return { ok: true as const };
    });
    const { conductor, seen } = realVersionGateConductor(releaseGate);

    await conductor.run();

    // finish WAS dispatched — the real classifier auto-passed a docs-only diff.
    expect(seen.some((s) => s.step === 'finish')).toBe(true);
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);

    // The SAME underlying changed-files thunk feeds both gates: releaseGate's
    // injected thunk, called independently here, resolves to the identical
    // parsed diff the real versionGate classified against.
    expect(capturedChangedFiles).toBeDefined();
    const viaReleaseGate = await capturedChangedFiles!();
    expect(viaReleaseGate).toEqual([
      { status: 'M', path: 'README.md' },
      { status: 'M', path: '.docs/plans/foo.md' },
    ]);

    // Auditable auto-pass: version-signal.json records the real verdict.
    const signalRaw = await readFile(join(dir, '.pipeline/version-signal.json'), 'utf-8');
    const signal = JSON.parse(signalRaw);
    expect(signal.level).toBe('patch');
    expect(signal.files).toEqual(
      expect.arrayContaining(['README.md', '.docs/plans/foo.md']),
    );
  });

  it('a MINOR-signaling self-build diff HALTs via the REAL classifier, never reaching finish', async () => {
    gitDiffOutput.current = 'A\tskills/new-thing/SKILL.md\n';
    await writeState(statePath, preBuildDoneState());

    const releaseGate = vi.fn(async () => ({ ok: true as const }));
    const { conductor, seen } = realVersionGateConductor(releaseGate);

    await conductor.run();

    // Short-circuits: releaseGate is never consulted once versionGate HALTs.
    expect(releaseGate).not.toHaveBeenCalled();
    expect(seen.some((s) => s.step === 'finish')).toBe(false);

    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
    const haltText = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(haltText).toMatch(/minor/i);
    expect(haltText).toContain('skills/new-thing/SKILL.md');

    // No stale pass record — a HALT must never leave an audit file claiming a pass.
    expect(await exists(join(dir, '.pipeline/version-signal.json'))).toBe(false);
  });

  it('config version_approval_gate: false → versionGate never called, no version-signal.json', async () => {
    gitDiffOutput.current = 'M\tREADME.md\n';
    await writeState(statePath, preBuildDoneState());

    const versionGateSpy = vi.fn(async () => {
      throw new Error('versionGate must not be called when gate is disabled');
    });
    const releaseGateSpy = vi.fn(async () => ({ ok: true as const }));

    const seen: Array<{ step: StepName }> = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        seen.push({ step });
        return { success: true };
      }),
    };
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => dir),
      relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => {
        throw new Error('sandbox must not be provisioned — sandbox_build_env is disabled');
      }),
      versionGate: versionGateSpy,
      releaseGate: releaseGateSpy,
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      selfHost: true,
      baseBranch: 'main',
      fromStep: 'build',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
      config: {
        harness_self_host: {
          sandbox_build_env: false,
          version_approval_gate: false, // Gate is disabled
        },
      },
    } as ConstructorParameters<typeof Conductor>[0]);

    await conductor.run();

    // finish IS dispatched — the disabled gate is never consulted
    expect(seen.some((s) => s.step === 'finish')).toBe(true);

    // versionGate was never called
    expect(versionGateSpy).not.toHaveBeenCalled();

    // No HALT
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);

    // No version-signal.json — the gate never ran so no classification occurred
    expect(await exists(join(dir, '.pipeline/version-signal.json'))).toBe(false);

    // releaseGate still runs (it's independent)
    expect(releaseGateSpy).toHaveBeenCalled();
  });
});
