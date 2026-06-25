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
  brainstorm: 'done',
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
        join(dir, '.docs/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
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
});
