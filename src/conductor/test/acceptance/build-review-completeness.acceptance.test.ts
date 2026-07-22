/**
 * Acceptance spec for #773 (Task 9) — ".docs/stories/demote-task-stamping-to-telemetry.md"
 * Story "build_review gains a default-on completeness rubric item" +
 * "Grader judges plan-vs-diff completeness holistically" +
 * "A completeness FAIL kicks back to build via build_review's self-heal", plus
 * ".docs/decisions/adr-2026-07-21-completeness-as-build-review-rubric.md".
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the story's completion claim only holds if
 * TWO independent seams wire together at `Conductor.run()`'s gate loop, which
 * neither seam's own unit test can prove in isolation:
 *   (a) the build_review step must actually DISPATCH with no per-project
 *       `build_review.enabled` opt-in (today `DEFAULT_BUILD_REVIEW_ENABLED =
 *       false` in resolved-config.ts marks the step `skipped` before the
 *       grader ever runs), AND
 *   (b) a completeness-driven FAIL verdict must reuse the existing
 *       build_review→build kickback (conductor.ts ~4289-4370) rather than
 *       being masked by a stale/forged `task-status.json` row.
 * A test that calls `buildGraderPrompt` or `validateBuildReviewVerdict`
 * directly (unit-covered by build-review-prompt.test.ts /
 * build-review-completeness.test.ts) cannot observe either seam — only a
 * real `Conductor.run()` pass proves the wiring.
 *
 * PRE-IMPLEMENTATION RED: as of this file's authoring, `build-review-prompt.ts`
 * has no completeness rubric item (only tautology/scope/rootCause exist) and
 * `DEFAULT_BUILD_REVIEW_ENABLED` is `false` (Tasks 2-8 of the plan have not
 * landed). This spec fakes the grader's dispatch (writing
 * `.pipeline/build-review.json` directly, the same convention
 * `merged-pr-guard-kickback.test.ts`'s `failingBuildReviewRunner` uses) so it
 * is red for the right reason: build_review never dispatches by default
 * today (Task 4 not yet default-on) and, even once forced to dispatch here,
 * the point under test — that a `Task:`-stamped-but-incomplete row does not
 * substitute for a passing completeness verdict — has no production wiring
 * to lean on yet either.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult, StepName } from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';

const BUILD_REVIEW_VERDICT_PATH = '.pipeline/build-review.json';

async function seedToBuildReview(statePath: string, dir: string): Promise<void> {
  const state: Record<string, unknown> = {};
  // Break BEFORE 'build' (not 'build_review'): 'build' must actually DISPATCH
  // through the fake runner so that `advanceTail`'s gate-driven-tail skip
  // scan (conductor.ts ~5594-5610, the `buildReviewEnabled` check) actually
  // runs at least once before build_review's turn. If 'build' were pre-seeded
  // 'done' like every earlier step, the main loop would `continue` past it
  // without ever invoking `advanceTail`, and build_review's default-on skip
  // mark would never get a chance to fire — silently defeating the very
  // default-on assertion this spec makes.
  for (const s of ALL_STEPS) {
    if (s.name === 'build') break;
    state[s.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = 'demote-stamp-completeness-fixture';
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  // A stamp claiming task 2 complete — a `Task: 2` trailer would have
  // produced exactly this row under the OLD (deleted) derivation. The
  // completeness rubric must not defer to it.
  await writeFile(
    join(dir, '.pipeline/task-status.json'),
    JSON.stringify({
      tasks: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'completed' },
      ],
    }),
  );
}

function makeRunner(dir: string): { runner: StepRunner; calls: StepName[] } {
  const calls: StepName[] = [];
  let buildReviewCallCount = 0;
  const runner: StepRunner = {
    run: async (step: StepName): Promise<StepRunResult> => {
      calls.push(step);
      if (step === 'build_review') {
        buildReviewCallCount += 1;
        if (buildReviewCallCount === 1) {
          // First grading pass: task 2's row claims 'completed' (stamped),
          // but its actual work is absent from the diff — the completeness
          // item must FAIL regardless of the stamp.
          await writeFile(
            join(dir, BUILD_REVIEW_VERDICT_PATH),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ["task 2's planned work is absent from the diff"],
              rubric: { tautology: true, scope: true, rootCause: true, completeness: false },
            }),
          );
        } else {
          // Second pass, after the kickback re-entered build and the missing
          // work was actually implemented: completeness now passes.
          await writeFile(
            join(dir, BUILD_REVIEW_VERDICT_PATH),
            JSON.stringify({
              verdict: 'PASS',
              reasons: [],
              rubric: { tautology: true, scope: true, rootCause: true, completeness: true },
            }),
          );
        }
        return { success: true };
      }
      if (step === 'build') {
        // Simulates implementing the missing work on the kickback re-entry;
        // task-status.json already claims both tasks 'completed' throughout
        // (the stamp never changes) — only the diff/verdict changes.
        return { success: true };
      }
      if (step === 'manual_test') {
        await writeFile(
          join(dir, '.pipeline/manual-test-results.md'),
          '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
        );
        return { success: true };
      }
      return { success: true };
    },
  };
  return { runner, calls };
}

describe('acceptance: build_review completeness gates a missing planned task end-to-end (#773 Task 9)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('default-on with no build_review opt-in: a Task-stamped-but-unimplemented task still FAILs completeness, kicks back to build, and only reaches done once the work lands', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-completeness-'));
    const statePath = join(dir, 'conduct-state.json');
    await seedToBuildReview(statePath, dir);

    const { runner, calls } = makeRunner(dir);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      // Deliberately NOT `fromStep: 'build_review'` — that flag forces
      // dispatch of its target step regardless of the config-driven skip
      // mark (conductor.ts's `explicitlyTargeted` escape hatch), which would
      // defeat the very default-on assertion this spec makes. Every step
      // before build_review is already seeded 'done', so the natural walk
      // from index 0 reaches build_review exactly as a real run would.
      maxRetries: 2,
      // Deliberately no `config` / build_review opt-in block — the
      // completeness dimension must run BY DEFAULT (no per-project
      // enablement), per "build_review gains a default-on completeness
      // rubric item".
    } as never);

    await conductor.run();

    // (1) Default-on: build_review must have actually dispatched at least
    // once — not been marked 'skipped' by DEFAULT_BUILD_REVIEW_ENABLED=false
    // before the grader ever ran.
    expect(calls.filter((s) => s === 'build_review').length).toBeGreaterThanOrEqual(1);

    // (2) The completeness FAIL — despite task 2's stamp claiming
    // 'completed' the whole time — kicked back to build at least once (no
    // stamp inference substitutes for the grader's own judgement).
    expect(calls.filter((s) => s === 'build').length).toBeGreaterThanOrEqual(1);

    // (3) Only once the second (PASS) verdict was written does the run
    // proceed past build_review to done.
    expect(calls.filter((s) => s === 'build_review').length).toBeGreaterThanOrEqual(2);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build_review).toBe('done');
    }
    const finalVerdict = JSON.parse(
      await readFile(join(dir, BUILD_REVIEW_VERDICT_PATH), 'utf-8'),
    ) as { verdict: string; rubric: { completeness?: boolean } };
    expect(finalVerdict.verdict).toBe('PASS');
    expect(finalVerdict.rubric.completeness).toBe(true);
  });

  it('negative: a completeness FAIL under the kickback cap never marks build_review done off a stale/forged stamp alone', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-completeness-neg-'));
    const statePath = join(dir, 'conduct-state.json');
    await seedToBuildReview(statePath, dir);

    // Every build_review dispatch FAILs completeness — the work is never
    // actually implemented, only the stamp claims completion.
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build_review') {
          await writeFile(
            join(dir, BUILD_REVIEW_VERDICT_PATH),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ["task 2's planned work is still absent from the diff"],
              rubric: { tautology: true, scope: true, rootCause: true, completeness: false },
            }),
          );
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
    } as never);

    await conductor.run();

    // The negative claim only holds if build_review actually dispatched (and
    // FAILed on its own merits) rather than being skipped by
    // DEFAULT_BUILD_REVIEW_ENABLED=false — a skip would trivially satisfy
    // "not done" for the wrong reason.
    expect(calls.filter((s) => s === 'build_review').length).toBeGreaterThanOrEqual(1);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build_review).not.toBe('done');
    }
  });
});
