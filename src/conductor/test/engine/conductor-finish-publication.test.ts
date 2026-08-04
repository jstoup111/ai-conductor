import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => null),
}));

const ROUTED_SENTINEL = new Error('stop after first FINISH publication route');

describe('Conductor FINISH publication routing', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-finish-publication-'));
    statePath = join(dir, 'conduct-state.json');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      feature_desc: 'finish-publication',
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) {
      state[step] = 'done';
    }
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('retries a publication-only result at FINISH without dispatching BUILD or remediation', async () => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (calls.length > 1) throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls.map(({ step }) => step)).toEqual(['finish', 'finish']);
    expect(calls.map(({ step }) => step)).not.toContain('build');
    expect(calls.map(({ step }) => step)).not.toContain('remediate');
    expect(calls[1]?.retryReason).toContain('Retry only the incomplete publication transition.');
    expect(calls[1]?.retryReason).toContain('presentation_repair_failed');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      ROUTED_SENTINEL.message,
    );
  });

  it.each([
    { kind: 'complete', reason: 'contradictory' },
    { kind: 'unknown' },
  ])('halts unknown publication disposition without broad remediation', async (publicationDisposition) => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return { success: false, publicationDisposition };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'publication disposition',
    );
  });
});
