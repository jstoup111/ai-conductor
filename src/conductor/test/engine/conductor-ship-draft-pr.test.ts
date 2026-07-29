/**
 * Conductor wiring for the SHIP-phase-entry draft PR.
 *
 * The implementation PR must be opened as a DRAFT when the SHIP phase starts —
 * before the first SHIP step is dispatched — not at `finish`. Fakes are
 * injected at the `gh`/`git` boundary; no real binary runs.
 */

import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import type { StepName } from '../../src/types/index.js';

const PR_URL = 'https://github.com/acme/repo/pull/42';
const BRANCH = 'feat/widget-import';

function fakes() {
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push([...args]);
    if (args[1] === 'view') throw new Error('no pull requests found');
    if (args[1] === 'create') return { stdout: `${PR_URL}\n` };
    return { stdout: '' };
  };
  const git: GitRunner = async (args) => {
    gitCalls.push([...args]);
    if (args[0] === 'rev-list') return { stdout: '3\n' };
    return { stdout: '' };
  };
  return { gh, git, ghCalls, gitCalls };
}

describe('conductor opens a draft implementation PR at SHIP-phase start', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ship-draft-pr-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const buildDone = {
    acceptance_specs: 'done',
    build: 'done',
    build_review: 'done',
    wiring_check: 'done',
    test_suite: 'done',
    worktree_branch: BRANCH,
    feature_desc: 'widget import flow',
  };

  it('creates the PR with --draft BEFORE the first SHIP step is dispatched', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    let ghCallsAtDispatch = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'manual_test') ghCallsAtDispatch = ghCalls.length;
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    const create = ghCalls.find((c) => c[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain('--draft');
    expect(create![create!.indexOf('--head') + 1]).toBe(BRANCH);
    expect(create![create!.indexOf('--base') + 1]).toBe('main');

    // Published before the SHIP step ran, and off a pushed branch.
    expect(ghCallsAtDispatch).toBeGreaterThan(0);
    expect(gitCalls).toContainEqual(['push', '-u', 'origin', BRANCH]);
  });

  it('publishes at most once per run — later SHIP steps do not re-push or re-open', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    expect(ghCalls.filter((c) => c[1] === 'create')).toHaveLength(1);
    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(1);
  });

  it('does not publish while the run is still in BUILD-phase steps', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done', worktree_branch: BRANCH }), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> =>
        // Stop the loop at the end of BUILD so no SHIP step is reached.
        step === 'test_suite' ? { success: false, output: 'stop' } : { success: true },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'acceptance_specs',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
      maxRetries: 1,
    });

    await conductor.run();

    expect(ghCalls.filter((c) => c[1] === 'create')).toHaveLength(0);
    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(0);
  });

  it('is advisory: a gh failure at ship start does not stop the SHIP phase', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const gh: GhRunner = async () => {
      throw new Error('gh: not authenticated');
    };
    const git: GitRunner = async (args) =>
      args[0] === 'rev-list' ? { stdout: '3\n' } : { stdout: '' };

    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await expect(conductor.run()).resolves.not.toThrow();
    expect(dispatched).toContain('manual_test');
  });
});
