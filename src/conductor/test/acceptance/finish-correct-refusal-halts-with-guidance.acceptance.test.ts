/**
 * Acceptance spec for Stories 3-4's terminal FINISH halt-state flow.
 *
 * The production coordinator recognizes the remediation signal before it
 * reaches a provider. The Conductor then routes the human-required
 * disposition to the halt-marker writer.
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

describe('acceptance: a halt-state PR stops with its guidance', () => {
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

  it('writes the halt-state message and next action without dispatching a provider', async () => {
    const provider: StepRunner = {
      run: vi.fn(async () => ({
        success: true,
      })),
    };
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot,
      stateFilePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'remote'
        ? { stdout: 'origin\n' }
        : { stdout: 'refs/remotes/origin/feat/finish-correct-refusal\n' },
      gh: async (args) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              url: 'https://github.com/acme/widget/pull/1172',
              title: 'needs-remediation: publication',
              body: 'Human remediation is required before this PR can be published.',
              isDraft: true,
            }),
          };
        }
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      },
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
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(provider.run).not.toHaveBeenCalled();
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('The PR still carries a remediation halt signal and cannot be published automatically.');
    expect(halt).toContain('Next action: Resolve the stated blocker and clear the remediation signal before retrying FINISH.');
    await expect(readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8'))
      .resolves.toBe('needs-human');
  });
});
