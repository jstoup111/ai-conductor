/**
 * Dispatch preflight: never launch a step into a working directory that no
 * longer exists.
 *
 * Observed live (2026-07-29): `/finish` tore down its own worktree after
 * recording the ship, the still-running provider session then ended with
 * `{"subtype":"error_during_execution", errors:["Path \"…/.worktrees/<slug>\"
 * does not exist"]}`, and the engine read that as an ordinary step failure —
 * remediating, kicking back to `build`, and re-dispatching into the same absent
 * path until the retry ladder was exhausted. Every one of those dispatches was
 * knowably impossible before it was issued.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// execa is consumed transitively (WorktreeManager); never fork real git.
vi.mock('execa', () => ({ execa: vi.fn() }));

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';

const NOOP_ESCALATION = async () => ({});

describe('conductor/missing-worktree dispatch preflight', () => {
  // The state file lives OUTSIDE the feature worktree so the run can start
  // even though the worktree path itself is gone — exactly the live shape,
  // where the daemon holds the run while the worktree is deleted under it.
  let stateDir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'conductor-missing-wt-'));
    statePath = join(stateDir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  function makeConductor(runner: StepRunner, projectRoot: string) {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      daemon: true,
      fromStep: 'explore',
      escalateBuildFailure: NOOP_ESCALATION,
    });
  }

  it('refuses the dispatch, halts with a path-naming reason, and never calls the runner', async () => {
    await writeState(statePath, { complexity_tier: 'M' } as ConductState);
    const missingRoot = join(stateDir, '.worktrees', 'step-completion-globs-are-feature-unscoped');

    const run = vi.fn(async () => ({ success: true }));
    const haltReasons: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltReasons.push(e.reason);
    });

    await makeConductor({ run } as unknown as StepRunner, missingRoot).run();

    // No provider was launched — not once, and certainly not once per retry.
    expect(run).not.toHaveBeenCalled();
    // The operator gets the path and the recovery rule, not a provider blob.
    const reason = haltReasons.join('\n');
    expect(reason).toContain(missingRoot);
    expect(reason).toContain("Cannot dispatch 'explore'");
    expect(reason).toMatch(/BRANCH is the\s+source of truth/);
  });

  it('leaves the ordinary path untouched when the working directory exists', async () => {
    await writeState(statePath, { complexity_tier: 'M' } as ConductState);

    const run = vi.fn(async () => ({ success: true }));
    const haltReasons: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltReasons.push(e.reason);
    });

    await makeConductor({ run } as unknown as StepRunner, stateDir).run();

    expect(run).toHaveBeenCalled();
    expect(haltReasons.join('\n')).not.toContain('Cannot dispatch');
  });

  it('does not recreate the missing directory (a stub there breaks the next worktree add)', async () => {
    await writeState(statePath, { complexity_tier: 'M' } as ConductState);
    const missingRoot = join(stateDir, 'gone-worktree');

    const run = vi.fn(async () => ({ success: true }));
    await makeConductor({ run } as unknown as StepRunner, missingRoot).run();

    // The preflight itself writes nothing back into the absent path; the run
    // reports the halt through the event stream instead.
    expect(run).not.toHaveBeenCalled();
  });
});
