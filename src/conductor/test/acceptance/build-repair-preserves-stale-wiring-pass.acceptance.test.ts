/**
 * Acceptance coverage for TS-1: a deterministic BUILD-verification repair
 * must rejoin the whole verification round instead of stranding a previously
 * passing member behind a stale on-disk verdict.
 *
 * This drives the production Conductor.run entry point. The correctness-
 * critical call sites exercised are:
 * - src/engine/conductor.ts: deterministic BUILD group kickback/join
 * - src/engine/conductor.ts: advanceTail selection after the repaired build
 * - src/engine/gates.ts: build_review prerequisite admission
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('BUILD repair re-dispatches every verification member without stranding review', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('re-dispatches every member after a BUILD-verification repair before build_review', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-repair-stale-wiring-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });

    const state: ConductState = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'build-repair-preserves-stale-wiring-pass-and-halts',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'skipped',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      // Both members must be dispatchable so the first group round can kick
      // back to BUILD, then prove the repaired round re-dispatches both.
      wiring_check: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
    };
    await writeState(stateFilePath, state);
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
    );
    await writeVerdict(projectRoot, 'build', { satisfied: true, checkedAt: 1 });

    let buildRuns = 0;
    let reviewRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns += 1;
          return { success: true };
        }
        if (step === 'build_review') {
          reviewRuns += 1;
          await writeFile(
            join(projectRoot, '.pipeline', 'build-review.json'),
            JSON.stringify({
              verdict: 'PASS',
              reasons: [],
              rubric: { testQuality: false },
            }),
          );
          return { success: true };
        }
        if (step === 'manual_test') {
          return { success: false, output: 'expected acceptance boundary after build_review' };
        }
        throw new Error(`unexpected dispatch: ${step}`);
      },
    };

    const suiteOutcomes: string[] = [];
    const ensure = vi.fn(async () => {
      if (suiteOutcomes.length === 0) {
        suiteOutcomes.push('INDETERMINATE');
        return {
          status: 'INDETERMINATE',
          message: 'suite verifier returned no verdict',
        } as never;
      }
      suiteOutcomes.push('REUSED');
      return { status: 'REUSED', evidence: {} as never } as const;
    });
    const events = new ConductorEventEmitter();
    const parallelRounds: StepName[][] = [];
    const blocked: Array<{ step: StepName; reason: string }> = [];
    events.on('parallel_started', (event) => {
      if (event.type === 'parallel_started') {
        parallelRounds.push(event.branches as StepName[]);
      }
    });
    events.on('gate_blocked', (event) => {
      if (event.type === 'gate_blocked') blocked.push({ step: event.step, reason: event.reason });
    });

    const fakeGit = async (): Promise<{ stdout: string }> => ({ stdout: '' });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'wiring_check',
      verifyArtifacts: true,
      maxRetries: 1,
      config: { validation_concurrency: 2, build_review: { enabled: true } },
      git: fakeGit,
      fullSuiteVerifier: {
        ensure,
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
      escalateBuildFailure: async () => ({}),
    });

    await conductor.run();

    // wiring_check is a deprecated no-op that settles in-process, so it never
    // reaches the runner in either round — the runner's `unexpected dispatch`
    // throw is the regression lock. Normal width-one reuse has dedicated
    // coverage in deterministic-build-verification-flow.acceptance.test.ts.
    // Repaired test_suite settles from its own content-addressed evidence;
    // a prior gate verdict is never the authority for this REUSED outcome.
    expect(suiteOutcomes).toEqual(['INDETERMINATE', 'REUSED']);
    expect(buildRuns).toBe(1);
    expect(reviewRuns).toBe(1);
    expect(parallelRounds.filter((round) =>
      round.includes('wiring_check') || round.includes('test_suite'),
    )).toEqual([
      ['wiring_check', 'test_suite'],
      ['wiring_check', 'test_suite'],
    ]);
    expect(blocked).not.toContainEqual(expect.objectContaining({ step: 'build_review' }));

    const haltPath = join(projectRoot, '.pipeline', 'HALT');
    if (await access(haltPath).then(() => true, () => false)) {
      const halt = await readFile(haltPath, 'utf-8');
      expect(halt).not.toMatch(/loop exited without a terminal verdict/i);
      expect(halt).not.toMatch(/Prerequisites not satisfied: wiring_check/i);
    }
  });
});
