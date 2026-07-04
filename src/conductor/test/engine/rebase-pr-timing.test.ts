/**
 * Post-rebase force-with-lease publish hook (T11 / TS-4 /
 * adr-2026-07-03-pr-timing-config-key).
 *
 * Purpose: pin the invariant that when a REAL daemon rebase rewrites history
 * (the feature branch is reapplied onto an advanced base), the early-draft
 * branch — already pushed once via the build-start hook (T7) — is
 * republished with EXACTLY one `--force-with-lease` push. When the rebase is
 * a satisfied no-op (the branch was already current, nothing rewritten),
 * zero force-flagged pushes occur.
 *
 * This drives the REAL Conductor over a REAL git repo in a tmpdir (rebase
 * outcomes — noop vs changed — can only be observed against real git state),
 * matching the pattern in test/integration/rebase-loop.test.ts. The
 * `gitForPublish` seam (T4 push primitives) is injected as a fake so the
 * publish hooks never touch the real repo's remote — only the rebase itself
 * (via the engine's internal `makeGitRunner`) runs real git.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ConductState, HarnessConfig } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

const execFileAsync = promisify(execFile);

// Deterministic default-branch name regardless of host git config.
const BASE = 'main';
const FEATURE = 'feature/foo';

interface RecordedCall {
  args: string[];
  cwd: string;
}

function makeFakeGh(): { gh: GhRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const gh: GhRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    if (args[0] === 'pr' && args[1] === 'create') {
      return { stdout: 'https://github.com/acme/repo/pull/1\n' };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

// A fake gitForPublish runner recording calls, standing in for the T4 push
// primitives seam. `rev-list --count` always reports 1 (ahead of base), so
// the build-start hook's early-draft publish path exercises normally; the
// force-with-lease site is what this suite actually asserts on.
function makeFakeGitForPublish(): { git: GitRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const git: GitRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    if (args[0] === 'rev-list' && args[args.length - 1]?.includes('..')) {
      return { stdout: '1\n' };
    }
    return { stdout: '' };
  };
  return { git, calls };
}

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

describe('engine/conductor — post-rebase force-with-lease publish (T11 / TS-4)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function initRepoOnFeatureBranch(): Promise<void> {
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# base\n');
    await git('add', '.');
    await git('commit', '-m', 'initial commit on base');

    await git('checkout', '-b', FEATURE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }

  // Advance BASE with a non-conflicting NEW *code* file so the rebase
  // classifies as a history-rewriting 'changed' outcome (FR-5's
  // isCodeOrTestPath classifier only counts src/test paths — a docs-only
  // advance classifies as 'noop' even though commits were technically
  // replayed, so this must touch `src/`).
  async function advanceBaseNonConflicting(): Promise<void> {
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/sibling.ts'), 'export const sib = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling code merged to base');
    await git('checkout', FEATURE);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebase-pr-timing-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function passthroughRunner(ran: string[]): StepRunner {
    return {
      run: async (step): Promise<StepRunResult> => {
        ran.push(step);
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
        } else if (step === 'finish') {
          await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
        }
        return { success: true };
      },
    };
  }

  function forceWithLeaseCalls(calls: RecordedCall[]): RecordedCall[] {
    return calls.filter(
      (c) => c.args[0] === 'push' && c.args.includes('--force-with-lease'),
    );
  }

  it('successful history-rewriting rebase (early-draft, daemon, prior push) → exactly one force-with-lease push', async () => {
    await initRepoOnFeatureBranch();
    await advanceBaseNonConflicting();

    await writeState(statePath, { ...FRONT_DONE, worktree_branch: FEATURE });
    const { gh } = makeFakeGh();
    const { git: gitForPublish, calls } = makeFakeGitForPublish();
    const ran: string[] = [];

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: passthroughRunner(ran),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: false,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
      gh,
      gitForPublish,
    });

    await conductor.run();

    const leaseCalls = forceWithLeaseCalls(calls);
    expect(leaseCalls).toHaveLength(1);
    expect(leaseCalls[0].args).toEqual(['push', '--force-with-lease', 'origin', FEATURE]);
    // The lease-guarded push is the ONLY force-flagged push observed.
    expect(calls.filter((c) => c.args.includes('--force'))).toHaveLength(1);
  });

  it('rebase satisfied-as-no-op (branch already current) → zero force-with-lease pushes', async () => {
    await initRepoOnFeatureBranch();
    // No base advance: the branch is already current relative to BASE, so the
    // rebase step is a no-op (nothing to rewrite/republish).

    await writeState(statePath, { ...FRONT_DONE, worktree_branch: FEATURE });
    const { gh } = makeFakeGh();
    const { git: gitForPublish, calls } = makeFakeGitForPublish();
    const ran: string[] = [];

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: passthroughRunner(ran),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: false,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
      gh,
      gitForPublish,
    });

    await conductor.run();

    expect(forceWithLeaseCalls(calls)).toHaveLength(0);
  });

  // Task 12: rebase-HALT and lease-rejection negatives (TS-4 negatives).

  it('rebase-conflict HALT (real conflict, same file edited on both sides) → zero push argv of any kind while paused', async () => {
    // Same source file modified differently on both base and feature branch
    // (matches the conflict setup in test/integration/rebase-loop.test.ts) —
    // performRebase produces a real `conflict_halt`, which must NEVER reach
    // the T11 publish hook: pushing a branch that is mid-rebase (unmerged
    // paths on disk) would publish a half-resolved, conflict-marker-laden
    // tree to the remote.
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'initial feature file');

    await git('checkout', '-b', FEATURE);
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch edits feature');

    await git('checkout', BASE);
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base edits feature');
    await git('checkout', FEATURE);

    await writeState(statePath, { ...FRONT_DONE, worktree_branch: FEATURE });
    const { gh } = makeFakeGh();
    const { git: gitForPublish, calls } = makeFakeGitForPublish();
    const ran: string[] = [];
    let halted = false;
    events.on('loop_halt', () => {
      halted = true;
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: passthroughRunner(ran),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: false,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
      gh,
      gitForPublish,
    });

    await conductor.run();

    expect(halted).toBe(true);
    expect(ran).not.toContain('finish');
    // Zero pushes of ANY kind (plain or force-with-lease) via the publish
    // seam while the rebase is paused mid-conflict.
    expect(calls.filter((c) => c.args[0] === 'push')).toHaveLength(0);
  });

  it('lease rejection (--force-with-lease push fails) → loud log, NO bare --force retry, build continues to finish', async () => {
    await initRepoOnFeatureBranch();
    await advanceBaseNonConflicting();

    await writeState(statePath, { ...FRONT_DONE, worktree_branch: FEATURE });
    const { gh } = makeFakeGh();

    // gitForPublish: the initial (build-start) plain push succeeds; the
    // post-rebase --force-with-lease republish is rejected — simulating the
    // remote tip having moved again in between (the exact scenario
    // --force-with-lease exists to guard against).
    const calls: RecordedCall[] = [];
    const gitForPublish: GitRunner = async (args, opts) => {
      calls.push({ args: [...args], cwd: opts.cwd });
      if (args[0] === 'rev-list' && args[args.length - 1]?.includes('..')) {
        return { stdout: '1\n' };
      }
      if (args[0] === 'push' && args.includes('--force-with-lease')) {
        throw new Error('stale info; fetch first (rejected --force-with-lease)');
      }
      return { stdout: '' };
    };

    let leaseRejectionLogsEmitted = 0;
    const originalError = console.error;
    console.error = (msg: string) => {
      if (
        typeof msg === 'string' &&
        msg.includes('pushBranch') &&
        msg.includes('force-with-lease')
      ) {
        leaseRejectionLogsEmitted++;
      }
    };

    const ran: string[] = [];
    let completed = false;
    events.on('feature_complete', () => {
      completed = true;
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: passthroughRunner(ran),
        events,
        projectRoot: dir,
        daemon: true,
        selfHost: false,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'build',
        maxRetries: 1,
        config: { pr_timing: 'early-draft' } as unknown as HarnessConfig,
        gh,
        gitForPublish,
      });

      await conductor.run();
    } finally {
      console.error = originalError;
    }

    expect(leaseRejectionLogsEmitted).toBeGreaterThanOrEqual(1);
    // No bare `--force` retry anywhere: the lease guard fails advisory, not
    // escalating to a more dangerous unconditional force push.
    expect(calls.filter((c) => c.args.includes('--force') && !c.args.includes('--force-with-lease'))).toHaveLength(0);
    // The build continues to finish despite the failed republish.
    expect(ran).toContain('finish');
    expect(completed).toBe(true);
  });

  it('finish mode (pr_timing: finish) → zero pushes at the post-rebase publish site', async () => {
    await initRepoOnFeatureBranch();
    await advanceBaseNonConflicting();

    await writeState(statePath, { ...FRONT_DONE, worktree_branch: FEATURE });
    const { gh } = makeFakeGh();
    const { git: gitForPublish, calls } = makeFakeGitForPublish();
    const ran: string[] = [];

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: passthroughRunner(ran),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: false,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      config: { pr_timing: 'finish' } as unknown as HarnessConfig,
      gh,
      gitForPublish,
    });

    await conductor.run();

    expect(calls.filter((c) => c.args[0] === 'push')).toHaveLength(0);
  });
});
