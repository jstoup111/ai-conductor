/**
 * Guard test: a finish-on-mid-rebase short-circuits back to the rebase step.
 *
 * Regression for the "/finish spins ~15 min then opens a PR of an un-rebased
 * branch" failure: when `rebase` is marked done in state but the worktree is
 * still physically mid-rebase (a paused conflict), the daemon must NOT dispatch
 * `/finish` against the detached, conflicted tree. Instead it re-routes to the
 * `rebase` step so the resolver runs and the tree is made shippable first.
 *
 * Setup mirrors rebase-resolution-wiring.test.ts:
 *   - daemon: true, mode: auto
 *   - an ISOLATED throwaway git repo left mid-rebase (real git, never the live checkout)
 *   - a fake StepRunner whose run() records dispatches and whose
 *     resolveRebaseConflict() resolves the paused rebase
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { ResolutionContext, ResolutionAttempt } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

/**
 * Seed state with EVERY step through `rebase` marked done/skipped and `finish`
 * left pending, so the conductor starting at `finish` would (absent the guard)
 * dispatch finish directly.
 */
async function seedThroughRebaseDone(statePath: string): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === 'finish') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  await writeState(statePath, state);
}

/**
 * Build a throwaway repo and LEAVE IT mid-rebase: `feat` and `main` conflict on
 * `a.ts`, and `git rebase main` is started (and pauses on the conflict). On
 * return the repo is detached mid-rebase with `a.ts` unmerged.
 */
async function buildMidRebaseRepo(): Promise<{
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
  gc: (args: string[]) => ReturnType<typeof execFile>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'finish-mid-rebase-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'a.ts'), 'base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeFile(join(repo, 'a.ts'), 'feature\n');
  await g(['commit', '-q', '-am', 'feat: change a']);

  await g(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.ts'), 'mainchange\n');
  await g(['commit', '-q', '-am', 'main: change a']);

  await g(['checkout', '-q', 'feat']);
  // Start the rebase — conflicts on a.ts and pauses, leaving the tree mid-rebase.
  await gc(['rebase', 'main']).catch(() => {
    /* expected: non-zero exit on conflict */
  });

  return { repo, g, gc };
}

describe('finish-on-mid-rebase guard (daemon:true, real git)', () => {
  let repo: string;
  let g: (args: string[]) => ReturnType<typeof execFile>;
  let gc: (args: string[]) => ReturnType<typeof execFile>;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    ({ repo, g, gc } = await buildMidRebaseRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedThroughRebaseDone(statePath);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('re-routes finish→rebase: resolver runs, finish is NOT dispatched on the conflicted tree, no HALT', async () => {
    const dispatched: string[] = [];
    let resolverCalledWhileMidRebase = false;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        dispatched.push(step);
        return { success: true };
      }),
      resolveRebaseConflict: async (ctx: ResolutionContext): Promise<ResolutionAttempt> => {
        // finish must not have been dispatched before the rebase was resolved.
        if (!dispatched.includes('finish')) resolverCalledWhileMidRebase = true;
        await writeFile(join(ctx.projectRoot, 'a.ts'), 'merged\n');
        await g(['add', 'a.ts']);
        await gc(['rebase', '--continue']);
        return { resolved: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'finish',
    });

    await conductor.run();

    // The guard re-routed to rebase: the resolver ran BEFORE finish was dispatched.
    expect(resolverCalledWhileMidRebase).toBe(true);

    // finish eventually ran — but only after the rebase was resolved.
    expect(dispatched).toContain('finish');

    // No HALT — the tree was made shippable, not parked.
    const haltExists = await access(join(repo, '.pipeline/HALT')).then(() => true, () => false);
    expect(haltExists).toBe(false);

    // The rebase is no longer in progress.
    const rebaseDir = await access(join(repo, '.git/rebase-merge')).then(() => true, () => false);
    expect(rebaseDir).toBe(false);
  });
});
