import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import {
  performRebase,
  applyRebaseVerdicts,
  emitGateInvalidationEvents,
  makeGitRunner as makeRebaseGitRunner,
} from '../../src/engine/rebase.js';

// END-TO-END acceptance specs for the Phase 9.0 daemon rebase-on-latest step.
//
// These drive the REAL Conductor over a REAL git repo in a tmpdir. Git is core
// infrastructure here — we exercise it for real (NO `vi.mock('execa')`). The
// loop's tail steps (build/manual_test/finish) are satisfied by a mock
// StepRunner + per-step artifacts (the `satisfy()` helper), exactly like
// gate-loop.test.ts. We start the loop at `build` with complexity tier 'M' so
// the gate-driven tail runs manual_test (S-tier now legitimately skips
// manual_test per D5 — see steps.ts skippableForTiers):  build → manual_test →
// retro → [rebase, once implemented] → finish.
//
// The `rebase` loopGate step is NOT yet implemented, so the tail today is
// build → manual_test → finish with no rebase. Every assertion below encodes a
// behavior that only the rebase step produces, so each test fails on its
// behavioral assertion (RED), not on setup.

const execFileAsync = promisify(execFile);

// The branch the feature is forked from. We force `git init -b <BASE>` so the
// default-branch name is deterministic regardless of the host git config, and
// read it back where the production code is expected to discover it.
const BASE = 'main';

const FRONT_DONE: ConductState = {
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
  architecture_review: 'skipped',
  acceptance_specs: 'skipped',
};

// Tier 'M' with `architecture_review: 'done'` (not 'skipped') — needed so
// `architecture_review_as_built` (skippableForTiers: ['S'], skipWhenSkipped:
// 'architecture_review') actually dispatches. The #655 delta-aware specs
// below need BOTH judged audit gates (`prd_audit` and
// `architecture_review_as_built`) to genuinely run so preservation vs.
// re-run is observable, which FRONT_DONE's tier 'S' fixture cannot exercise.
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

describe('integration/rebase-loop', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  // Run a git command in the repo and return trimmed stdout.
  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  // Does the repo currently have a rebase paused mid-flight?
  async function rebaseInProgress(): Promise<boolean> {
    const a = await access(join(dir, '.git', 'rebase-merge')).then(
      () => true,
      () => false,
    );
    const b = await access(join(dir, '.git', 'rebase-apply')).then(
      () => true,
      () => false,
    );
    return a || b;
  }

  // Initialize a real git repo on BASE with an initial commit, then carve out
  // the feature branch with one feature commit. Returns to the feature branch.
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

    // Feature branch + a feature commit.
    await git('checkout', '-b', 'feature/foo');
    await mkdir(join(dir, featureFile.path, '..'), { recursive: true }).catch(
      () => {},
    );
    await writeFile(join(dir, featureFile.path), featureFile.content);
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }

  // Advance BASE with a NON-conflicting commit (a brand-new file). Leaves the
  // checkout back on the feature branch.
  async function advanceBaseNonConflicting(): Promise<string> {
    await git('checkout', BASE);
    await writeFile(join(dir, 'SIBLING.md'), '# merged sibling PR\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling PR merged to base');
    const sha = await git('rev-parse', 'HEAD');
    await git('checkout', 'feature/foo');
    return sha;
  }

  // Does the feature branch's history contain `sha`?
  async function branchContains(sha: string): Promise<boolean> {
    try {
      await execFileAsync('git', [
        '-C',
        dir,
        'merge-base',
        '--is-ancestor',
        sha,
        'feature/foo',
      ]);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebase-loop-'));
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
      // The native rebase-on-latest is a daemon finish-time mechanism; the
      // engine only invokes git for it under the daemon. These specs exercise
      // that real rebase against an isolated throwaway repo (`dir`), so they run
      // in daemon mode. Non-daemon runs no-op the step (see runRebaseStep).
      daemon: true,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      git: fakeGit,
    });
  }

  // Per-step artifact creation so each gate's objective verdict passes (matches
  // gate-loop.test.ts). The not-yet-existing `rebase` step is engine-native, so
  // no artifact is authored for it here.
  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'build_review') {
      // The build_review judgement gate's completion predicate requires a
      // fresh, valid PASS verdict at .pipeline/build-review.json (see
      // artifacts.ts BUILD_REVIEW_VERDICT), same fixture as gate-loop.test.ts.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false },
        }),
      );
    } else if (step === 'wiring_check') {
      // The wiring-reachability gate (Task 9) requires a fresh, valid,
      // zero-gap evidence artifact at .pipeline/wiring-evidence.json (see
      // WIRING_EVIDENCE/validateWiringEvidence in artifacts.ts). The
      // predicate compares evidence.head against ctx.getHeadSha(), which
      // shells out to `git rev-parse HEAD` in `dir` — resolve it
      // dynamically so it matches whatever HEAD the fixture's real repo is
      // actually at (these are real-git-repo suites throughout).
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
      // Also write to the path the gate reads from
      await writeState(join(dir, '.pipeline/conduct-state.json'), state);
    }
    return { success: true };
  }

  // A plain "satisfy every tail step once" runner.
  function passthroughRunner(ran: string[]): StepRunner {
    return {
      run: async (step) => {
        ran.push(step);
        return satisfy(step);
      },
    };
  }

  it('rebases the feature branch onto the advanced base before finish (FR-1/FR-2/FR-5)', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    const baseSha = await advanceBaseNonConflicting();
    // Sanity: pre-run, the feature branch does NOT yet contain the base commit.
    expect(await branchContains(baseSha)).toBe(false);

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    expect(completed).toBe(true);
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
    // The rebase step must have rebased feature/foo onto the advanced base, so
    // the base's new commit is now in the feature branch's ancestry.
    expect(await branchContains(baseSha)).toBe(true);
  });

  // ── Task 14 (RED, #535): both real call sites exercise translateAfterRebase ──
  //
  // Once Task 15 wires `performRebase` to invoke `translateAfterRebase(git,
  // projectRoot, onto, origHead, head)` on a `changed` outcome, BOTH funnel
  // sites — the finish-time `runRebaseStep` (via `Conductor.run`, exercised
  // here through `conductorWith`) and the daemon re-kick play-forward
  // `resumeRebaseFirst` — must invoke the SAME injected capability identically.
  // `performRebase` receives it via an optional 4th `opts` argument; each call
  // site plumbs it through similarly to how `resolveRebaseConflict` is already
  // threaded through `StepRunner`/`resumeRebaseFirst`'s options bag. Neither
  // site does this yet, so `translateAfterRebase` below is genuinely never
  // called today (RED).
  describe('Task 14: translateAfterRebase capability at both call sites', () => {
    it('runRebaseStep (finish-time, via Conductor.run) invokes translateAfterRebase on a changed rebase', async () => {
      await initRepoOnFeatureBranch({
        path: 'src/feature.ts',
        content: 'export const foo = 1;\n',
      });
      await advanceBaseNonConflicting();
      await writeState(statePath, { ...FRONT_DONE });

      const translateAfterRebase = vi.fn().mockResolvedValue(undefined);
      const ran: string[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          ran.push(step);
          return satisfy(step);
        },
        // Task 15's expected optional capability slot (mirrors
        // `resolveRebaseConflict`) — ignored by today's `runRebaseStep`.
        translateAfterRebase,
      } as unknown as StepRunner;

      await conductorWith(runner).run();

      expect(translateAfterRebase).toHaveBeenCalled();
    });

    it('resumeRebaseFirst (daemon re-kick, play-forward) invokes translateAfterRebase identically on a changed rebase', async () => {
      await initRepoOnFeatureBranch({
        path: 'src/feature.ts',
        content: 'export const foo = 1;\n',
      });
      await advanceBaseNonConflicting();

      const { resumeRebaseFirst, REKICK_SENTINEL } = await import(
        '../../src/engine/daemon-rekick.js'
      );
      await writeFile(join(dir, REKICK_SENTINEL), 'rekick\n', 'utf-8');

      const translateAfterRebase = vi.fn().mockResolvedValue(undefined);
      const res = await (resumeRebaseFirst as unknown as (opts: {
        worktreePath: string;
        localBase: string;
        events: ConductorEventEmitter;
        ranManualTest: boolean;
        translateAfterRebase?: typeof translateAfterRebase;
      }) => Promise<string>)({
        worktreePath: dir,
        localBase: BASE,
        events,
        ranManualTest: true,
        translateAfterRebase,
      });

      expect(res).toBe('rebased');
      expect(translateAfterRebase).toHaveBeenCalled();
    });
  });

  // Task 17/#773: the "#420: gate-first mechanical re-verify fixtures"
  // block (Story 1/2/3/4, Tasks 8-11) was removed — it tested
  // CUSTOM_COMPLETION_PREDICATES.build's mechanical git-evidence
  // confirmation, which was deleted along with the per-task evidence
  // gate (59e21fd5, dc2dacc0). Build is now unconditionally re-dispatched
  // on every rebase kickback; there is no mechanical skip path left to
  // pin.


  it('auto-resolves a CHANGELOG-only conflict keeping both entries exactly once (FR-7)', async () => {
    // Both base and branch append a DIFFERENT entry under ## [Unreleased] →
    // a rebase conflict confined to CHANGELOG.md.
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n',
    );
    await git('add', '.');
    await git('commit', '-m', 'changelog scaffold');

    // Feature branch adds its own entry.
    await git('checkout', '-b', 'feature/foo');
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature foo entry\n',
    );
    await git('add', '.');
    await git('commit', '-m', 'feature changelog');

    // Base advances with a sibling entry in the SAME spot.
    await git('checkout', BASE);
    await writeFile(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Sibling bar entry\n',
    );
    await git('add', '.');
    await git('commit', '-m', 'sibling changelog');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    expect(completed).toBe(true);
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();

    const changelog = await readFile(join(dir, 'CHANGELOG.md'), 'utf-8');
    // Both entries present, each exactly once; no conflict markers left behind.
    expect(changelog).toContain('- Feature foo entry');
    expect(changelog).toContain('- Sibling bar entry');
    expect(changelog.match(/- Feature foo entry/g)).toHaveLength(1);
    expect(changelog.match(/- Sibling bar entry/g)).toHaveLength(1);
    expect(changelog).not.toContain('<<<<<<<');
    expect(changelog).not.toContain('>>>>>>>');
  });

  it('HALTs (worktree kept, rebase paused, no PR) on a non-CHANGELOG conflict (FR-8)', async () => {
    // Base and branch modify the SAME source file differently → real conflict.
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial feature file');

    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch edits feature');

    await git('checkout', BASE);
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base edits feature');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    let halted = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_halt', () => {
      halted = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    // Park for a human: HALT written, NO DONE, finish never ran, rebase paused.
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    await expect(access(join(dir, '.pipeline/DONE'))).rejects.toThrow();
    expect(completed).toBe(false);
    expect(halted).toBe(true);
    expect(ran).not.toContain('finish');
    expect(await rebaseInProgress()).toBe(true);
  });

  it('falls back to the local base when there is no remote (FR-3)', async () => {
    // No `origin` remote at all. Advance the LOCAL base non-conflicting.
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    const baseSha = await advanceBaseNonConflicting();
    // Confirm there is genuinely no remote configured.
    const remotes = await git('remote').catch(() => '');
    expect(remotes).toBe('');
    expect(await branchContains(baseSha)).toBe(false);

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    expect(completed).toBe(true);
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
    // With no remote, the rebase must target the LOCAL base and still pick up
    // its new commit.
    expect(await branchContains(baseSha)).toBe(true);
  });

  it('resumes a resolved+continued+HALT-cleared worktree to a clean PR (FR-9)', async () => {
    // Simulate the operator's post-HALT cleanup: the branch is ALREADY rebased
    // onto the advanced base (conflict resolved + `git rebase --continue`), no
    // rebase is in progress, and `.pipeline/HALT` was removed. Re-running the
    // daemon must find the rebase a no-op and converge to finish.
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    const baseSha = await advanceBaseNonConflicting();
    // Operator already completed the rebase by hand.
    await git('rebase', BASE);
    expect(await branchContains(baseSha)).toBe(true);
    expect(await rebaseInProgress()).toBe(false);

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    expect(completed).toBe(true);
    expect(ran).toContain('finish');
    await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
    await expect(access(join(dir, '.pipeline/HALT'))).rejects.toThrow();
  });

  it('a stuck post-rebase build HALTs via the existing path, not a rebase special-case (FR-6)', async () => {
    // A code-changing rebase kicks back to build; build NEVER satisfies (the
    // runner refuses to write task-status.json), so the loop must HALT through
    // the EXISTING build-failure path — the rebase itself succeeded (it is NOT
    // the thing that HALTs) and finish must never run.
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    const kicks: Array<{ from: string; to: string }> = [];
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        if (step === 'build') {
          buildRuns++;
          // First build satisfies (so the loop reaches rebase); after the
          // rebase kickback, build NEVER satisfies → stuck → existing HALT.
          if (buildRuns === 1) return satisfy('build');
          // Remove the prior task-status so the completion gate fails.
          await rm(join(dir, '.pipeline/task-status.json'), { force: true });
          return { success: true };
        }
        return satisfy(step);
      },
    };
    let completed = false;
    let halted = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_halt', () => {
      halted = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });

    await conductorWith(runner).run();

    expect(completed).toBe(false);
    expect(halted).toBe(true);
    // The rebase ran and kicked back to build (the rebase succeeded) — the HALT
    // came from the stuck build, and finish never ran.
    expect(kicks).toContainEqual({ from: 'rebase', to: 'build' });
    expect(ran).not.toContain('finish');
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
  });

  it('re-parks (does NOT ship a PR) when HALT was cleared but the rebase is still in progress (FR-9 negative)', async () => {
    // The operator cleared .pipeline/HALT but did NOT finish resolving the
    // conflict — the rebase is paused mid-flight (HEAD detached at base, with
    // unmerged paths). A naive "branch current?" check sees HEAD..base == 0 and
    // would ship a half-rebased tree with live conflict markers. The daemon must
    // detect the in-progress rebase and re-park instead.
    // Base and branch modify the SAME source file differently → real conflict.
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial feature file');

    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch edits feature');

    await git('checkout', BASE);
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base edits feature');
    await git('checkout', 'feature/foo');
    // Start the rebase by hand; it stops at the conflict, leaving it in progress.
    await git('rebase', BASE).catch(() => undefined);
    expect(await rebaseInProgress()).toBe(true);
    // Simulate the operator clearing HALT without finishing (no marker present).
    await rm(join(dir, '.pipeline/HALT'), { force: true });

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    let halted = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_halt', () => {
      halted = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    // Re-parked: HALT re-written, NO DONE, finish never ran, rebase still paused.
    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    await expect(access(join(dir, '.pipeline/DONE'))).rejects.toThrow();
    expect(completed).toBe(false);
    expect(halted).toBe(true);
    expect(ran).not.toContain('finish');
    expect(await rebaseInProgress()).toBe(true);
  });

  it('re-parks when the rebase is paused but staged-without-continue (no unmerged paths) (FR-9 hardening)', async () => {
    // The operator staged the resolution (`git add`) but never ran
    // `git rebase --continue`: there are NO unmerged paths, yet the rebase is
    // still in progress (rebase-merge dir present). The unmerged-paths check
    // alone would miss this; the rebase-state-dir check must still re-park.
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial feature file');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch edits feature');
    await git('checkout', BASE);
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base edits feature');
    await git('checkout', 'feature/foo');
    await git('rebase', BASE).catch(() => undefined);
    // Stage a resolution WITHOUT continuing → clears unmerged status, leaves the
    // rebase-merge dir in place.
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 3; // resolved\n');
    await git('add', 'src/feature.ts');
    expect(await rebaseInProgress()).toBe(true);
    // Sanity: no unmerged paths remain (the unmerged-paths guard would miss this).
    const unmerged = await git('diff', '--name-only', '--diff-filter=U');
    expect(unmerged).toBe('');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let completed = false;
    let halted = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('loop_halt', () => {
      halted = true;
    });

    await conductorWith(passthroughRunner(ran)).run();

    await expect(access(join(dir, '.pipeline/HALT'))).resolves.toBeUndefined();
    await expect(access(join(dir, '.pipeline/DONE'))).rejects.toThrow();
    expect(completed).toBe(false);
    expect(halted).toBe(true);
    expect(ran).not.toContain('finish');
  });

  // ── #655: delta-aware post-rebase gate invalidation ─────────────────────
  //
  // `D` = rebase delta (`changedCodePaths`, `preTree..HEAD`); `F` = feature
  // claimed surface (`changedPathsBetween(mergeBase, preTree)`). Per the
  // APPROVED ADR (adr-2026-07-20-post-rebase-delta-aware-invalidation.md),
  // `prd_audit`/`architecture_review_as_built` should be PRESERVED (state
  // stays `done`, never re-dispatched) when `D_featureSrc = ∅`, and
  // `wiring_check`/`manual_test` preserved when the delta contains no
  // runtime source at all. None of `classifyGateInvalidation`, `partitionDelta`
  // (new module `src/conductor/src/engine/gate-invalidation.ts`), or
  // `RebaseOutcome.changed.featureSurface` exist yet — today's code
  // invalidates a FIXED set `{build, build_review, wiring_check, +manual_test}`
  // on ANY `changed` rebase and lets `markDownstreamStale` blanket-cascade the
  // judged audits, so every spec below fails on its behavioral assertion
  // (dispatch counts, verdict shape, or the two new audit-trail events), not
  // on setup — matching this file's existing RED convention (see Task 14
  // above).
  describe('delta-aware post-rebase gate invalidation (#655)', () => {
    // Feature branch owns BOTH a runtime file (`src/feature.ts`, from
    // initRepoOnFeatureBranch) and a test file (`src/feature.test.ts`) — its
    // "claimed surface" F includes both paths.
    async function addFeatureTestFile(): Promise<void> {
      await writeFile(
        join(dir, 'src/feature.test.ts'),
        "it('foo works', () => {});\n",
      );
      await git('add', '.');
      await git('commit', '-m', 'feature test coverage');
    }

    // Base coincidentally touches the SAME path(s) the feature also touched,
    // with byte-identical content so the rebase auto-merges cleanly (no
    // conflict) — generalizes the established
    // advanceBaseWithCoincidentalTaskTrailer idiom above to arbitrary
    // paths/content, optionally alongside a genuinely-foreign runtime file.
    async function advanceBaseCoincidentally(
      touches: Array<{ path: string; content: string }>,
      opts: { alsoForeignRuntime?: boolean } = {},
    ): Promise<void> {
      await git('checkout', BASE);
      for (const t of touches) {
        await mkdir(join(dir, t.path.split('/').slice(0, -1).join('/') || '.'), {
          recursive: true,
        }).catch(() => {});
        await writeFile(join(dir, t.path), t.content);
      }
      if (opts.alsoForeignRuntime) {
        await mkdir(join(dir, 'src'), { recursive: true }).catch(() => {});
        await writeFile(join(dir, 'src/foreign-sibling.ts'), 'export const foreign = 1;\n');
      }
      await git('add', '.');
      await git('commit', '-m', 'base coincidentally touches feature paths');
      await git('checkout', 'feature/foo');
    }

    // A feature branch whose OWN runtime file (`src/feature.ts`) pre-exists on
    // BASE (shared ancestry) — unlike `initRepoOnFeatureBranch` (which creates
    // the file fresh only on the feature branch), this gives base and feature
    // a common blob to 3-way-merge against. This matters because `D` (the
    // rebase delta) is a tree-to-tree diff of the FEATURE's own pre- and
    // post-rebase HEAD — a "coincidental" base touch that lands on
    // byte-identical final content (the `advanceBaseCoincidentally` idiom
    // above) can NEVER show up in `D`, no matter what commits intervened,
    // because the final blob is unchanged. To genuinely exercise
    // "D_featureSrc non-empty at a feature-owned path", base and feature must
    // each make a real, non-overlapping edit to a file they both descend
    // from, so the rebase's 3-way merge produces a real content change.
    async function initRepoOnFeatureBranchWithSharedRuntimeFile(): Promise<void> {
      await execFileAsync('git', ['init', '-b', BASE, dir]);
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');
      await mkdir(join(dir, 'src'), { recursive: true });
      // Multiple shared lines give the 3-way merge enough context to
      // auto-resolve a top-insert (base) + bottom-append (feature) cleanly,
      // rather than conflicting on adjacent-line edits.
      await writeFile(
        join(dir, 'src/feature.ts'),
        'export const foo = 1;\nexport const a = 1;\nexport const b = 1;\n' +
          'export const c = 1;\nexport const d = 1;\n',
      );
      await writeFile(join(dir, 'README.md'), '# base\n');
      await git('add', '.');
      await git('commit', '-m', 'initial commit on base (includes feature.ts)');

      await git('checkout', '-b', 'feature/foo');
      await writeFile(
        join(dir, 'src/feature.ts'),
        'export const foo = 1;\nexport const a = 1;\nexport const b = 1;\n' +
          'export const c = 1;\nexport const d = 1;\nexport const featureOwned = 2;\n',
      );
      await git('add', '.');
      await git('commit', '-m', 'feature work: extend feature.ts (appends at end)');
    }

    // Base independently makes a real, non-overlapping edit (inserts near the
    // top) to the SAME shared file the feature also edited (appends at the
    // end) — a clean, non-conflicting 3-way merge that genuinely changes the
    // final tree at `src/feature.ts`, so it shows up in `D` as feature-owned
    // runtime source (`D_featureSrc`). `extraTouches` lets a test also fold
    // in a byte-identical touch to another feature-owned path in the SAME
    // base commit (that touch itself never affects `D` — see the comment on
    // `advanceBaseCoincidentally` — it is included only to mirror this
    // story's "coincidental multi-path touch" framing).
    async function advanceBaseWithDivergentEditToSharedFile(
      extraTouches: Array<{ path: string; content: string }> = [],
    ): Promise<void> {
      await git('checkout', BASE);
      await writeFile(
        join(dir, 'src/feature.ts'),
        'export const foo = 1;\nexport const baseOwned = 3;\nexport const a = 1;\n' +
          'export const b = 1;\nexport const c = 1;\nexport const d = 1;\n',
      );
      for (const t of extraTouches) {
        await mkdir(join(dir, t.path.split('/').slice(0, -1).join('/') || '.'), {
          recursive: true,
        }).catch(() => {});
        await writeFile(join(dir, t.path), t.content);
      }
      await git('add', '.');
      await git(
        'commit',
        '-m',
        'base independently extends feature.ts (non-overlapping insert)',
      );
      await git('checkout', 'feature/foo');
    }

    // Base advances with ONLY a genuinely-foreign runtime file (a path the
    // feature never touched) — D_foreignSrc != ∅, D_featureSrc == ∅.
    async function advanceBaseForeignRuntimeOnly(): Promise<void> {
      await git('checkout', BASE);
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src/foreign-only.ts'), 'export const foreignOnly = 1;\n');
      await git('add', '.');
      await git('commit', '-m', 'foreign runtime change merged to base');
      await git('checkout', 'feature/foo');
    }

    // Base advances with ONLY a foreign (non-feature-owned) test file — a
    // pure test-only delta with zero runtime paths.
    async function advanceBaseForeignTestOnly(): Promise<void> {
      await git('checkout', BASE);
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(join(dir, 'test/sibling.test.ts'), "it('sibling', () => {});\n");
      await git('add', '.');
      await git('commit', '-m', 'foreign test-only change merged to base');
      await git('checkout', 'feature/foo');
    }

    // A feature branch with NO common ancestor with BASE (orphan history) —
    // `git merge-base HEAD base` returns empty/exit-1, so the feature claimed
    // surface F is uncomputable BEFORE the rebase runs. A single-file orphan
    // commit still rebases cleanly onto BASE (new, non-overlapping path), so
    // the rebase itself completes and is classified `changed`.
    //
    // BASE's initial commit deliberately includes a real CODE path
    // (`src/base-only.ts`), not just `README.md` — `README.md` alone is
    // filtered out by `isCodeOrTestPath` (docs), so `preTree..HEAD` would
    // show ONLY a docs-path addition after rebasing the orphan branch onto
    // base, which `classifyClean` correctly classifies `noop` (no code/test
    // path actually changed) rather than `changed`. Adding a genuine code
    // path to base's history is what makes `D` non-empty and reachable as
    // `changed`, independent of the docs-filtering behavior this fixture
    // must not fight.
    async function initRepoOrphanFeatureBranch(): Promise<void> {
      await execFileAsync('git', ['init', '-b', BASE, dir]);
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');
      await writeFile(join(dir, 'README.md'), '# base\n');
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src/base-only.ts'), 'export const baseOnly = 1;\n');
      await git('add', '.');
      await git('commit', '-m', 'initial commit on base');

      await git('checkout', '--orphan', 'feature/foo');
      await git('rm', '-rf', '--cached', '.').catch(() => {});
      await rm(join(dir, 'README.md'), { force: true });
      await rm(join(dir, 'src/base-only.ts'), { force: true });
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
      await git('add', '.');
      await git('commit', '-m', 'feature work (disjoint history)');
    }

    function trackPreservedInvalidated(): {
      preserved: Array<{ gate: string; surface: string[]; deltaConsidered: string[] }>;
      invalidated: Array<{ gate: string; matchedPaths: string[] }>;
    } {
      const preserved: Array<{ gate: string; surface: string[]; deltaConsidered: string[] }> = [];
      const invalidated: Array<{ gate: string; matchedPaths: string[] }> = [];
      // `rebase_gate_preserved`/`rebase_gate_invalidated` are not members of
      // the ConductorEvent union yet (plan Task 1 adds them) — vitest's
      // esbuild transform doesn't type-check, so this compiles and runs fine
      // pre-implementation even though `tsc` would reject the string literal,
      // exactly like the `rebase_gate_reverified` cast above.
      (events as any).on('rebase_gate_preserved', (e: any) => {
        if (e?.type === 'rebase_gate_preserved') {
          preserved.push({ gate: e.gate, surface: e.surface, deltaConsidered: e.deltaConsidered });
        }
      });
      (events as any).on('rebase_gate_invalidated', (e: any) => {
        if (e?.type === 'rebase_gate_invalidated') {
          invalidated.push({ gate: e.gate, matchedPaths: e.matchedPaths });
        }
      });
      return { preserved, invalidated };
    }

    async function readGateVerdict(step: string): Promise<any> {
      try {
        return JSON.parse(await readFile(join(dir, `.pipeline/gates/${step}.json`), 'utf-8'));
      } catch {
        return null;
      }
    }

    function runCountingRunner(counts: Record<string, number>): StepRunner {
      return {
        run: async (step) => {
          counts[step] = (counts[step] ?? 0) + 1;
          return satisfy(step);
        },
      };
    }

    // ── Story: Test-only rebase delta preserves prd_audit and
    // architecture_review_as_built (headline #642 case) ──────────────────────
    describe('Story: test-only rebase delta preserves the judged audit tail', () => {
      it('preserves prd_audit and architecture_review_as_built when D_featureSrc is empty (feature test-only + foreign runtime)', async () => {
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await addFeatureTestFile();
        // Base coincidentally re-touches the feature's OWN test file (so it
        // lands in D and is also feature-owned, i.e. D_test) plus a genuinely
        // foreign runtime file (D_foreignSrc) — D_featureSrc stays empty.
        await advanceBaseCoincidentally(
          [{ path: 'src/feature.test.ts', content: "it('foo works', () => {});\n" }],
          { alsoForeignRuntime: true },
        );

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        const { preserved } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        // Preserved: each judged audit gate ran exactly ONCE (never
        // re-dispatched by the rebase) and its verdict stays satisfied with
        // no rebase-origin kickback provenance.
        expect(counts.prd_audit).toBe(1);
        expect(counts.architecture_review_as_built).toBe(1);
        const prdVerdict = await readGateVerdict('prd_audit');
        const archVerdict = await readGateVerdict('architecture_review_as_built');
        expect(prdVerdict?.satisfied).toBe(true);
        expect(prdVerdict?.kickback).toBeUndefined();
        expect(archVerdict?.satisfied).toBe(true);
        expect(archVerdict?.kickback).toBeUndefined();

        // Audit trail: a rebase_gate_preserved event per preserved gate, with
        // a non-empty declared surface and an EMPTY feature-src delta that
        // justified the preservation.
        const prdPreserved = preserved.find((p) => p.gate === 'prd_audit');
        const archPreserved = preserved.find((p) => p.gate === 'architecture_review_as_built');
        expect(prdPreserved).toBeDefined();
        expect(prdPreserved!.surface.length).toBeGreaterThan(0);
        expect(prdPreserved!.deltaConsidered).toEqual([]);
        expect(archPreserved).toBeDefined();
        expect(archPreserved!.surface.length).toBeGreaterThan(0);
        expect(archPreserved!.deltaConsidered).toEqual([]);
      });

      it('does NOT falsely preserve a judged gate that was not already satisfied before the rebase', async () => {
        // Drives the real call-site pairing (performRebase -> applyRebaseVerdicts)
        // directly against a real git repo rather than the full daemon loop:
        // the Conductor tail always re-verifies prd_audit's own completion
        // predicate before rebase ever runs (rebase sits downstream of
        // prd_audit in ALL_STEPS), so there is no way to reach the rebase
        // decision with prd_audit genuinely unsatisfied via the ordinary
        // linear E2E path. Calling the two real production functions in
        // sequence against a real repo/verdict-file directory is still an
        // integration (not unit) exercise of the exact decision under test.
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await addFeatureTestFile();
        await advanceBaseCoincidentally(
          [{ path: 'src/feature.test.ts', content: "it('foo works', () => {});\n" }],
          { alsoForeignRuntime: true },
        );

        // prd_audit's verdict is unsatisfied BEFORE the rebase runs — it never
        // actually passed for this feature.
        await mkdir(join(dir, '.pipeline/gates'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/gates/prd_audit.json'),
          JSON.stringify({ satisfied: false, reason: 'never ran', checkedAt: 1 }),
        );

        const git2 = makeRebaseGitRunner(dir);
        const outcome = await performRebase(git2, dir, BASE);
        expect(outcome.kind).toBe('changed');
        await applyRebaseVerdicts(dir, outcome, true);

        // Preservation must never resurrect a gate that was not already
        // satisfied — the not-yet-passed verdict must still read unsatisfied
        // (still selected to run), never silently flipped to preserved-done.
        const prdVerdict = await readGateVerdict('prd_audit');
        expect(prdVerdict?.satisfied).toBe(false);
        expect(prdVerdict?.reason).toBe('never ran');
      });

      it('a single feature-owned runtime path in the delta defeats preservation', async () => {
        // Uses the shared-ancestry fixture (not `initRepoOnFeatureBranch` +
        // byte-identical `advanceBaseCoincidentally`, which can never put
        // `src/feature.ts` in D — see
        // `initRepoOnFeatureBranchWithSharedRuntimeFile`'s comment): base and
        // feature each make a real, non-overlapping edit to `src/feature.ts`,
        // so D_featureSrc is genuinely non-empty at that path, alongside a
        // byte-identical (inert) touch to the feature's own test file.
        await initRepoOnFeatureBranchWithSharedRuntimeFile();
        await addFeatureTestFile();
        await advanceBaseWithDivergentEditToSharedFile([
          { path: 'src/feature.test.ts', content: "it('foo works', () => {});\n" },
        ]);

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        // Re-run, NOT preserved: a single feature-owned runtime path in D
        // defeats preservation — both audits dispatch a second time.
        expect(counts.prd_audit).toBe(2);
        expect(counts.architecture_review_as_built).toBe(2);
      });
    });

    // ── Story: A change to the feature's own runtime source re-runs the
    // judged audit gates ──────────────────────────────────────────────────────
    describe("Story: feature-owned runtime source in the delta re-runs prd_audit and architecture_review_as_built", () => {
      it('invalidates and re-selects both judged audits when D_featureSrc is non-empty', async () => {
        // Shared-ancestry fixture (see comment above) — a byte-identical
        // "coincidental" touch of a feature-owned path can never register in
        // D; base and feature must each make a real, non-overlapping edit.
        await initRepoOnFeatureBranchWithSharedRuntimeFile();
        await advanceBaseWithDivergentEditToSharedFile();

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        const { invalidated } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.prd_audit).toBe(2);
        expect(counts.architecture_review_as_built).toBe(2);
        const prdVerdictAtKickback = await readGateVerdict('prd_audit');
        // The FINAL verdict (post re-dispatch) is satisfied again, but the
        // decision must have applied a real kickback-shaped invalidation in
        // between — assert the audit-trail event carries the matched paths.
        expect(prdVerdictAtKickback?.satisfied).toBe(true);
        const prdInvalidated = invalidated.find((i) => i.gate === 'prd_audit');
        const archInvalidated = invalidated.find(
          (i) => i.gate === 'architecture_review_as_built',
        );
        expect(prdInvalidated).toBeDefined();
        expect(prdInvalidated!.matchedPaths).toContain('src/feature.ts');
        expect(archInvalidated).toBeDefined();
        expect(archInvalidated!.matchedPaths).toContain('src/feature.ts');
      });

      it('does NOT invalidate the judged audits when the only feature-owned delta path is docs (.docs/**)', async () => {
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await mkdir(join(dir, '.docs'), { recursive: true });
        await writeFile(join(dir, '.docs/feature-notes.md'), '# notes\n');
        await git('add', '.');
        await git('commit', '-m', 'feature docs');
        // Base coincidentally touches the SAME docs path only — docs are
        // excluded from D upstream (isCodeOrTestPath), so this can never
        // force a re-audit on that basis alone.
        await advanceBaseCoincidentally([
          { path: '.docs/feature-notes.md', content: '# notes\n' },
        ]);

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.prd_audit).toBe(1);
        expect(counts.architecture_review_as_built).toBe(1);
      });
    });

    // ── Story: Foreign main-side runtime change re-runs manual_test/
    // wiring_check but preserves the audits ───────────────────────────────────
    describe('Story: foreign-only runtime delta re-runs manual_test/wiring_check but preserves the audits', () => {
      it('invalidates wiring_check and manual_test while preserving prd_audit and architecture_review_as_built', async () => {
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await advanceBaseForeignRuntimeOnly();

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        const { preserved, invalidated } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.wiring_check).toBe(2);
        expect(counts.manual_test).toBe(2);
        expect(counts.prd_audit).toBe(1);
        expect(counts.architecture_review_as_built).toBe(1);

        expect(invalidated.find((i) => i.gate === 'wiring_check')).toBeDefined();
        expect(invalidated.find((i) => i.gate === 'manual_test')).toBeDefined();
        expect(preserved.find((p) => p.gate === 'prd_audit')).toBeDefined();
        expect(
          preserved.find((p) => p.gate === 'architecture_review_as_built'),
        ).toBeDefined();
      });

      it('does not invalidate manual_test when it never ran for this feature (ranManualTest = false)', async () => {
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await advanceBaseForeignRuntimeOnly();

        // manual_test pre-seeded 'skipped' for this feature.
        await writeState(statePath, { ...FRONT_DONE_M, manual_test: 'skipped' });
        const counts: Record<string, number> = {};
        const { invalidated } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.manual_test).toBeUndefined();
        expect(invalidated.find((i) => i.gate === 'manual_test')).toBeUndefined();
      });

      it('preserves manual_test and wiring_check too when the delta is test-only (no runtime at all)', async () => {
        await initRepoOnFeatureBranch({
          path: 'src/feature.ts',
          content: 'export const foo = 1;\n',
        });
        await advanceBaseForeignTestOnly();

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        const { preserved } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.wiring_check).toBe(1);
        expect(counts.manual_test).toBe(1);
        expect(counts.prd_audit).toBe(1);
        expect(counts.architecture_review_as_built).toBe(1);
        expect(preserved.find((p) => p.gate === 'wiring_check')).toBeDefined();
        expect(preserved.find((p) => p.gate === 'manual_test')).toBeDefined();
      });
    });

    // ── Story: A preserved judged gate is not swept stale by the downstream
    // cascade ─────────────────────────────────────────────────────────────────
    //
    // Placed here (not gate-loop.test.ts): reaching the delta-gated sweep
    // requires actually running a real rebase to produce a `changed` outcome
    // with a real feature-surface/delta partition — gate-loop.test.ts has no
    // rebase-driving fixture (its one real-git describe block is a narrow
    // manual_test FAIL-routing scenario with no base/feature divergence at
    // all), whereas this file's full daemon + real-git harness is purpose
    // built for exactly this. Reuses the Story 3 (foreign-only) and Story 2
    // (feature-src) fixtures from the angle of the downstream-stale sweep
    // specifically: dispatch COUNTS (not final `done` status, which converges
    // to `done` either way) are what distinguish "preserved, never re-swept"
    // from "swept stale then re-run back to done".
    describe('Story: a preserved judged gate is not swept stale by the downstream cascade', () => {
      it('leaves prd_audit/architecture_review_as_built un-re-dispatched when manual_test is re-opened but the audits are preserved', async () => {
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
        // manual_test WAS re-opened (invalidated, re-dispatched)...
        expect(counts.manual_test).toBe(2);
        // ...but the downstream-stale sweep must not have re-swept the
        // preserved judged gates: each ran exactly once, never re-selected.
        expect(counts.prd_audit).toBe(1);
        expect(counts.architecture_review_as_built).toBe(1);
      });

      it('still marks a genuinely-invalidated judged gate stale/re-run by the sweep', async () => {
        // Shared-ancestry fixture (see comment above) — a byte-identical
        // "coincidental" touch of a feature-owned path can never register in
        // D; base and feature must each make a real, non-overlapping edit.
        await initRepoOnFeatureBranchWithSharedRuntimeFile();
        await advanceBaseWithDivergentEditToSharedFile();

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        // The delta-gating must not accidentally preserve a gate the
        // decision genuinely invalidated — it's re-dispatched.
        expect(counts.prd_audit).toBe(2);
        expect(counts.architecture_review_as_built).toBe(2);
      });
    });

    // ── Story: Uncomputable delta fails closed to invalidate-all ─────────────
    describe('Story: uncomputable feature surface fails closed to the legacy invalidate-all', () => {
      it('invalidates the full legacy set with zero preservations and records a fail-closed reason when F is uncomputable', async () => {
        // Drives the real call-site pairing (performRebase ->
        // applyRebaseVerdicts -> emitGateInvalidationEvents) directly against
        // a real git repo, rather than the full daemon loop: because this
        // 'changed' outcome invalidates the tail's judged gates, the full
        // loop kicks back and re-plays the whole tail, reaching the `rebase`
        // step a SECOND time — which is then correctly `noop` (already
        // current) and overwrites the `rebase` gate's own verdict file with
        // that second-pass reason, destroying the first pass's fail-closed
        // marker before this test can observe it. That replay is real,
        // correct daemon behavior (every other `changed`-outcome story in
        // this describe block exhibits it too) — it just means the ONE
        // assertion that inspects `rebase`'s own on-disk verdict text must
        // observe it right after the single decision under test, not after
        // the whole multi-pass loop has run to completion.
        await initRepoOrphanFeatureBranch();
        const { preserved } = trackPreservedInvalidated();

        const git2 = makeRebaseGitRunner(dir);
        const outcome = await performRebase(git2, dir, BASE);
        expect(outcome.kind).toBe('changed');
        expect(outcome.featureSurface).toBeUndefined();

        const result = await applyRebaseVerdicts(dir, outcome, true);
        await emitGateInvalidationEvents(events, outcome, true);

        // Full legacy invalidation set (fail-closed fallback), no preservations.
        expect(result.kickedBack).toEqual(
          expect.arrayContaining([
            'build_review',
            'wiring_check',
            'manual_test',
            'prd_audit',
            'architecture_review_as_built',
          ]),
        );
        expect(preserved).toEqual([]);
        // A fail-closed reason recorded in the rebase gate's own verdict —
        // this is the NEW artifact this story requires; today's verdict
        // reason never mentions fail-closed (it just says "code changed").
        const rebaseVerdict = await readGateVerdict('rebase');
        expect(rebaseVerdict?.reason).toMatch(/fail.?closed/i);
      });

      it('still re-runs prd_audit and architecture_review_as_built under fail-closed uncertainty (never preserved)', async () => {
        await initRepoOrphanFeatureBranch();

        await writeState(statePath, { ...FRONT_DONE_M });
        const counts: Record<string, number> = {};
        const { preserved } = trackPreservedInvalidated();
        let completed = false;
        events.on('feature_complete', () => {
          completed = true;
        });

        await conductorWith(runCountingRunner(counts)).run();

        expect(completed).toBe(true);
        expect(counts.prd_audit).toBe(2);
        expect(counts.architecture_review_as_built).toBe(2);
        expect(
          preserved.find((p) => p.gate === 'prd_audit' || p.gate === 'architecture_review_as_built'),
        ).toBeUndefined();
      });
    });
  });
});
