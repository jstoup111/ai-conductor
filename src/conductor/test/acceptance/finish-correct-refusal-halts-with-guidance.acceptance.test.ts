/**
 * Acceptance spec for Stories 3-4's terminal FINISH refusal flow.
 *
 * The real production coordinator observes ordinary authored prose, dispatches
 * its judgment pass, and returns the refusal that Conductor renders as HALT.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const BLOCKER = 'CHANGELOG carries an unsubstituted {{IMPLEMENTATION_PR}} token';

describe('acceptance: a correct FINISH refusal stops with its guidance', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'finish-correct-refusal-'));
    const pipelineDir = join(projectRoot, '.pipeline');
    stateFilePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(pipelineDir);
    await mkdir(join(projectRoot, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(pipelineDir, 'finish-choice'), 'pr\n');
    await writeFile(join(projectRoot, '.docs', 'shipped', 'finish-correct-refusal.md'), 'shipped\n');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'finish-correct-refusal',
      worktree_branch: 'feat/finish-correct-refusal',
      pr_url: 'https://github.com/acme/widget/pull/1172',
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    await writeState(stateFilePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('writes the refusal message, next action, and provider detail as a needs-human HALT', async () => {
    const refusedJudgments: Array<{ finishProsePass?: string }> = [];
    const provider: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        if (step !== 'finish' || options.finishProsePass !== 'judge') {
          throw new Error(`unexpected provider dispatch: ${step} ${options.finishProsePass ?? 'default'}`);
        }
        refusedJudgments.push({ finishProsePass: options.finishProsePass });
        return {
          success: true,
          publicationDisposition: {
            kind: 'refused',
            detail: BLOCKER,
          },
        };
      }),
    };
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '' };
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({
          url: 'https://github.com/acme/widget/pull/1172',
          title: 'feat: reader-facing publication',
          body: 'Reader-facing summary and validation evidence.',
          isDraft: true,
          labels: [],
        }) };
      }
      throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
    });
    const git = async (args: string[]) => {
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/finish-correct-refusal\n' };
      if (args[0] === 'merge-base') return { stdout: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: provider,
      finishPublication: createProductionFinishPublicationCoordinator({
        projectRoot,
        stateFilePath,
        baseBranch: 'main',
        git,
        gh,
        observeReleaseReadiness: async () => 'present',
      }),
      projectRoot,
      fromStep: 'finish',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      git,
      gh,
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(provider.run).toHaveBeenCalledOnce();
    expect(refusedJudgments).toEqual([{ finishProsePass: 'judge' }]);
    expect(provider.run).toHaveBeenCalledWith(
      'finish',
      expect.any(Object),
      expect.objectContaining({ finishProsePass: 'judge' }),
    );
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('The PR prose judgment was refused and requires an operator decision.');
    expect(halt).toContain('Next action: Review the refusal and decide how to continue publication.');
    expect(halt).toContain(`Detail: ${BLOCKER}`);
    await expect(readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8'))
      .resolves.toBe('needs-human');
  });
});
