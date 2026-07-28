import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';
import { readLastResolvedCount } from '../../src/engine/task-evidence.js';
import { countResolvedTasks } from '../../src/engine/task-progress.js';

describe('conductor protected-artifact self-amendment advisory', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('warns once about every tolerated self-amendment and continues the BUILD dispatch', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: true,
      seal: { version: 1, baselineCommit: 'approved-commit', protectedArtifacts: [] },
      selfAmendments: [
        {
          path: '.docs/architecture/feature.md',
          sealedFingerprint: 'sha256:sealed-architecture',
          currentFingerprint: 'sha256:current-architecture',
        },
        {
          path: '.docs/plans/feature.md',
          sealedFingerprint: 'sha256:sealed-plan',
          currentFingerprint: 'sha256:current-plan',
        },
      ],
    });
    const createSeal = vi.spyOn(protectedArtifactSeal, 'createProtectedArtifactSeal').mockResolvedValue({
      version: 1,
      baselineCommit: 'approved-commit',
      protectedArtifacts: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchedSteps: string[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatchedSteps.push(step);
        return step === 'build'
          ? { success: false, output: 'expected stop after BUILD dispatch' }
          : { success: true };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 1,
    });

    await conductor.run();

    expect({
      warnings: warn.mock.calls.map(([message]) => message),
      firstDispatchedStep: dispatchedSteps[0],
      firstBuildSealCreation: createSeal.mock.calls[0],
    }).toEqual({
      warnings: [expect.stringMatching(
        /\.docs\/architecture\/feature\.md.*\.docs\/plans\/feature\.md.*approved plan.*build_review/s,
      )],
      firstDispatchedStep: 'build',
      firstBuildSealCreation: [{ projectRoot, baselineCommit: 'approved-commit' }],
    });
  });

  it('keeps the clean successful BUILD path quiet', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: true,
      seal: { version: 1, baselineCommit: 'approved-commit', protectedArtifacts: [] },
      selfAmendments: [],
    });
    vi.spyOn(protectedArtifactSeal, 'createProtectedArtifactSeal').mockResolvedValue({
      version: 1,
      baselineCommit: 'approved-commit',
      protectedArtifacts: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchedSteps: string[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatchedSteps.push(step);
        return { success: false, output: 'expected stop after BUILD dispatch' };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 1,
    });

    await conductor.run();

    expect({ warnings: warn.mock.calls, dispatchedSteps }).toEqual({
      warnings: [],
      dispatchedSteps: ['build'],
    });
  });

  it('keeps a failed seal on the protected-artifact halt path without an advisory', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/feature.md',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn(async () => {
      throw new Error('unexpected dispatch after protected-artifact seal failure');
    });
    const runner: StepRunner = { run };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 2,
    });

    await conductor.run();

    expect({
      warnings: warn.mock.calls,
      dispatches: run.mock.calls,
      halt: await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
    }).toEqual({
      warnings: [],
      dispatches: [],
      halt: expect.stringContaining('Protected artifact changed: .docs/plans/feature.md'),
    });
  });

  it('stamps lastResolvedCount on the protected-artifact halt so the halted build earns no progress re-kick', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    // Two of three plan tasks already resolved — the live resolved count the
    // daemon's `isProgressReKickEligible` compares the sidecar stamp against.
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({
        plan_ref: '.docs/plans/feature.md',
        tasks: [
          { id: '1', name: 'one', status: 'completed' },
          { id: '2', name: 'two', status: 'completed' },
          { id: '3', name: 'three', status: 'pending' },
        ],
      }),
      'utf8',
    );

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: false,
      reason: 'Protected artifact changed: .docs/stories/other-feature.md',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner: StepRunner = {
      run: vi.fn(async () => {
        throw new Error('unexpected dispatch after protected-artifact seal failure');
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 2,
    });

    await conductor.run();

    expect({
      lastResolvedCount: await readLastResolvedCount(projectRoot),
      liveResolvedCount: await countResolvedTasks(projectRoot),
    }).toEqual({ lastResolvedCount: 2, liveResolvedCount: 2 });
  });
});
