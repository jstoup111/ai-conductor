/**
 * Acceptance spec for Stories 3-4's terminal FINISH refusal flow.
 *
 * The production coordinator's typed disposition is the input boundary. This
 * drives the real Conductor FINISH route and halt-marker writer, while the
 * provider itself remains a deterministic fake per the repository's test
 * isolation contract. Decoder and detail-normalization cases stay at the
 * lower engine-test layer owned by TDD.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const BLOCKER = 'CHANGELOG carries an unsubstituted {{IMPLEMENTATION_PR}} token';

describe('acceptance: a correct FINISH refusal stops with its guidance', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'finish-correct-refusal-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'finish-correct-refusal',
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
        success: false,
        publicationDisposition: {
          kind: 'human_required',
          reason: 'judgment_refused',
          detail: BLOCKER,
        },
      })),
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: provider,
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

    expect(provider.run).toHaveBeenCalledOnce();
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('The FINISH provider deliberately refused publication');
    expect(halt).toContain('Next action:');
    expect(halt).toContain(BLOCKER);
    await expect(readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8'))
      .resolves.toBe('needs-human');
  });
});
