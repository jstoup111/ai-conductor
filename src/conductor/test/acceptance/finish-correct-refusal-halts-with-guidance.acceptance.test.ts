/**
 * Acceptance spec for Stories 3-4's terminal FINISH refusal flow.
 *
 * A deterministic provider fake returns a refused verdict. The real production
 * coordinator decodes and maps it before the Conductor routes the resulting
 * human-required disposition to the halt-marker writer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
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
      complexity_tier: 'M',
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
    const provider: StepRunner = {
      run: vi.fn(async () => ({
        success: true,
        publicationDisposition: {
          kind: 'refused',
          detail: BLOCKER,
        },
      })),
    };
    const prUrl = 'https://github.com/acme/widget/pull/1172';
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'auth') return { stdout: '' };
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            url: prUrl,
            title: 'feat: publish refusal guidance',
            body: 'Reader-facing summary and validation evidence.',
            isDraft: true,
            labels: [],
          }),
        };
      }
      throw new Error(`unexpected GitHub call: ${args.join(' ')}`);
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot,
      stateFilePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'remote'
        ? { stdout: 'origin\n' }
        : { stdout: 'refs/remotes/origin/feat/finish-correct-refusal\n' },
      gh,
      observeReleaseReadiness: async () => 'present',
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: provider,
      finishPublication: coordinator,
      projectRoot,
      fromStep: 'finish',
      mode: 'auto',
      daemon: true,
      maxRetries: 3,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      git: async () => ({ stdout: '' }),
      gh,
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(provider.run).toHaveBeenCalledOnce();
    expect(provider.run).toHaveBeenCalledWith(
      'finish',
      expect.any(Object),
      expect.objectContaining({ finishProsePass: 'judge' }),
    );
    expect(gh).toHaveBeenCalledWith(
      ['pr', 'view', prUrl, '--json', 'url,title,body,isDraft,labels'],
      { cwd: projectRoot },
    );
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('The PR prose judgment was refused and requires an operator decision.');
    expect(halt).toContain('Next action: Review the refusal and decide how to continue publication.');
    expect(halt).toContain(BLOCKER);
    await expect(readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8'))
      .resolves.toBe('needs-human');
  });
});
