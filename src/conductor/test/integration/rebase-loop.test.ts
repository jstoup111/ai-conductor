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

  // ── #420: gate-first mechanical re-verify fixtures ──────────────────────
  //
  // Anchors a fake `origin/main` remote-tracking ref at the merge-base of
  // BASE and feature/foo (the fork point) so autoheal's evidence-derivation
  // (`git merge-base origin/main HEAD`) resolves and the feature branch's
  // own commits land inside the scanned range — see
  // task-status-gate-recompute.test.ts's `initRepo()` for the same idiom.
  // Independent of which non-conflicting commits are later added to BASE
  // (merge-base of two divergent branches is the fixed common ancestor).
  async function anchorOriginMain(): Promise<void> {
    const forkPoint = await git('merge-base', BASE, 'feature/foo');
    await git('remote', 'add', 'origin', dir).catch(() => {});
    await git('update-ref', 'refs/remotes/origin/main', forkPoint);
    // Without this, `resolveBase`'s origin-default-branch discovery falls
    // back to `git remote show origin` — which, for a self-referencing
    // `origin` pointing at THIS SAME working tree, reports whatever branch
    // happens to be checked out (feature/foo) as the "HEAD branch" instead of
    // BASE. That makes the daemon rebase step target `origin/feature/foo`
    // (always already current with itself) and silently classify every
    // rebase as `noop` — no invalidation, no kickback, test never reaches the
    // behavior under test. Pointing origin/HEAD at origin/main directly (as a
    // real clone would have it) makes `originDefaultBranch` resolve BASE
    // without ever falling through to the misleading `remote show` path.
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }

  // Writes a single plan file whose one task's `Files:` path matches
  // `src/feature.ts`, then commits real git evidence (a `Task: 1` trailer on
  // a commit touching that path) on feature/foo, and anchors origin/main so
  // the evidence is inside the derivation range. After this, the build gate's
  // mechanical predicate (CUSTOM_COMPLETION_PREDICATES.build) derives
  // evidence-complete against the CURRENT feature/foo tree.
  async function seedEvidenceCompleteBuild(): Promise<void> {
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/p.md'),
      '### Task 1\n**Files:** `src/feature.ts`\n',
    );
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'feat: implement task 1\n\nTask: 1');
    await anchorOriginMain();
  }

  it('a file-changing rebase with intact git evidence confirms build mechanically — no build dispatch (Story 1, Task 8)', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await seedEvidenceCompleteBuild();

    // Base advances with a code-path change → file-changing rebase.
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const beforeRun = Date.now();
    const ran: string[] = [];
    let buildRuns = 0;
    let buildReviewRuns = 0;
    let manualTestRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        if (step === 'build') buildRuns++;
        if (step === 'build_review') buildReviewRuns++;
        if (step === 'manual_test') manualTestRuns++;
        return satisfy(step);
      },
    };
    let completed = false;
    const kicks: Array<{ from: string; to: string }> = [];
    let reverifiedBuild = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    // `rebase_gate_reverified` does not exist in the ConductorEvent union yet
    // (Task 1 of the plan adds it to src/types/events.ts) — vitest's esbuild
    // transform does not type-check, so the string literal runs fine even
    // though `tsc` would reject it pre-implementation.
    (events as any).on('rebase_gate_reverified', (e: any) => {
      if (e?.type === 'rebase_gate_reverified' && e.step === 'build') {
        reverifiedBuild = true;
      }
    });
    const fakeGit: GitRunner = async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/x\n' }
        : { stdout: '' };
    const config = { build_review: { enabled: true } };

    // Pre-write a fresh all-PASS manual_test results file mid-session before rebase
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| all | PASS |\n',
    );

    const conductor = new Conductor({
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
      config,
    });

    await conductor.run();

    // Evidence-intact: the mechanical pre-verify confirms build from git
    // evidence, so the build agent is dispatched only once (not re-run by
    // the rebase kickback) — was `=== 2` before this feature.
    expect(buildRuns).toBe(1);
    expect(kicks).not.toContainEqual({ from: 'rebase', to: 'build' });
    expect(reverifiedBuild).toBe(true);
    expect(completed).toBe(true);

    // Non-tree-attesting gates (build_review, manual_test) must always
    // re-run on file-changing rebase even when build is mechanically
    // confirmed and skipped.
    expect(buildReviewRuns).toBe(2);
    expect(kicks).toContainEqual({ from: 'rebase', to: 'build_review' });

    // manual_test: despite fresh same-session all-PASS file, it must be
    // invalidated by file-changing rebase and re-run (session-fresh
    // invariant does not apply to pre-rebase files).
    expect(manualTestRuns).toBe(2);
    expect(kicks).toContainEqual({ from: 'rebase', to: 'manual_test' });

    // Verify build verdict is satisfied (pre-verify succeeded)
    const verdictRaw = await readFile(
      join(dir, '.pipeline/gates/build.json'),
      'utf-8',
    );
    const verdict = JSON.parse(verdictRaw);
    expect(verdict.satisfied).toBe(true);
    expect(verdict.reason).toMatch(/re-verified mechanically/);
    expect(verdict.checkedAt).toBeGreaterThanOrEqual(beforeRun);

    // Verify build_review verdict was invalidated by rebase kickback
    const buildReviewVerdictRaw = await readFile(
      join(dir, '.pipeline/gates/build_review.json'),
      'utf-8',
    );
    const buildReviewVerdict = JSON.parse(buildReviewVerdictRaw);
    expect(buildReviewVerdict.satisfied).toBe(true);

    // Verify manual_test verdict was invalidated by rebase kickback
    const manualTestVerdictRaw = await readFile(
      join(dir, '.pipeline/gates/manual_test.json'),
      'utf-8',
    );
    const manualTestVerdict = JSON.parse(manualTestVerdictRaw);
    expect(manualTestVerdict.satisfied).toBe(true);
  });

  // Advance BASE with a coincidental commit that touches the SAME path the
  // plan's task 1 declares (`src/feature.ts`) and carries a `Task: 1`
  // trailer — it LOOKS exactly like real task-1 evidence, but it is foreign
  // base history introduced independently of the feature branch's own work.
  // Content is identical to the feature branch's own pre-existing content at
  // that path so the subsequent real rebase auto-merges cleanly (no
  // conflict): both sides having byte-identical content at the same path is
  // a no-op hunk for git's 3-way merge. A SEPARATE new file (`sibling.ts`) is
  // touched in the same commit purely to guarantee the rebase is classified
  // as code/test-path-changing (matching Story 1/2's own trigger) — the
  // `feature.ts`/`Task: 1` pairing is the thing actually under test.
  async function advanceBaseWithCoincidentalTaskTrailer(): Promise<string> {
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true }).catch(() => {});
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'feat: unrelated base work touching feature path\n\nTask: 1');
    const sha = await git('rev-parse', 'HEAD');
    await git('checkout', 'feature/foo');
    return sha;
  }

  it(
    "a rebase pulling a coincidental base Task:1 trailer over the same declared path never substitutes for task 1's " +
      'real evidence — build is genuinely re-dispatched, not falsely confirmed (#456/#463 story: gate and pre-verify share one anchor rule)',
    async () => {
      // No real per-task evidence exists on the feature branch at all — only
      // the plain feature-add commit from initRepoOnFeatureBranch (no `Task:`
      // trailer). This isolates the property under test: a FOREIGN commit
      // that merely LOOKS like task-1 evidence (right trailer, right
      // declared path) must never be accepted as a substitute for real work,
      // even after it becomes reachable from HEAD via a real rebase.
      await initRepoOnFeatureBranch({
        path: 'src/feature.ts',
        content: 'export const foo = 1;\n',
      });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        join(dir, '.docs/plans/p.md'),
        '### Task 1\n**Files:** `src/feature.ts`\n',
      );
      await anchorOriginMain();

      // Base advances BEFORE any daemon dispatch with the coincidental
      // Task:1-trailer collision over the plan's own declared path.
      const coincidentalSha = await advanceBaseWithCoincidentalTaskTrailer();

      await writeState(statePath, { ...FRONT_DONE });
      let buildRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build') buildRuns++;
          // The runner never performs any real work for task 1 — it only
          // satisfies the ordinary artifact glob (satisfy('build') writes an
          // UNRELATED task-status.json row, matching how Story 2's fixture
          // separates "artifact present" from "git evidence present"). Task
          // 1 must stay genuinely unevidenced throughout this run.
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
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'build',
        maxRetries: 3,
        git: fakeGit,
      });

      await conductor.run();

      // Task 1 is never git-evidenced anywhere in this run — no commit on
      // this branch's OWN work ever carried a real `Task: 1` trailer. The
      // task-evidence sidecar must never gain a stamp for it, and in
      // particular must never cite the coincidental foreign base commit's
      // SHA as if it were real evidence — that is the precise #456
      // manifestation: a poisoned (over-wide) evidence range lets a foreign
      // commit that merely shares the trailer + declared path stand in for
      // real branch work once a rebase makes it reachable from HEAD.
      let evidenceStamp: { sha?: string; form?: string } | undefined;
      try {
        const evidenceRaw = await readFile(
          join(dir, '.pipeline/task-evidence.json'),
          'utf-8',
        );
        const evidence = JSON.parse(evidenceRaw);
        evidenceStamp = evidence.evidenceStamps?.['1'];
      } catch {
        evidenceStamp = undefined;
      }
      if (evidenceStamp) {
        // If some stamp exists at all, it must not be the foreign
        // coincidental commit's SHA — pinning the exact bug shape rather
        // than just "some stamp exists".
        expect(evidenceStamp.sha).not.toBe(coincidentalSha);
      }
      expect(evidenceStamp).toBeFalsy();

      // The build gate must never mechanically confirm task 1 from the
      // coincidental commit — the loop must keep dispatching build (or HALT
      // exhausted) rather than silently converge as if the work were done.
      // A false-positive here (build "done" with zero real evidence, citing
      // the foreign commit) is exactly the #456/#463 halt/rekick failure
      // mode this feature closes.
      expect(buildRuns).toBeGreaterThan(1);
      if (completed) {
        // If the run DID converge, the finish artifact must never have been
        // produced off the back of an unevidenced task — this branch only
        // exercises if some other mechanism (not git evidence) legitimately
        // satisfied build; assert the coincidental sha specifically was
        // never recorded as task 1's evidence (covered above), so this is
        // a belt-and-suspenders check.
        await expect(access(join(dir, '.pipeline/DONE'))).resolves.toBeUndefined();
      } else {
        // Exhausted retries without ever finding real evidence — the run
        // must HALT rather than silently ship, and must never reach finish.
        expect(halted).toBe(true);
      }
    },
  );

  it('a file-changing rebase with genuinely-missing evidence still dispatches build (Story 2, Task 9)', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await anchorOriginMain();

    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    const ran: string[] = [];
    let buildRuns = 0;
    let buildReviewRuns = 0;
    let verdictAtSecondBuildDispatch: any = null;
    const runner: StepRunner = {
      run: async (step) => {
        ran.push(step);
        if (step === 'build') {
          buildRuns++;
          if (buildRuns === 2) {
            // Capture the verdict the rebase step's invalidation wrote BEFORE
            // this second dispatch's own completion write overwrites it —
            // this is the intermediate on-disk shape the kickback produced.
            try {
              verdictAtSecondBuildDispatch = JSON.parse(
                await readFile(join(dir, '.pipeline/gates/build.json'), 'utf-8'),
              );
            } catch {
              verdictAtSecondBuildDispatch = null;
            }
            // The build agent's SECOND dispatch (post-rebase kickback) does
            // the genuinely-pending work: task 2 finally gets its evidence
            // trailer. Task 1's own evidence intentionally still does not
            // exist at this point (see below) — the whole point of this
            // fixture is that the build gate's FIRST-ever evaluation (right
            // after this same runner's first dispatch, before any rebase
            // even runs) must succeed WITHOUT a real plan/evidence-derivation
            // check in play, so we don't introduce the plan file until the
            // build_review step below — after that first check has already
            // passed.
            await writeFile(join(dir, 'src/other.ts'), 'export const other = 1;\n');
            await git('add', '.');
            await git('commit', '-m', 'feat: implement task 2\n\nTask: 2');
          }
        }
        if (step === 'build_review') {
          buildReviewRuns++;
          if (buildReviewRuns === 1) {
            // Introduce the plan (task 1 evidenced, task 2 NOT) only now —
            // build's own FIRST completion check (right after its first
            // dispatch above) already ran against a plan-less repo, where
            // the build gate's real-git-evidence derivation is not engaged
            // (no `.docs/plans/*.md` exists yet), so it passed on the
            // ordinary artifact check. From here on the plan is on disk, so
            // the REBASE step's mechanical pre-verify (once implemented) —
            // and today's unconditional invalidation — both see the real,
            // genuinely-incomplete evidence state for build's SECOND check.
            await mkdir(join(dir, '.docs/plans'), { recursive: true });
            await writeFile(
              join(dir, '.docs/plans/p.md'),
              '### Task 1: Implement feature\n**Files:** `src/feature.ts`\n\n### Task 2: Implement other\n**Files:** `src/other.ts`\n',
            );
            await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 2;\n');
            await git('add', '.');
            await git('commit', '-m', 'feat: implement task 1\n\nTask: 1');
          }
        }
        return satisfy(step);
      },
    };
    let completed = false;
    const kicks: Array<{ from: string; to: string }> = [];
    let reverifiedBuild = false;
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });
    (events as any).on('rebase_gate_reverified', (e: any) => {
      if (e?.type === 'rebase_gate_reverified' && e.step === 'build') {
        reverifiedBuild = true;
      }
    });

    await conductorWith(runner).run();

    // Task 2 has no evidence → build is genuinely incomplete → today's
    // unconditional-invalidation behavior is preserved (C3).
    expect(buildRuns).toBe(2);
    expect(kicks).toContainEqual({ from: 'rebase', to: 'build' });
    expect(reverifiedBuild).toBe(false);
    expect(completed).toBe(true);

    expect(verdictAtSecondBuildDispatch).not.toBeNull();
    expect(verdictAtSecondBuildDispatch.satisfied).toBe(false);
    expect(verdictAtSecondBuildDispatch.kickback?.from).toBe('rebase');
    expect(typeof verdictAtSecondBuildDispatch.kickback?.evidence).toBe('string');
    expect(verdictAtSecondBuildDispatch.kickback.evidence).toMatch(
      /rebase changed code\/test paths/,
    );
  });

  it(
    'a file-changing rebase kickback re-verifies build_review too, even when build itself is ' +
      'mechanically confirmed and skipped (Story 3, Task 10, amends TS-5 negative 4 / #324 Task 18)',
    async () => {
      // The re-verify target set for a code-changing rebase kickback must
      // still include build_review even on the evidence-intact lap:
      // build_review grades the diff that the rebase just changed, so it is
      // NOT eligible for the mechanical pre-verify (ADR: not tree-attesting)
      // and must re-run regardless of whether build itself was skipped.
      await initRepoOnFeatureBranch({
        path: 'src/feature.ts',
        content: 'export const foo = 1;\n',
      });
      await seedEvidenceCompleteBuild();

      await git('checkout', BASE);
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
      await git('add', '.');
      await git('commit', '-m', 'sibling code merged to base');
      await git('checkout', 'feature/foo');

      await writeState(statePath, { ...FRONT_DONE });
      const fakeGit: GitRunner = async (args) =>
        args.includes('--symbolic-full-name')
          ? { stdout: 'refs/remotes/origin/feature/x\n' }
          : { stdout: '' };
      const config = { build_review: { enabled: true } };
      let buildRuns = 0;
      let buildReviewRuns = 0;
      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build') buildRuns++;
          if (step === 'build_review') buildReviewRuns++;
          return satisfy(step);
        },
      };
      const conductor = new Conductor({
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
        config,
      });

      let completed = false;
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('feature_complete', () => {
        completed = true;
      });
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });

      await conductor.run();

      // build_review ran once before the rebase and a second time as part of
      // the rebase re-verify — even though build itself was mechanically
      // confirmed and NOT re-dispatched (buildRuns stays 1), build_review is
      // not eligible for the pre-verify and always re-runs.
      expect(buildRuns).toBe(1);
      expect(buildReviewRuns).toBe(2);
      expect(kicks).toContainEqual({ from: 'rebase', to: 'build_review' });
      expect(kicks).not.toContainEqual({ from: 'rebase', to: 'build' });
      expect(completed).toBe(true);
    },
  );

  it('a file-changing rebase invalidates manual_test despite a fresh same-session all-PASS results file (Story 3 negative, Task 10)', async () => {
    // manual_test's predicate is NOT tree-attesting (latest-attempt scan +
    // session-freshness mtime) — a pre-rebase PASS file written earlier in
    // the SAME daemon session must not satisfy the gate without a re-run.
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await seedEvidenceCompleteBuild();

    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', 'feature/foo');

    await writeState(statePath, { ...FRONT_DONE });
    let manualTestRuns = 0;
    let verdictAtSecondManualTestRun: any = null;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'manual_test') {
          manualTestRuns++;
          if (manualTestRuns === 2) {
            // Read the on-disk verdict BEFORE this run's own satisfy() call
            // overwrites it — this is the state the rebase kickback left
            // behind: the fresh all-PASS file from lap 1 must have already
            // been invalidated, not trusted as still-current.
            const raw = await readFile(
              join(dir, '.pipeline/gates/manual_test.json'),
              'utf-8',
            );
            verdictAtSecondManualTestRun = JSON.parse(raw);
          }
        }
        return satisfy(step);
      },
    };
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductorWith(runner).run();

    expect(manualTestRuns).toBe(2);
    expect(verdictAtSecondManualTestRun).not.toBeNull();
    expect(verdictAtSecondManualTestRun.satisfied).toBe(false);
    expect(verdictAtSecondManualTestRun.kickback?.from).toBe('rebase');
    expect(completed).toBe(true);
  });

  it('a file-changing rebase never kicks back a skipped manual_test, only build_review (Story 3 negative, Task 10)', async () => {
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

    // Pre-seed manual_test as 'skipped' for this feature (mirrors
    // test/engine/conductor.test.ts's seedShipTail idiom) so the selector
    // never dispatches it.
    await writeState(statePath, { ...FRONT_DONE, manual_test: 'skipped' });
    const ran: string[] = [];
    let completed = false;
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('feature_complete', () => {
      completed = true;
    });
    events.on('kickback', (e) => {
      if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
    });

    await conductorWith(passthroughRunner(ran)).run();

    expect(ran).not.toContain('manual_test');
    expect(kicks).toContainEqual({ from: 'rebase', to: 'build_review' });
    expect(kicks).not.toContainEqual({ from: 'rebase', to: 'manual_test' });
    expect(completed).toBe(true);
  });

  it('regression: a build_review kickback re-opening build is dispatched despite intact git evidence (Story 4, Task 11 — expected: passes immediately)', async () => {
    // The mechanical pre-verify lives ONLY inside the rebase invalidation
    // path (applyRebaseVerdicts). This test never runs a rebase at all — it
    // pins that a build_review-authored kickback (simulating a review
    // requesting rework) always dispatches build, even though build's own
    // git evidence still derives complete. No rebase step needs to exist for
    // this to hold; it is a structural property of where the pre-verify is
    // wired, so it should pass before and after the feature lands.
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await seedEvidenceCompleteBuild();

    await writeState(statePath, { ...FRONT_DONE });
    const fakeGit: GitRunner = async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/x\n' }
        : { stdout: '' };
    const config = { build_review: { enabled: true } };
    let buildRuns = 0;
    let reviewKickbackWritten = false;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') buildRuns++;
        if (step === 'build_review' && !reviewKickbackWritten) {
          reviewKickbackWritten = true;
          // Simulate build_review authoring a kickback verdict re-opening
          // build directly (kickback.from === 'build_review'), NOT a rebase
          // invalidation — this is what a real review-FAIL write looks like
          // on disk (see gate-verdicts.ts writeVerdict).
          await mkdir(join(dir, '.pipeline/gates'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/gates/build.json'),
            JSON.stringify({
              satisfied: false,
              reason: 'review requested rework',
              checkedAt: Date.now(),
              kickback: { from: 'build_review', evidence: 'rubric: scope violation' },
            }),
          );
          // build_review's OWN objective completion (BUILD_REVIEW_VERDICT —
          // .pipeline/build-review.json) must still pass, or the loop gets
          // stuck retrying build_review itself and never reaches the build
          // kickback it just wrote above.
          return satisfy('build_review');
        }
        return satisfy(step);
      },
    };
    const conductor = new Conductor({
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
      config,
    });

    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    await conductor.run();

    // build_review's kickback re-opened build — the loop must dispatch it
    // for rework regardless of build's intact evidence. No mechanical
    // pre-check anywhere intercepts a non-rebase kickback. (`build` is not a
    // registered `kickbackTarget` step — unlike prd/architecture_review/
    // stories/plan — so the selector reselects it purely off the verdict
    // file's `satisfied: false`; no `kickback` event is emitted for this path
    // today, only for the rebase-specific carve-out, so this pin does not
    // assert on one.)
    expect(buildRuns).toBe(2);
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
