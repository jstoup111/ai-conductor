import { describe, it, expect, vi } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for `.docs/stories/manual-test-auto-mode-marker-record.md`
// (intake jstoup111/ai-conductor#385,
// `adr-2026-07-21-manual-test-auto-mode-marker-record.md`, D1-D4).
//
// Pre-implementation: `manual-test-record` is not wired into `src/index.ts`'s
// dispatch chain, `manual-test-record-cli.ts` does not exist, and
// `CUSTOM_COMPLETION_PREDICATES.manual_test` (artifacts.ts) has no SKIP-sentinel
// branch — a fresh SKIP write is indistinguishable from "no results recorded"
// and the daemon HALTs on it today. Every test below is RED because of that
// missing wiring/recognition, not an import error or a typo.
//
// Per §3a/§3b of writing-system-tests: the CLI's own argument-validation matrix
// (missing --reason, missing --pipeline-dir, unwritable dir, non-existent
// --results path, empty payload, --skip+--results mutual exclusion) is
// single-operation/unit-level behavior over `detectManualTestRecordCommand` /
// `dispatchManualTestRecord`, written task-by-task during `/pipeline` in
// `test/engine/manual-test-record-cli.test.ts` (plan Tasks 2-5) — NOT
// duplicated here. This file drives the REAL `bin/conduct-ts` binary (spawned
// as a genuine child process, mirroring `finish-record-real-binary.acceptance
// .test.ts`) and the REAL `Conductor.run()` entry point (mirroring
// `daemon-mode-route-halt-user-input-required-through.acceptance.test.ts`) —
// the two places the story's "no HALT" outcome and "argv actually dispatches"
// wiring can only be proven end-to-end, never by a unit calling the CLI
// dispatch functions or the predicate in-process:
//
//   A. `manual-test-record --skip` reaches the real binary, appends a fresh
//      Attempt 1 SKIP section carrying the verbatim reason, and exits 0
//      (Story 1 happy path 1).
//   B. a second `--skip` run appends Attempt 2 and leaves Attempt 1
//      byte-for-byte intact (Story 1 happy path 2 — append, never overwrite).
//   C. `manual-test-record --results <path>` appends the supplied rows
//      verbatim as a new Attempt section and exits 0 (Story 2 happy path 1).
//   D. a no-endpoint/UI feature's `manual_test` step records `--skip` via the
//      REAL CLI from inside the daemon's own `StepRunner` dispatch, and the
//      daemon accepts it as done on attempt 1 with no retry, no build
//      kickback, and no `.pipeline/halt-user-input-required` marker written
//      (Story "no-endpoint/UI feature completes manual_test in daemon mode
//      without a HALT", #385 integration outcome).
//
// Deliberately left to unit-level `/pipeline` TDD, not duplicated here:
//   - The full CLI negative-path matrix (missing --reason, missing
//     --pipeline-dir, unwritable dir/atomic-rename failure, empty --results
//     payload, non-existent --results path, --skip+--results mutual
//     exclusion) — single-helper argv/filesystem edge cases over one
//     function, the canonical §3a exclusion. A mutual-exclusion smoke was
//     deliberately NOT added here: today, with the subcommand entirely
//     unwired, `--skip --results` together already exits non-zero via the
//     unrelated top-level "unrecognized command" fallback — the assertion
//     would pass for the wrong reason both before and after real mutex
//     validation exists, so it proves nothing and belongs solely to the
//     unit-level parser test.
//   - The completion-predicate's four SKIP cases (fresh/stale/SKIP+FAIL/
//     missing-file) — `checkStepCompletion` unit tests pin these directly
//     (plan Task 7), no daemon dispatch needed to observe them.
//   - The #367 whitewash-guard regression with SKIP sections present — this
//     is already covered byte-for-byte by the pre-existing
//     `conductor.test.ts` FAIL→build kickback and "does NOT kick back on a
//     non-FAIL gate miss" tests (Story 4's negatives); generating a duplicate
//     here would pass by accident against unchanged code, not prove
//     anything new.
//   - `buildRetryHint`'s manual_test branch and the S-tier `skippableForTiers`
//     selector change — single-function-in-isolation behavior with existing
//     unit-test conventions (`selector.test.ts`), not a cross-module flow.
//   - The SKIP sentinel's exact literal token/format — the ADR (D2) commits
//     only to "a fixed, machine-recognizable marker line", not a literal
//     string; asserting a guessed token would freeze an unconfirmed
//     implementation detail (plan Task 1) into a spec. This file drives the
//     real CLI/predicate instead of hand-writing the sentinel text.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const SKIP_REASON = 'no endpoint/UI stories';

describe('conduct-ts manual-test-record — real-binary acceptance smoke', () => {
  it(
    '--skip appends a fresh Attempt 1 section with the verbatim reason and exits 0',
    async () => {
      const scratchParent = await mkdtemp(join(tmpdir(), 'manual-test-record-real-binary-'));
      try {
        const cwd = await mkdtemp(join(scratchParent, 'repo-'));
        const pipelineDir = await mkdtemp(join(scratchParent, 'pipeline-'));

        const result = await execa(
          REAL_CONDUCT_TS,
          ['manual-test-record', '--skip', '--reason', SKIP_REASON, '--pipeline-dir', pipelineDir],
          { cwd, reject: false },
        );

        expect(result.exitCode).toBe(0);
        const marker = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
        expect(marker).toMatch(/## Attempt 1/);
        expect(marker).toContain(SKIP_REASON);
      } finally {
        await rm(scratchParent, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    'a second --skip run appends Attempt 2 and leaves Attempt 1 byte-for-byte intact',
    async () => {
      const scratchParent = await mkdtemp(join(tmpdir(), 'manual-test-record-append-'));
      try {
        const cwd = await mkdtemp(join(scratchParent, 'repo-'));
        const pipelineDir = await mkdtemp(join(scratchParent, 'pipeline-'));

        const first = await execa(
          REAL_CONDUCT_TS,
          ['manual-test-record', '--skip', '--reason', SKIP_REASON, '--pipeline-dir', pipelineDir],
          { cwd, reject: false },
        );
        expect(first.exitCode).toBe(0);
        const afterFirst = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');

        const second = await execa(
          REAL_CONDUCT_TS,
          [
            'manual-test-record',
            '--skip',
            '--reason',
            'no endpoint/UI stories — re-run',
            '--pipeline-dir',
            pipelineDir,
          ],
          { cwd, reject: false },
        );
        expect(second.exitCode).toBe(0);
        const afterSecond = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');

        expect(afterSecond.startsWith(afterFirst)).toBe(true);
        expect(afterSecond).toMatch(/## Attempt 2/);
      } finally {
        await rm(scratchParent, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    '--results <path> appends the supplied rows verbatim as a new Attempt section and exits 0',
    async () => {
      const scratchParent = await mkdtemp(join(tmpdir(), 'manual-test-record-results-'));
      try {
        const cwd = await mkdtemp(join(scratchParent, 'repo-'));
        const pipelineDir = await mkdtemp(join(scratchParent, 'pipeline-'));
        const resultsPath = join(scratchParent, 'results.md');
        const rows = '| Story | Result |\n|--|--|\n| link-lifecycle | PASS |\n';
        await writeFile(resultsPath, rows, 'utf-8');

        const result = await execa(
          REAL_CONDUCT_TS,
          ['manual-test-record', '--results', resultsPath, '--pipeline-dir', pipelineDir],
          { cwd, reject: false },
        );

        expect(result.exitCode).toBe(0);
        const marker = await readFile(join(pipelineDir, 'manual-test-results.md'), 'utf-8');
        expect(marker).toMatch(/## Attempt 1/);
        expect(marker).toContain('| link-lifecycle | PASS |');
      } finally {
        await rm(scratchParent, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe('daemon auto-mode manual_test — SKIP clears the gate without a HALT (#385)', () => {
  async function seedToManualTest(dir: string, statePath: string): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    let seenManualTest = false;
    for (const s of ALL_STEPS) {
      if (s.name === 'manual_test') {
        seenManualTest = true;
        continue;
      }
      state[s.name] = seenManualTest ? 'skipped' : 'done';
    }
    state.complexity_tier = 'M';
    state.track = 'technical';
    state.feature_desc = 'manual-test-auto-mode-marker-record';
    state.build_review = 'skipped';
    // `prd_audit` skips via skippableForTracks: ['technical'] above. But
    // `architecture_review_as_built` (the validation group's third member,
    // alongside manual_test/prd_audit) only skips via its OWN tier ('S') or
    // `skipWhenSkipped: 'architecture_review'` (steps.ts ~223) — tier M and a
    // 'done' upstream `architecture_review` (set generically 'done' by the
    // loop above) leave it dispatchable, which would widen the validation
    // group to 3 members and HALT on the stub runner's missing as-built
    // review artifact. Mark `architecture_review` 'skipped' explicitly so
    // resolveGroupMembership's upstream-skip check narrows the group to the
    // single manual_test branch this test actually exercises.
    state.architecture_review = 'skipped';
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
  }

  it(
    'a no-endpoint feature records --skip via the real CLI in the manual_test step and the daemon advances with no retry, no build kickback, and no halt-user-input-required marker',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'manual-test-skip-daemon-'));
      try {
        const statePath = join(dir, 'conduct-state.json');
        await seedToManualTest(dir, statePath);

        const calls: StepName[] = [];
        const runner: StepRunner = {
          run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
            calls.push(step);
            if (step === 'manual_test') {
              const pipelineDir = join(dir, '.pipeline');
              const result = await execa(
                REAL_CONDUCT_TS,
                ['manual-test-record', '--skip', '--reason', SKIP_REASON, '--pipeline-dir', pipelineDir],
                { cwd: dir, reject: false },
              );
              if (result.exitCode !== 0) {
                throw new Error(`manual-test-record --skip failed: ${result.stderr}`);
              }
            }
            return { success: true };
          }),
        };

        const events = new ConductorEventEmitter();
        const conductor = new Conductor({
          stateFilePath: statePath,
          stepRunner: runner,
          events,
          projectRoot: dir,
          mode: 'auto',
          daemon: true,
          verifyArtifacts: true,
          maxRetries: 1,
          fromStep: 'manual_test',
        });

        await conductor.run();

        expect(calls.filter((s) => s === 'manual_test')).toHaveLength(1);
        expect(calls.filter((s) => s === 'build')).toHaveLength(0);

        await expect(
          readFile(join(dir, '.pipeline/halt-user-input-required'), 'utf-8'),
        ).rejects.toThrow();
        await expect(readFile(join(dir, '.pipeline/HALT'), 'utf-8')).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    'a real FAIL row recorded via --results still fires the manual_test→build kickback, then HALTs on the no-op cycle (#367 regression, unchanged by the SKIP sentinel)',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'manual-test-fail-daemon-'));
      try {
        const statePath = join(dir, 'conduct-state.json');
        await seedToManualTest(dir, statePath);

        const calls: StepName[] = [];
        const kickbacks: Array<{ from: string; to: string }> = [];
        const events = new ConductorEventEmitter();
        events.on('kickback', (e) => {
          if (e.type === 'kickback') kickbacks.push({ from: e.from, to: e.to });
        });
        let halted = false;
        events.on('loop_halt', () => {
          halted = true;
        });

        const runner: StepRunner = {
          run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
            calls.push(step);
            if (step === 'build') {
              await mkdir(join(dir, '.pipeline'), { recursive: true });
              await writeFile(
                join(dir, '.pipeline/task-status.json'),
                JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
              );
            } else if (step === 'manual_test') {
              const scratchParent = await mkdtemp(join(tmpdir(), 'manual-test-fail-results-'));
              const resultsPath = join(scratchParent, 'results.md');
              const rows = '| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
              await writeFile(resultsPath, rows, 'utf-8');
              const pipelineDir = join(dir, '.pipeline');
              const result = await execa(
                REAL_CONDUCT_TS,
                ['manual-test-record', '--results', resultsPath, '--pipeline-dir', pipelineDir],
                { cwd: dir, reject: false },
              );
              await rm(scratchParent, { recursive: true, force: true });
              if (result.exitCode !== 0) {
                throw new Error(`manual-test-record --results failed: ${result.stderr}`);
              }
            }
            return { success: true };
          }),
        };

        const conductor = new Conductor({
          stateFilePath: statePath,
          stepRunner: runner,
          events,
          projectRoot: dir,
          mode: 'auto',
          daemon: true,
          verifyArtifacts: true,
          maxRetries: 1,
          fromStep: 'manual_test',
        });

        await conductor.run();

        // Same shape as conductor.test.ts's pre-existing #367 regression test:
        // one kickback to build, one HALT on the first no-op retry cycle — the
        // FAIL path must be completely unaffected by the new SKIP machinery.
        expect(kickbacks.filter((k) => k.from === 'manual_test' && k.to === 'build').length).toBe(1);
        expect(calls.filter((s) => s === 'build').length).toBe(1);
        expect(halted).toBe(true);
        const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
        expect(halt).toMatch(/kickback-to-build no-op/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    'no results recorded at all (marker file absent) still HALTs — the SKIP acceptance path did not make the predicate permissive on true omission',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'manual-test-omitted-daemon-'));
      try {
        const statePath = join(dir, 'conduct-state.json');
        await seedToManualTest(dir, statePath);

        const calls: StepName[] = [];
        const kickbacks: string[] = [];
        const events = new ConductorEventEmitter();
        events.on('kickback', (e) => {
          if (e.type === 'kickback') kickbacks.push(e.to);
        });
        let halted = false;
        events.on('loop_halt', () => {
          halted = true;
        });

        // Deliberately does NOT call manual-test-record at all — no --skip,
        // no --results. `.pipeline/manual-test-results.md` never gets
        // written, so the gate must observe the "missing marker" case, not
        // the SKIP sentinel.
        const runner: StepRunner = {
          run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
            calls.push(step);
            return { success: true };
          }),
        };

        const conductor = new Conductor({
          stateFilePath: statePath,
          stepRunner: runner,
          events,
          projectRoot: dir,
          mode: 'auto',
          daemon: true,
          verifyArtifacts: true,
          maxRetries: 1,
          fromStep: 'manual_test',
        });

        await conductor.run();

        expect(halted).toBe(true);
        expect(kickbacks).toHaveLength(0);
        expect(calls.filter((s) => s === 'build')).toHaveLength(0);
        await expect(
          readFile(join(dir, '.pipeline/manual-test-results.md'), 'utf-8'),
        ).rejects.toThrow();
        const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
        expect(halt).toMatch(/step 'manual_test' failed/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
