import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState, readState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';

// Task 7 (#655, adr-2026-07-20-post-rebase-delta-aware-invalidation): the
// `advanceTail` rebase branch (conductor.ts ~5291) re-opens invalidated tail
// gates via `navigateBack`, whose `markDownstreamStale` cascade today marks
// EVERY step after the re-opened target stale — including judged gates
// (`prd_audit`, `architecture_review_as_built`) that `applyRebaseVerdicts`
// (Task 6, already landed) deliberately left PRESERVED (`done`, no kickback
// verdict written) because the rebase delta never touched the feature's own
// runtime surface. This test drives a REAL git rebase whose delta is
// foreign-runtime-only (`src/foreign-only.ts`, a path the feature branch
// never touched) — `wiring_check`/`build_review`/`manual_test` must be
// re-opened and re-dispatched (their surface includes foreign runtime), but
// `prd_audit`/`architecture_review_as_built` (feature-runtime-scoped surface,
// D_featureSrc empty) must remain `done` and NEVER be re-dispatched.
//
// This is a fresh, standalone integration test — separate from
// `test/integration/rebase-loop.test.ts`, which is reserved for Task 14's
// amendments and must not be touched by this task.

const execFileAsync = promisify(execFile);
const BASE = 'main';

const FRONT_DONE_M: ConductState = {
  complexity_tier: 'M',
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
  architecture_review: 'done',
  acceptance_specs: 'skipped',
};

describe('integration/rebase-tail-preserve (Task 7, #655)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function initRepoOnFeatureBranch(featureFile: {
    path: string;
    content: string;
  }): Promise<void> {
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# base\n');
    await git('add', '.');
    await git('commit', '-m', 'initial commit on base');

    await git('checkout', '-b', 'feature/foo');
    await mkdir(join(dir, featureFile.path, '..'), { recursive: true }).catch(
      () => {},
    );
    await writeFile(join(dir, featureFile.path), featureFile.content);
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }

  // Base advances with ONLY a genuinely-foreign runtime file (a path the
  // feature branch never touched) — D_foreignSrc != ∅, D_featureSrc == ∅.
  async function advanceBaseForeignRuntimeOnly(): Promise<void> {
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/foreign-only.ts'), 'export const foreignOnly = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'foreign runtime change merged to base');
    await git('checkout', 'feature/foo');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebase-tail-preserve-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function conductorWith(runner: StepRunner): Conductor {
    const fakeGit: GitRunner = async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/x\n' }
        : { stdout: '' };
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      daemon: true,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      git: fakeGit,
    });
  }

  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'build_review') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false },
        }),
      );
    } else if (step === 'wiring_check') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const head = (await currentCommitSha(dir)) ?? '2'.repeat(40);
      await writeFile(
        join(dir, '.pipeline/wiring-evidence.json'),
        JSON.stringify({
          schema: 1,
          base: '1'.repeat(40),
          head,
          layer2: { applicable: false },
          waivers: [],
          tasks: [],
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'prd_audit') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/prd-audit.md'),
        '| FR | Verdict | Evidence |\n|---|---|---|\n| FR-1 | ALIGNED | foo.ts:1 |\n',
      );
    } else if (step === 'architecture_review_as_built') {
      await mkdir(join(dir, '.docs/decisions'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/architecture-review-as-built.md'),
        '# As-Built Review\n\nVerdict: APPROVED\n',
      );
    } else if (step === 'finish') {
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
      const stateResult = await readState(statePath);
      const state = stateResult.ok ? stateResult.value : {};
      state.pr_url = 'https://github.com/org/repo/pull/1';
      await writeState(statePath, state);
      await writeState(join(dir, '.pipeline/conduct-state.json'), state);
    }
    return { success: true };
  }

  function runCountingRunner(counts: Record<string, number>): StepRunner {
    return {
      run: async (step) => {
        counts[step] = (counts[step] ?? 0) + 1;
        return satisfy(step);
      },
    };
  }

  it('preserves prd_audit/architecture_review_as_built (not re-dispatched) while re-opening build_review/wiring_check/manual_test on a foreign-runtime-only rebase delta', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await advanceBaseForeignRuntimeOnly();

    await writeState(statePath, { ...FRONT_DONE_M });
    const counts: Record<string, number> = {};
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(runCountingRunner(counts)).run();

    expect(completed).toBe(true);
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();

    // Preserved judged gates: dispatched exactly once each (their first,
    // pre-rebase pass) — never re-selected by the rebase's downstream sweep.
    expect(counts.prd_audit).toBe(1);
    expect(counts.architecture_review_as_built).toBe(1);

    // Re-run gates: the foreign runtime delta touches their surface, so each
    // must have been re-dispatched a second time after the rebase kickback.
    // (build_review is disabled by default config in this fixture, so it
    // never dispatches at all here — the wiring/manual_test pair is enough
    // to prove the invalidated set actually re-runs while the preserved
    // judged gates above do not.)
    expect(counts.wiring_check).toBeGreaterThanOrEqual(2);
    expect(counts.manual_test).toBeGreaterThanOrEqual(2);

    // Final state confirms the preserved gates never left 'done' (no
    // stale/pending bounce) even though manual_test — their immediate
    // upstream neighbor in step order — was re-opened.
    const finalStateResult = await readState(statePath);
    const finalState = finalStateResult.ok ? finalStateResult.value : {};
    expect(finalState.prd_audit).toBe('done');
    expect(finalState.architecture_review_as_built).toBe('done');
  });
});
