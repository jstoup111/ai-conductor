import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';

// END-TO-END acceptance specs for the Phase 9.0 daemon rebase-on-latest step.
//
// These drive the REAL Conductor over a REAL git repo in a tmpdir. Git is core
// infrastructure here — we exercise it for real (NO `vi.mock('execa')`). The
// loop's tail steps (build/manual_test/finish) are satisfied by a mock
// StepRunner + per-step artifacts (the `satisfy()` helper), exactly like
// gate-loop.test.ts. We start the loop at `build` with complexity tier 'S' so
// the gate-driven tail is:  build → manual_test → (retro tier-skipped) →
// [rebase, once implemented] → finish.
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
      await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
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

  it('a file-changing rebase kicks back to build then reconverges (FR-5/FR-6)', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    // Base advances with a code-path change → file-changing rebase → kickback.
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        if (step === 'build') buildRuns++;
        return satisfy(step);
      },
    };
    let completed = false;
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });

    await conductorWith(runner).run();

    // A code/test-changing rebase invalidates build (kickback-shaped), so build
    // runs a second time before the loop converges to finish.
    expect(buildRuns).toBe(2);
    expect(kicks).toContainEqual({ from: 'rebase', to: 'build' });
    expect(completed).toBe(true);
  });

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
});
