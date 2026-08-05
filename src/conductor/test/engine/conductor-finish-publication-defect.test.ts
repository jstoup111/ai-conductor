/**
 * A finish gate refusal that is PURELY a publication defect — the recorded PR
 * still carries the engine's placeholder body — must be routed back to `finish`
 * for a body rewrite. It must NOT reach the `/remediate` planner, whose
 * vocabulary (build | acceptance_specs | architecture_review | plan | halt) has
 * no route for "rewrite a PR body" and therefore classifies a 30-second
 * `gh pr edit` as a full BUILD.
 *
 * Real daemon-mode `Conductor.run()` over fake `gh` / `git` runners: no real
 * binary, no network. The one-shot `.pipeline/pr-body-regen-attempt.json`
 * record the finish gate already writes bounds the re-dispatch — the second
 * pass falls through to the engine's deterministic body floor so the feature
 * still converges.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { PR_BODY_FLOOR_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const PR_URL = 'https://github.com/acme/repo/pull/1295';

/** Every `gh pr view` reports an open, non-draft PR whose body is the floor placeholder. */
function flooredBodyGh(): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    return {
      stdout: JSON.stringify({
        url: PR_URL,
        state: 'OPEN',
        title: 'feat: unattended finish',
        isDraft: false,
        labels: [],
        comments: [],
        body: `${PR_BODY_FLOOR_MARKER}\n\n## Why\n\nunattended finish\n`,
      }),
    };
  };
  return { gh, calls };
}

/** Push evidence: HEAD is an ancestor of its upstream tracking ref. */
function pushedGit(): GitRunner {
  return async (args) => {
    if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/unattended\n' };
    return { stdout: '' };
  };
}

async function markerExists(dir: string, rel: string): Promise<boolean> {
  return access(join(dir, rel)).then(
    () => true,
    () => false,
  );
}

describe('conductor/finish publication defect', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finish-publication-defect-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    statePath = join(dir, '.pipeline/conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedShipTail(): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'finish') break;
      state[s.name] = 'done';
    }
    Object.assign(state, {
      complexity_tier: 'L',
      feature_desc: 'unattended finish',
      worktree_branch: 'feat/unattended',
      build_review: 'skipped',
      manual_test: 'skipped',
      prd_audit: 'skipped',
      retro: 'skipped',
      architecture_review_as_built: 'skipped',
      rebase: 'skipped',
      pr_url: PR_URL,
    });
    await writeState(statePath, state as unknown as ConductState);
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
  }

  it('re-dispatches finish for a body rewrite instead of routing a placeholder body through /remediate', async () => {
    await seedShipTail();
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatched.push(step);
        if (step === 'finish') {
          // The finish agent records its outcome but (this is the defect under
          // test) never authors a real PR body.
          await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');
        }
        return { success: true };
      }),
    };
    const { gh } = flooredBodyGh();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'finish',
      maxRetries: 1,
      gh,
      git: pushedGit(),
      shipmentEvidence: async () => ({ kind: 'valid' }) as never,
      escalateBuildFailure: async () => ({}),
    } as never);

    await conductor.run();

    // The publication defect never reaches the remediation planner, and never
    // re-opens the build.
    expect(dispatched).not.toContain('remediate');
    expect(dispatched).not.toContain('build');
    // finish is re-dispatched exactly once for the body rewrite.
    expect(dispatched.filter((s) => s === 'finish')).toHaveLength(2);
    // The one-shot record bounds it, and the floor converges the feature.
    expect(await markerExists(dir, '.pipeline/pr-body-regen-attempt.json')).toBe(true);
    expect(await markerExists(dir, '.pipeline/HALT')).toBe(false);
    expect(await markerExists(dir, '.pipeline/DONE')).toBe(true);
  });
});
