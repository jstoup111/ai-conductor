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

function trackingRunner(): { runner: StepRunner; log: string[] } {
  const log: string[] = [];
  const runner: StepRunner = {
    run: async (step: StepName) => {
      log.push(`run:${step}`);
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
      const { runner, log } = trackingRunner();
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
      const { runner } = trackingRunner();
      const started: StepName[] = [];
      events.on('step_started', (e: { step: StepName }) => started.push(e.step));

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

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });

      await expect(conductor.run()).resolves.not.toThrow();
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('a missing .pipeline/gates directory does not throw and still starts at build', async () => {
      await seed532Fixture();
      await rm(join(dir, '.pipeline', 'gates'), { recursive: true, force: true });

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });

      await expect(conductor.run()).resolves.not.toThrow();
      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('an explicit --from-step finish is exempt from the resume clamp', async () => {
      await seed532Fixture();
      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events,
        fromStep: 'finish',
      });

      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
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

      const { runner, log } = trackingRunner();
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

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build');
    });

    it('finish marked in_progress with ALL verdicts satisfied resumes at finish (clamp no-op)', async () => {
      const seed = seedDoneThrough('finish');
      seed.finish = 'in_progress';
      await writeState(statePath, seed as ConductState);
      for (const name of ['build', 'build_review', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'retro', 'rebase'] as StepName[]) {
        await writeVerdict(dir, name, { satisfied: true, checkedAt: 1 });
      }

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
    });
  });

  // ── Story 3: post-rebase kickback verdicts are honored on resume ──────────
  describe('Story 3: post-rebase kickback verdicts steer the resume entry', () => {
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

      const { runner, log } = trackingRunner();
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

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:manual_test');
    });

    it('a stale step is selected even though its own verdict still says satisfied', async () => {
      const seed = seedDoneThrough('build');
      seed.build = 'done';
      seed.build_review = 'stale';
      seed.rebase = 'done';
      await writeState(statePath, seed as ConductState);
      await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
      // Stale but the on-disk verdict lies and says satisfied — state must win.
      await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
      await writeVerdict(dir, 'rebase', { satisfied: true, checkedAt: 1 });

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:build_review');
    });

    it('an unsatisfied verdict on a step before regionStart is ignored by the clamp', async () => {
      const seed = seedDoneThrough('finish');
      await writeState(statePath, seed as ConductState);
      // 'explore' precedes regionStart (the first kickback target, 'prd') —
      // a stray unsatisfied verdict there must not affect the resume entry.
      await writeVerdict(dir, 'explore', { satisfied: false, checkedAt: 1 });

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
    });
  });

  // ── Story 4: all-satisfied resumes fast-forward unchanged (regression) ────
  describe('Story 4: parity with pre-fix state-only derivation', () => {
    it('fully satisfied verdicts resume at finish, identical to today', async () => {
      const seed = seedDoneThrough('finish');
      await writeState(statePath, seed as ConductState);
      for (const name of ['build', 'build_review', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'retro', 'rebase'] as StepName[]) {
        await writeVerdict(dir, name, { satisfied: true, checkedAt: 1 });
      }

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
    });

    it('a fresh dispatch (DECIDE done, no verdicts) resumes at acceptance_specs', async () => {
      const seed = seedDoneThrough('acceptance_specs');
      await writeState(statePath, seed as ConductState);

      const { runner, log } = trackingRunner();
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

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:architecture_review');
    });

    it('skipped tier-S loop steps without verdicts do not attract the clamp', async () => {
      const seed: Record<string, unknown> = { complexity_tier: 'S' };
      for (const s of ALL_STEPS) {
        if (s.name === 'finish') break;
        seed[s.name] = s.skippableForTiers.includes('S') ? 'skipped' : 'done';
      }
      await writeState(statePath, seed as ConductState);

      const { runner, log } = trackingRunner();
      const conductor = new Conductor({
        projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, resume: true,
      });
      await conductor.run();

      expect(log.find((e) => e.startsWith('run:'))).toBe('run:finish');
    });
  });
});
