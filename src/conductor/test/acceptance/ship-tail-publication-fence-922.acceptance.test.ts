import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// Acceptance coverage for .docs/stories/ship-tail-parallel-validation-serial-
// publication-922.md. This drives Conductor.run() through explicit finish
// targeting: the #532 resume clamp is intentionally bypassed, but publication
// safety must not be.
describe('SHIP-tail publication fence (#922)', () => {
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

  it('re-enters failed and stale validators concurrently without rerunning a green manual test', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-parallel-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const manualResults = join(dir, '.pipeline/manual-test-results.md');
      await writeFile(
        manualResults,
        '# Results\n\n| Story | Result |\n|--|--|\n| #922 | PASS |\n',
      );
      // Conductor stamps a fresh session at startup. Keep this fixture's
      // already-complete manual run current for that invocation.
      await utimes(manualResults, new Date(), new Date(Date.now() + 60_000));
      await writeState(statePath, {
        complexity_tier: 'M',
        track: 'product',
        architecture_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        prd_audit: 'failed',
        architecture_review_as_built: 'stale',
        retro: 'skipped',
        rebase: 'done',
      } as ConductState);

      const timeline: Array<{ step: StepName; phase: 'start' | 'end'; at: number }> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          timeline.push({ step, phase: 'start', at: Date.now() });
          if (step === 'prd_audit') {
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
        expect.arrayContaining(['prd_audit', 'architecture_review_as_built']),
      );
      expect(timeline.map((entry) => entry.step)).not.toContain('manual_test');
      const prdAuditEnd = timeline.find(
        (entry) => entry.step === 'prd_audit' && entry.phase === 'end',
      );
      const asBuiltStart = timeline.find(
        (entry) => entry.step === 'architecture_review_as_built' && entry.phase === 'start',
      );
      expect(asBuiltStart?.at).toBeLessThan(prdAuditEnd?.at ?? 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves a persisted skipped validator while rerunning applicable validators', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-skipped-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const manualResults = join(dir, '.pipeline/manual-test-results.md');
      await writeFile(
        manualResults,
        '# Results\n\n| Story | Result |\n|--|--|\n| #922 | PASS |\n',
      );
      await utimes(manualResults, new Date(), new Date(Date.now() + 60_000));
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
