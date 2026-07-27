import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

// Acceptance coverage for .docs/stories/ship-tail-parallel-validation-serial-
// publication-922.md. This drives Conductor.run() through explicit finish
// targeting: the #532 resume clamp is intentionally bypassed, but publication
// safety must not be.
describe('SHIP-tail publication fence (#922)', () => {
  function stateAtPublicationWithMissingAsBuiltEvidence(): ConductState {
    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    // These are legitimate skip policies: technical work has no PRD audit,
    // and this fixture explicitly disables manual validation.
    state.manual_test = 'skipped';
    state.prd_audit = 'skipped';
    // State completion alone is not publication evidence: deliberately omit the
    // as-built review artifact so only the finish fence can detect the gap.
    state.architecture_review_as_built = 'done';
    return state as ConductState;
  }

  function asBuiltPassingRunner(dir: string): { runner: StepRunner; dispatched: StepName[] } {
    const dispatched: StepName[] = [];
    return {
      dispatched,
      runner: {
        run: vi.fn(async (step: StepName) => {
          dispatched.push(step);
          if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '**Verdict:** APPROVED\n',
            );
          }
          return { success: true };
        }),
      },
    };
  }

  it('normal traversal lets the finish fence rerun a validator with missing evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-normal-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, stateAtPublicationWithMissingAsBuiltEvidence());
      const { runner, dispatched } = asBuiltPassingRunner(dir);
      const events = new ConductorEventEmitter();
      const kickbacks: Array<{ from: StepName; to: StepName }> = [];
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
      });

      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        daemon: true,
        mode: 'auto',
        config: { steps: { manual_test: { disable: true } } },
      }).run();

      expect(kickbacks).toContainEqual({ from: 'finish', to: 'architecture_review_as_built' });
      expect(dispatched.indexOf('architecture_review_as_built')).toBeLessThan(
        dispatched.indexOf('finish'),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resume lets the finish fence rerun a validator with missing evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-resume-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const state = stateAtPublicationWithMissingAsBuiltEvidence();
      state.last_step = 'finish';
      await writeState(statePath, state);
      const { runner, dispatched } = asBuiltPassingRunner(dir);
      const events = new ConductorEventEmitter();
      const kickbacks: Array<{ from: StepName; to: StepName }> = [];
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
      });

      await new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        daemon: true,
        mode: 'auto',
        resume: true,
        config: { steps: { manual_test: { disable: true } } },
      }).run();

      expect(kickbacks).toContainEqual({ from: 'finish', to: 'architecture_review_as_built' });
      expect(dispatched.indexOf('architecture_review_as_built')).toBeLessThan(
        dispatched.indexOf('finish'),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not dispatch finish when explicit targeting reaches an already-done rebase with failed or stale validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, {
        complexity_tier: 'M',
        track: 'product',
        architecture_review: 'done',
        manual_test: 'done',
        prd_audit: 'failed',
        architecture_review_as_built: 'stale',
        retro: 'skipped',
        rebase: 'done',
      } as ConductState);

      const run = vi.fn(async (_step: StepName) => ({ success: true }));
      const runner: StepRunner = { run };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        daemon: true,
        mode: 'auto',
        fromStep: 'finish',
        maxRetries: 1,
      });

      await conductor.run();

      expect(run.mock.calls.map(([step]) => step)).not.toContain('finish');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('re-enters stale validators concurrently and publishes only after their active-run evidence is green', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-parallel-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, {
        complexity_tier: 'M',
        track: 'product',
        architecture_review: 'done',
        test_suite: 'done',
        manual_test: 'stale',
        prd_audit: 'failed',
        architecture_review_as_built: 'stale',
        retro: 'skipped',
        rebase: 'done',
      } as ConductState);

      const timeline: Array<{ step: StepName; phase: 'start' | 'end'; at: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          timeline.push({ step, phase: 'start', at: Date.now() });
          if (step === 'manual_test') {
            await writeFile(
              join(dir, '.pipeline/manual-test-results.md'),
              '# Results\n\n| Story | Result |\n|--|--|\n| #922 | PASS |\n',
            );
          } else if (step === 'prd_audit') {
            await new Promise((resolve) => setTimeout(resolve, 40));
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | src/fence.ts:1 |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
            );
          }
          timeline.push({ step, phase: 'end', at: Date.now() });
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        daemon: true,
        mode: 'auto',
        fromStep: 'finish',
        maxRetries: 1,
      });

      await conductor.run();

      expect(timeline.map((entry) => entry.step)).toEqual(
        expect.arrayContaining(['manual_test', 'prd_audit', 'architecture_review_as_built']),
      );
      const prdAuditEnd = timeline.find(
        (entry) => entry.step === 'prd_audit' && entry.phase === 'end',
      );
      const asBuiltStart = timeline.find(
        (entry) => entry.step === 'architecture_review_as_built' && entry.phase === 'start',
      );
      const finishStart = timeline.find(
        (entry) => entry.step === 'finish' && entry.phase === 'start',
      );
      expect(asBuiltStart?.at).toBeLessThan(prdAuditEnd?.at ?? 0);
      for (const validator of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
        const validatorEnd = timeline.find(
          (entry) => entry.step === validator && entry.phase === 'end',
        );
        expect(validatorEnd?.at).toBeLessThan(finishStart?.at ?? 0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves a persisted skipped validator while rerunning applicable validators', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-skipped-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, {
        complexity_tier: 'M',
        track: 'product',
        architecture_review: 'done',
        test_suite: 'done',
        manual_test: 'skipped',
        prd_audit: 'failed',
        architecture_review_as_built: 'stale',
        retro: 'skipped',
        rebase: 'done',
      } as ConductState);

      const dispatched: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          dispatched.push(step);
          if (step === 'prd_audit') {
            await writeFile(
              join(dir, '.pipeline/prd-audit.md'),
              '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | src/fence.ts:1 |\n',
            );
          } else if (step === 'architecture_review_as_built') {
            await writeFile(
              join(dir, '.pipeline/architecture-review-as-built.md'),
              '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
            );
          }
          return { success: true };
        }),
      };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        daemon: true,
        mode: 'auto',
        fromStep: 'finish',
        maxRetries: 1,
        config: { steps: { manual_test: { disable: true } } },
      });

      await conductor.run();

      expect(
        dispatched
          .filter((step) =>
            ['manual_test', 'prd_audit', 'architecture_review_as_built'].includes(step),
          )
          .sort(),
      ).toEqual(['architecture_review_as_built', 'prd_audit']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
