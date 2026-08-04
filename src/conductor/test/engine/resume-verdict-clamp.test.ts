import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Acceptance specs for #532 ("Rekick resume runs finish while the build gate
// verdict is unsatisfied") — see .docs/stories/rekick-resume-runs-finish-while-
// the-build-gate-ver.md and the approved
// adr-2026-07-11-verdict-aware-resume-entry. These drive the REAL production
// entry point (`Conductor.run({ resume: true })`), not the new selector helper
// directly — the bug lives in the wiring between resume's start-index
// derivation and the on-disk gate verdicts, which a unit test of the helper in
// isolation cannot reach (per /writing-system-tests §3b).

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

import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict, type GateVerdict } from '../../src/engine/gate-verdicts.js';
import { writeFile, mkdir } from 'fs/promises';

function trackingRunner(projectRoot?: string): { runner: StepRunner; log: string[] } {
  const log: string[] = [];
  const runner: StepRunner = {
    run: async (step: StepName) => {
      log.push(`run:${step}`);
      // #922 re-checks current validation evidence before publication. Model
      // the validator skills' real output when a resume fixture re-enters one.
      if (projectRoot) {
        if (step === 'manual_test') {
          await writeFile(
            join(projectRoot, '.pipeline', 'manual-test-results.md'),
            '| Story | Result |\n|---|---|\n| fixture | PASS |\n',
          );
        } else if (step === 'prd_audit') {
          await writeFile(
            join(projectRoot, '.pipeline', 'prd-audit.md'),
            '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | fixture |\n',
          );
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(projectRoot, '.pipeline', 'architecture-review-as-built.md'),
            '**Verdict:** APPROVED\n',
          );
        }
      }
      return { success: true };
    },
    resetSession: async () => {
      log.push('reset');
    },
  };
  return { runner, log };
}

/** Marks every step up to (excluding) `stopAt` as 'done' in a fresh state seed. */
function seedDoneThrough(stopAt: StepName): Record<string, unknown> {
  const seed: Record<string, unknown> = { complexity_tier: 'M' };
  for (const s of ALL_STEPS) {
    if (s.name === stopAt) break;
    seed[s.name] = 'done';
  }
  return seed;
}

const kickback: GateVerdict['kickback'] = {
  from: 'rebase',
  evidence: 'rebase changed code/test paths: src/engine/foo.ts',
};

describe('acceptance: verdict-aware resume entry (#532)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'resume-clamp-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Story 1: resume never dispatches past an unsatisfied gate verdict ─────
  describe('Story 1: resume clamps to the earliest unsatisfied gate', () => {
    async function seed532Fixture(): Promise<void> {
      const seed = seedDoneThrough('build');
      seed.build = 'failed';
      seed.rebase = 'done';
      seed.last_step = 'finish';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });
    }

    it('the #532 fixture resumes at build, not finish', async () => {
      await seed532Fixture();
      const { runner, log } = trackingRunner(dir);
      // Daemon parity (daemon-cli.ts passes verifyArtifacts: true): the clamp
      // enters at build, and the artifact gate keeps finish unreachable while
      // the build gate is unsatisfied — the tail selector is the only
      // satisfaction authority (adr-2026-07-11-verdict-aware-resume-entry §5).
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
        verifyArtifacts: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
      expect(log).not.toContain('run:finish');
    });

    it('daemon-path resume: step_started names build, never finish before the build gate flips', async () => {
      await seed532Fixture();
      const { runner } = trackingRunner(dir);
      const started: StepName[] = [];
      events.on('step_started', (e) => {
        if (e.type === 'step_started') started.push(e.step);
      });

      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        resume: true, daemon: true, verifyArtifacts: true,
      });
      await conductor.run();

      expect(started[0]).toBe('build');
      expect(started.indexOf('finish')).toBe(-1);
    });

    it('a corrupt build.json verdict does not throw and still starts at build', async () => {
      await seed532Fixture();
      // Overwrite with unparseable bytes — readVerdict must treat this as absent.
      await writeFile(join(dir, '.pipeline', 'gates', 'build.json'), '{oops', 'utf-8');

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });

      await expect(conductor.run()).resolves.not.toThrow();
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('a missing .pipeline/gates directory does not throw and still starts at build', async () => {
      await seed532Fixture();
      await rm(join(dir, '.pipeline', 'gates'), { recursive: true, force: true });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });

      await expect(conductor.run()).resolves.not.toThrow();
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('an explicit --from-step finish remains fenced by non-green validation', async () => {
      await seed532Fixture();
      const { runner, log } = trackingRunner(dir);
      const kickbacks: Array<{ from: StepName; to: StepName }> = [];
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
      });
      // The #922 publication fence is an artifact-verifying boundary: with
      // `verifyArtifacts:false` (the mocked-dispatch unit mode) runner success
      // is the only authority and `nonGreenFinishValidators` is inert by
      // design. Production always verifies artifacts (index.ts, daemon-cli.ts),
      // so the fence oracle must run in that mode.
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        fromStep: 'finish', verifyArtifacts: true,
      });

      await conductor.run();

      expect(log).not.toContain('run:finish');
      expect(kickbacks).toContainEqual(
        expect.objectContaining({ from: 'finish', to: 'manual_test' }),
      );
    });
  });

  // ── Story 2: the in_progress resume branch is clamped too ─────────────────
  describe('Story 2: the in_progress branch honors the clamp', () => {
    it('finish marked in_progress still resumes at build under an unsatisfied build verdict', async () => {
      const seed = seedDoneThrough('build');
      seed.build = 'failed';
      seed.rebase = 'done';
      seed.finish = 'in_progress';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('build marked in_progress never moves the entry later (backward-only)', async () => {
      const seed = seedDoneThrough('build');
      seed.build = 'in_progress';
      await writeState(statePath, seed as ConductState);
      // A later gate happens to be unsatisfied too — must not pull entry forward.
      await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('finish marked in_progress revalidates current SHIP evidence before dispatching finish', async () => {
      const seed = seedDoneThrough('finish');
      seed.finish = 'in_progress';
      await writeState(statePath, seed as ConductState);
      for (const name of ['build', 'build_review', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'retro', 'rebase'] as StepName[]) {
        await writeVerdict(dir, name, { satisfied: true, checkedAt: 1 });
      }

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log).toContain('run:finish');
      expect(log.indexOf('run:manual_test')).toBeLessThan(log.indexOf('run:finish'));
    });
  });

  // ── Story 3: post-rebase kickback verdicts are honored on resume ──────────
  describe('Story 3: post-rebase kickback verdicts steer the resume entry', () => {
    it.each([
      { staleGate: 'wiring_check' as const },
      { staleGate: 'test_suite' as const },
    ])('a stale $staleGate proof resumes before build_review', async ({ staleGate }) => {
      const seed = seedDoneThrough('manual_test');
      seed.build = 'done';
      seed.wiring_check = staleGate === 'wiring_check' ? 'stale' : 'done';
      seed.test_suite = staleGate === 'test_suite' ? 'stale' : 'done';
      seed.build_review = 'stale';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'wiring_check', {
        satisfied: staleGate !== 'wiring_check',
        checkedAt: 1,
        ...(staleGate === 'wiring_check' ? { kickback } : {}),
      });
      await writeVerdict(dir, 'test_suite', {
        satisfied: staleGate !== 'test_suite',
        checkedAt: 1,
        ...(staleGate === 'test_suite' ? { kickback } : {}),
      });
      await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });

      const sentinel = new Error(`observed:${staleGate}`);
      const observed: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          observed.push(step);
          if (step === staleGate) throw sentinel;
          return { success: true };
        },
      };
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
        fullSuiteVerifier: {
          ensure: async () => {
            observed.push('test_suite');
            if (staleGate === 'test_suite') throw sentinel;
            return { status: 'REUSED', evidence: {} as never };
          },
          inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
        },
      });
      await conductor.run();

      expect(observed[0]).toBe(staleGate);
      expect(observed).not.toContain('build_review');
    });

    it('three post-navigateBack kickback verdicts resume at build (earliest kicked-back gate)', async () => {
      const seed = seedDoneThrough('finish');
      // Post-kickback disk state exactly as navigateBack (the in-loop
      // demotion authority) left it: the kicked-back target is 'pending',
      // its downstream 'stale'. Resume never rewrites statuses itself —
      // adr-2026-07-11-verdict-aware-resume-entry rejected Option C.
      seed.build = 'pending';
      seed.build_review = 'stale';
      seed.manual_test = 'stale';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('only manual_test kicked back resumes at manual_test', async () => {
      const seed = seedDoneThrough('finish');
      // navigateBack left only the kicked-back target demoted (see above).
      seed.manual_test = 'pending';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'manual_test', { satisfied: false, checkedAt: 1, kickback });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:manual_test');
    });

    it('a stale step is selected even though its own verdict still says satisfied', async () => {
      const seed = seedDoneThrough('build');
      seed.build = 'done';
      seed.wiring_check = 'done';
      seed.test_suite = 'done';
      seed.build_review = 'stale';
      seed.rebase = 'done';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'wiring_check', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'test_suite', { satisfied: true, checkedAt: 1 });
      // Stale but the on-disk verdict lies and says satisfied — state must win.
      await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build_review');
    });

    it('an unsatisfied verdict before regionStart is ignored by the clamp while current validation still fences finish', async () => {
      const seed = seedDoneThrough('finish');
      await writeState(statePath, seed as ConductState);
      // 'explore' precedes regionStart (the first kickback target, 'prd') —
      // a stray unsatisfied verdict there must not affect the resume entry.
      await writeVerdict(dir, 'explore', { satisfied: false, checkedAt: 1 });

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log).toContain('run:finish');
      expect(log.indexOf('run:manual_test')).toBeLessThan(log.indexOf('run:finish'));
    });
  });

  // ── Story 4: all-satisfied resumes fast-forward unchanged (regression) ────
  describe('Story 4: parity with pre-fix state-only derivation', () => {
    it('fully satisfied persisted verdicts still require current validation evidence before finish', async () => {
      const seed = seedDoneThrough('finish');
      await writeState(statePath, seed as ConductState);
      for (const name of ['build', 'build_review', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'retro', 'rebase'] as StepName[]) {
        await writeVerdict(dir, name, { satisfied: true, checkedAt: 1 });
      }

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log).toContain('run:finish');
      expect(log.indexOf('run:manual_test')).toBeLessThan(log.indexOf('run:finish'));
    });

    it('a fresh dispatch (DECIDE done, no verdicts) resumes at acceptance_specs', async () => {
      const seed = seedDoneThrough('acceptance_specs');
      await writeState(statePath, seed as ConductState);

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:acceptance_specs');
    });

    it('a pending front-half step is not dragged forward by pending loop gates', async () => {
      const seed = seedDoneThrough('architecture_review'); // architecture_review pending
      await writeState(statePath, seed as ConductState);
      // No verdict files at all — loop-region gates are pending, not unsatisfied
      // by verdict; the clamp must not pull the entry into the loop region.

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:architecture_review');
    });

    it('skipped tier-S loop steps without verdicts do not attract the clamp', async () => {
      const seed: Record<string, unknown> = { complexity_tier: 'S', track: 'technical' };
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        seed[s.name] = s.skippableForTiers.includes('S') ? 'skipped' : 'done';
      }
      await writeState(statePath, seed as ConductState);

      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
    });
  });

  // ── Story 4 (#1052): a stale verdict must not clamp PAST a failed step ────
  // Live-daemon fixture: `.pipeline/gates/build.json` said satisfied:true while
  // conduct-state.json said build:"failed" (a build attempt failed after an
  // earlier passing review, and nothing rewrote the verdict). The clamp's
  // verdict-authoritative predicate skipped `build` and landed on
  // `build_review`, whose STATE-only `checkGate` can never pass while its
  // `build` prerequisite is failed — so the loop took the markerless
  // `gate_blocked` return and the finally-backstop parked the run with
  // "loop exited without a terminal verdict", identically on every resume,
  // without ever dispatching a session.
  describe('Story 4: a satisfied verdict over a failed state does not strand the loop (#1052)', () => {
    async function seed1052Fixture(): Promise<void> {
      const seed = seedDoneThrough('build');
      seed.build = 'failed';
      seed.build_review = 'stale';
      seed.wiring_check = 'stale';
      seed.test_suite = 'stale';
      seed.manual_test = 'stale';
      seed.architecture_review_as_built = 'stale';
      seed.rebase = 'done';
      seed.finish = 'failed';
      seed.last_step = 'rebase';
      await writeState(statePath, seed as ConductState);
      // The divergence: verdict satisfied, state failed.
      await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'build_review', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'wiring_check', { satisfied: false, checkedAt: 1, kickback });
      await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });
    }

    it('resumes at build rather than a build_review the gate check will reject', async () => {
      await seed1052Fixture();
      const { runner, log } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('daemon resume dispatches build instead of exiting with zero dispatches', async () => {
      await seed1052Fixture();
      const { runner } = trackingRunner(dir);
      const started: StepName[] = [];
      const blocked: StepName[] = [];
      events.on('step_started', (e) => {
        if (e.type === 'step_started') started.push(e.step);
      });
      events.on('gate_blocked', (e) => {
        if (e.type === 'gate_blocked') blocked.push(e.step);
      });

      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        resume: true, daemon: true,
      });
      await conductor.run();

      // The bug's exact signature: the run ended having dispatched NOTHING,
      // because entry landed on a `build_review` whose gate check rejected it.
      expect(started.length).toBeGreaterThan(0);
      expect(started[0]).toBe('build');
      expect(blocked).not.toContain('build_review');
    });
  });

  // ── Story 5: tail selection is clamped by the entry-gate predicate ──────
  describe('Story 5: tail selection cannot enter a gate its prerequisite rejects', () => {
    async function selectTailWithBuildStatus(buildStatus: 'done' | 'failed'): Promise<number | null | 'halt'> {
      const seed = seedDoneThrough('finish');
      seed.build = buildStatus;
      seed.wiring_check = 'pending';
      await writeState(statePath, seed as ConductState);

      for (const name of ALL_STEPS.filter((step) => step.loopGate).map((step) => step.name)) {
        if (name !== 'wiring_check') {
          await writeVerdict(dir, name, { satisfied: true, checkedAt: 1 });
        }
      }

      const { runner } = trackingRunner(dir);
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        verifyArtifacts: true,
      });
      return (conductor as unknown as {
        advanceTail: (
          step: typeof ALL_STEPS[number],
          state: ConductState,
          stuckGate: Map<StepName, number>,
          steps: typeof ALL_STEPS,
          indexOf: (name: StepName) => number,
        ) => Promise<number | null | 'halt'>;
      }).advanceTail(
        ALL_STEPS.find((step) => step.name === 'finish')!,
        seed as ConductState,
        new Map(),
        ALL_STEPS,
        (name) => ALL_STEPS.findIndex((step) => step.name === name),
      );
    }

    it('selects the failed prerequisite when the selector considers its verdict satisfied', async () => {
      const selectedIndex = await selectTailWithBuildStatus('failed');

      expect(selectedIndex).toBe(ALL_STEPS.findIndex((step) => step.name === 'build'));
    });

    it('selects the originally-unsatisfied gate once its prerequisite is fresh', async () => {
      const selectedIndex = await selectTailWithBuildStatus('done');

      expect(selectedIndex).toBe(ALL_STEPS.findIndex((step) => step.name === 'wiring_check'));
    });
  });
});
