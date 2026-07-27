import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';

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
});
