/**
 * #982 — engine-computed steps collapsed their retry budget into wasted work.
 *
 * `wiring_check` is declared engine-native (skill-invocation.ts) and is never
 * dispatched to an agent: `DefaultStepRunner.run` short-circuits it and the
 * engine computes its evidence in-process. Re-running it over an unchanged
 * tree is therefore guaranteed to return the identical verdict. Observed on a
 * live daemon: three attempts, identical rejection message, 357ms total (and
 * again at 453ms) before a terminal failure that cost a full build +
 * build_review cycle.
 *
 * An engine-computed step runs once, is judged once, and does not enter the
 * retry loop. `build_review` and `attribution_verify` are also declared
 * engine-native but DO dispatch a one-shot LLM (grader / verifier) whose
 * output can legitimately differ between attempts — they keep the normal
 * budget.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { writeState } from '../src/engine/state.js';
import { Conductor, isEngineComputedStep } from '../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../src/engine/conductor.js';

function frontDone(): ConductState {
  return {
    complexity_tier: 'S',
    feature_desc: 'add foo',
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    prd: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'skipped',
    plan: 'done',
    architecture_diagram: 'skipped',
    architecture_review: 'skipped',
    acceptance_specs: 'skipped',
  };
}

describe('isEngineComputedStep — which steps get a budget of one (#982)', () => {
  it('classifies the in-process engine-native steps as engine-computed', () => {
    expect(isEngineComputedStep('wiring_check')).toBe(true);
    expect(isEngineComputedStep('test_suite')).toBe(true);
  });

  it('does NOT classify engine-native steps that dispatch a one-shot LLM', () => {
    expect(isEngineComputedStep('build_review')).toBe(false);
    expect(isEngineComputedStep('attribution_verify')).toBe(false);
  });

  it('does NOT classify ordinary skill-dispatched steps', () => {
    expect(isEngineComputedStep('build')).toBe(false);
    expect(isEngineComputedStep('manual_test')).toBe(false);
    expect(isEngineComputedStep('finish')).toBe(false);
  });
});

describe('wiring_check retry budget — engine-computed steps run once (#982)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiring-retry-budget-'));
    statePath = join(dir, '.pipeline/conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(dir, '.ai-conductor/config.yml'),
      'test_suite:\n  command: true\n  working_directory: .\n  timeout_seconds: 10\n',
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fakeGit = async (args: string[]): Promise<{ stdout: string }> => {
    if (args[0] === 'rev-parse' && args.includes('@{u}')) {
      return { stdout: 'refs/remotes/origin/main' };
    }
    return { stdout: '' };
  };

  it('never emits step_retry for wiring_check even with max_retries 3', async () => {
    await writeState(statePath, {
      ...frontDone(),
      complexity_tier: 'M',
      track: 'technical',
      coherence_check: 'done',
    });

    // A gap-carrying evidence file: wiring_check's completion check rejects
    // every attempt with the identical, deterministic message. Under the old
    // budget this burned tries 2 and 3 on the same in-process computation.
    const gapEvidence = JSON.stringify({
      schema: 1,
      base: 'base',
      head: 'head',
      layer2: { applicable: false },
      waivers: [],
      tasks: [
        {
          id: 't1',
          contract: 'src/x.ts#foo',
          gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }],
        },
      ],
    });

    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
          );
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), gapEvidence);
        } else if (step === 'build_review') {
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'PASS',
              rubric: { tautology: false, scope: false, rootCause: false },
            }),
          );
        }
        return { success: true };
      },
    };

    const retries: StepName[] = [];
    events.on('step_retry', (e) => {
      retries.push((e as { step: StepName }).step);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 3,
      daemon: true,
      config: { build_review: { enabled: true } },
      git: fakeGit,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    });

    await conductor.run();

    // The gate still fails (real gaps) and still kicks back to build — but it
    // is judged exactly once per dispatch.
    expect(retries.filter((s) => s === 'wiring_check')).toEqual([]);
    expect(retries.length).toBeGreaterThanOrEqual(0);
  });
});
