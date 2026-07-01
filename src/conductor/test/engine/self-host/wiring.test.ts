/**
 * Phase 6 — daemon-loop wiring of the self-host guardrail bundle.
 *
 * These drive a real Conductor with an injected SPY guardrail bundle (relink /
 * sandbox / version+release gates) and a fake step runner, proving that for a
 * self-build (`daemon && selfHost`):
 *   - relink runs ONCE before the first build, then the sandbox is provisioned;
 *   - `process.env.CLAUDE_CONFIG_DIR` is scoped to the sandbox DURING the build
 *     step and restored afterward — no bleed to later steps (e.g. finish), on
 *     both the pass and the throw branch;
 *   - the sandbox is torn down on every exit path;
 *   - the VERSION + release gates run BEFORE finish dispatches, and a failing
 *     gate parks the feature without opening a PR;
 *   - and that a non-self-build activates NONE of it (byte-for-byte unchanged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, access, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

// Never fork real git/execa (WorktreeManager etc. consume it transitively).
vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState } from '../../../src/types/index.js';
import type { StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeState } from '../../../src/engine/state.js';
import { Conductor } from '../../../src/engine/conductor.js';
import type { StepRunner } from '../../../src/engine/conductor.js';
import type { SelfHostGuardrails } from '../../../src/engine/self-host/wiring.js';
import type { SandboxBuildEnv } from '../../../src/engine/self-host/sandbox-build-env.js';

const NOOP_ESCALATION = async () => ({});
const SANDBOX_DIR = '/tmp/harness-selfbuild-TESTDIR';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** All steps before `build` stamped done so `fromStep: 'build'` drives build→finish. */
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
    track: 'technical', // no PRD/prd_audit — keeps the SHIP tail minimal
    feature_desc: 'self-build-feat',
  } as ConductState;
}

/** A spy guardrail bundle + handles to assert against. */
function makeGuardrails(overrides: Partial<SelfHostGuardrails> = {}) {
  const teardown = vi.fn(async () => {});
  const sandbox: SandboxBuildEnv = {
    configDir: SANDBOX_DIR,
    childEnv: () => ({ ...process.env }),
    teardown,
  };
  const guardrails: SelfHostGuardrails = {
    resolveHarnessRoot: vi.fn(async () => '/installed/harness'),
    relink: vi.fn(async () => {}),
    provisionSandbox: vi.fn(async () => sandbox),
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  return { guardrails, sandbox, teardown };
}

/** A runner that records the CLAUDE_CONFIG_DIR seen at dispatch time per step. */
function recordingRunner(onStep?: (step: StepName) => void): {
  runner: StepRunner;
  seen: Array<{ step: StepName; configDir: string | undefined }>;
} {
  const seen: Array<{ step: StepName; configDir: string | undefined }> = [];
  const runner: StepRunner = {
    run: vi.fn(async (step: StepName) => {
      seen.push({ step, configDir: process.env.CLAUDE_CONFIG_DIR });
      onStep?.(step);
      return { success: true };
    }),
  };
  return { runner, seen };
}

describe('self-host Phase 6 — daemon-loop wiring', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let priorConfigDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'selfhost-wiring-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    // Make the "original" env deterministic so no-bleed assertions are exact.
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    await rm(dir, { recursive: true, force: true });
  });

  function selfBuildConductor(
    guardrails: SelfHostGuardrails,
    runner: StepRunner,
    opts: { selfHost?: boolean; daemon?: boolean } = {},
  ): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: opts.daemon ?? true,
      selfHost: opts.selfHost ?? true,
      baseBranch: 'main',
      fromStep: 'build',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
    });
  }

  it('activates the whole bundle as one unit and scopes env to the build step only', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    await selfBuildConductor(guardrails, runner).run();

    // Bundle members all fired.
    expect(guardrails.relink).toHaveBeenCalledTimes(1);
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).toHaveBeenCalledTimes(1);

    // relink before provisionSandbox (globals refreshed before the sandbox links).
    const relinkOrder = (guardrails.relink as any).mock.invocationCallOrder[0];
    const provisionOrder = (guardrails.provisionSandbox as any).mock.invocationCallOrder[0];
    expect(relinkOrder).toBeLessThan(provisionOrder);

    // Env scoped to the build step ONLY — sandbox during build, original after.
    const build = seen.find((s) => s.step === 'build');
    const finish = seen.find((s) => s.step === 'finish');
    expect(build?.configDir).toBe(SANDBOX_DIR);
    expect(finish).toBeDefined();
    expect(finish?.configDir).toBeUndefined(); // no bleed to finish
    for (const s of seen) {
      if (s.step !== 'build') expect(s.configDir).toBeUndefined();
    }

    // Gates ran before finish dispatched.
    const gateOrder = (guardrails.versionGate as any).mock.invocationCallOrder[0];
    const finishRunOrder = (runner.run as any).mock.calls
      .map((c: unknown[], i: number) => ({ step: c[0], i }))
      .find((x: { step: StepName }) => x.step === 'finish');
    expect(gateOrder).toBeLessThan(
      (runner.run as any).mock.invocationCallOrder[finishRunOrder.i],
    );

    // Teardown + env restore + clean completion.
    expect(teardown).toHaveBeenCalled();
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(completed).toEqual(['feature_complete']);
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);
  });

  it('restores env and tears down the sandbox when the build throws mid-dispatch', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();

    let buildEnvAtThrow: string | undefined;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          buildEnvAtThrow = process.env.CLAUDE_CONFIG_DIR;
          throw new Error('boom mid-build');
        }
        return { success: true };
      }),
    };

    // maxRetries:1 → build throws once and the run HALTs.
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
      maxRetries: 1,
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
    });

    await conductor.run();

    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(buildEnvAtThrow).toBe(SANDBOX_DIR); // env WAS set during build
    expect(teardown).toHaveBeenCalled(); // torn down on the throw branch
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined(); // restored on throw
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
  });

  it('a relink failure aborts BEFORE any build dispatch (no sandbox, no build)', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails({
      relink: vi.fn(async () => {
        const { InstallStaleError } = await import(
          '../../../src/engine/install-freshness.js'
        );
        throw new InstallStaleError('skill relink failed for the harness self-build');
      }),
    });
    const { runner, seen } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.provisionSandbox).not.toHaveBeenCalled();
    expect(seen.find((s) => s.step === 'build')).toBeUndefined(); // build never dispatched
    expect(teardown).not.toHaveBeenCalled();
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
  });

  it('a failing finish gate parks the feature without dispatching finish', async () => {
    await writeState(statePath, preBuildDoneState());
    const reason = 'VERSION-bump approval required (self-host version gate)';
    const { guardrails } = makeGuardrails({
      versionGate: vi.fn(async () => ({ ok: false as const, reason })),
    });
    const { runner, seen } = recordingRunner();

    const halts: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') halts.push(e.reason);
    });
    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).not.toHaveBeenCalled(); // short-circuits on first fail
    expect(seen.find((s) => s.step === 'finish')).toBeUndefined(); // finish NOT dispatched
    expect(halts.some((r) => r.includes('VERSION-bump approval required'))).toBe(true);
    expect(completed).toEqual([]); // never completed
  });

  it('a non-self-build activates NONE of the bundle and never touches env', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    // daemon true but selfHost FALSE → isSelfBuild() is false.
    await selfBuildConductor(guardrails, runner, { selfHost: false }).run();

    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled();
    expect(guardrails.versionGate).not.toHaveBeenCalled();
    expect(guardrails.releaseGate).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    for (const s of seen) expect(s.configDir).toBeUndefined();
    expect(completed).toEqual(['feature_complete']);
  });

  it('the sandbox toggle is honored: sandbox_build_env=false skips the sandbox but keeps relink', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    await new Conductor({
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
    }).run();

    expect(guardrails.relink).toHaveBeenCalledTimes(1); // relink still runs
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled(); // sandbox skipped
    expect(teardown).not.toHaveBeenCalled();
    expect(seen.find((s) => s.step === 'build')?.configDir).toBeUndefined(); // env untouched
    // Finish gates still run (their toggles default on).
    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).toHaveBeenCalledTimes(1);
  });
});

// ── TR-12 (structural, wired path): the daemon never merges ──────────────────
describe('self-host wired path — non-autonomy (TR-12, ADR-005/ADR-010)', () => {
  const MERGE_PATTERNS = [/pr\s+merge/i, /mergePull/i, /\bmerge_pull_request\b/i, /gh\b.*\bmerge\b/i];

  it('the conductor self-build methods reference no merge entry point', async () => {
    const conductorSrc = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'src',
      'engine',
      'conductor.ts',
    );
    const text = await readFile(conductorSrc, 'utf-8');
    // Scope to the self-build region (helpers added in Phase 6).
    const start = text.indexOf('runSelfBuildDispatch');
    const end = text.indexOf('async run(): Promise<void>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = text.slice(start, end);
    for (const re of MERGE_PATTERNS) expect(re.test(region)).toBe(false);
  });
});
