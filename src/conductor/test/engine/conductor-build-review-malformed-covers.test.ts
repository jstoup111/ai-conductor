// Covers: task:4
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StepRunner, StepRunOptions } from '../../src/engine/conductor.js';
import { MAX_KICKBACKS_PER_GATE } from '../../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const roots: string[] = [];
const malformed = [{ path: 'src/a.test.ts', line: 5, token: 'Task: 32' }];
const malformedOutput = [
  'build_review: changed test Covers marker matches no reference grammar',
  'src/a.test.ts:5 token `Task: 32`',
  'Accepted forms: task:<id>, S<story>.<n>, FR-<n>.',
].join('\n');
const priorMechanicalFault = {
  rubric: 'testQuality', reason: 'provider-error', detail: 'prior provider failure', lapId: 'lap-prior',
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(options: { readonly exhausted?: boolean } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-build-review-malformed-covers-'));
  roots.push(projectRoot);
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  const statePath = join(projectRoot, '.pipeline', 'state.json');
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as Record<string, unknown>;
  Object.assign(state, { complexity_tier: 'M', run_started_at: 1, feature_desc: 'malformed-covers', worktree_branch: 'feature/malformed-covers' });
  await writeState(statePath, state as ConductState);
  const priorCount = options.exhausted ? MAX_KICKBACKS_PER_GATE : 0;
  await writeFile(join(projectRoot, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
    version: 1,
    gates: { build_review: {
      count: priorCount, cumulative: priorCount, mechanicalFaults: 1, lastMechanicalFault: priorMechanicalFault,
      treeHash: null, lastReason: 'prior', priorVerdict: true, resolvedBefore: 0,
    } },
  }), 'utf8');

  const dispatched: StepName[] = [];
  const retryReasons = new Map<StepName, string>();
  const runner: StepRunner = {
    run: vi.fn(async (step: StepName, _state: ConductState, runOptions?: StepRunOptions) => {
      dispatched.push(step);
      if (runOptions?.retryReason !== undefined) retryReasons.set(step, runOptions.retryReason);
      if (step === 'build_review') return { success: false, output: malformedOutput, buildReviewMalformedCovers: malformed };
      if (step === 'build') throw new Error('stop after BUILD dispatch');
      return { success: true };
    }),
  };
  const events = new ConductorEventEmitter();
  const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
  const retries: string[] = [];
  events.on('kickback', (event) => { if (event.type === 'kickback') kickbacks.push(event); });
  events.on('step_retry', (event) => { if (event.type === 'step_retry') retries.push(event.step); });
  const conductor = new Conductor({
    projectRoot, stateFilePath: statePath, stepRunner: runner, events, fromStep: 'build_review',
    verifyArtifacts: true, mode: 'auto', daemon: true,
    config: { kickback_escalation: { enabled: false }, build_review: { rubrics: { testQuality: { enabled: true } } } },
  } as never);
  await conductor.run().catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'stop after BUILD dispatch') throw error;
  });
  return {
    dispatched, retryReasons, kickbacks, retries,
    runner,
    state: async () => JSON.parse(await readFile(statePath, 'utf8')) as ConductState,
    ledger: async () => JSON.parse(await readFile(join(projectRoot, '.pipeline', 'kickback-ledger.json'), 'utf8')) as { gates: { build_review: { count: number; mechanicalFaults?: number; lastMechanicalFault?: unknown } } },
    halt: async () => readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8').catch(() => ''),
  };
}

describe('engine/conductor — build_review malformed Covers markers', () => {
  it('routes malformed markers to BUILD without charging the mechanical lane', async () => {
    const run = await fixture();

    expect(run.kickbacks).toEqual([expect.objectContaining({ from: 'build_review', to: 'build', evidence: expect.stringContaining('src/a.test.ts:5 token `Task: 32`') })]);
    expect(run.retryReasons.get('build')).toContain('src/a.test.ts:5 token `Task: 32`');
    expect(run.retryReasons.get('build')).toContain('Accepted forms: task:<id>, S<story>.<n>, FR-<n>.');
    expect((await run.state()).build_review).toBe('stale');
    expect((await run.state()).manual_test).toBe('stale');
    expect(vi.mocked(run.runner.run).mock.calls.filter(([step]) => step === 'build_review')).toHaveLength(1);
    expect(run.retries).not.toContain('build_review');
    expect(await run.ledger()).toMatchObject({ gates: { build_review: { count: 1 } } });
    expect((await run.ledger()).gates.build_review.mechanicalFaults).toBe(1);
    expect((await run.ledger()).gates.build_review.lastMechanicalFault).toEqual(priorMechanicalFault);
  });

  it('halts needs-human at the build_review kickback cap without charging mechanical faults', async () => {
    const run = await fixture({ exhausted: true });

    expect(run.kickbacks).toEqual([]);
    await expect(run.halt()).resolves.toContain('build_review malformed Covers markers unresolved after');
    await expect(run.halt()).resolves.toContain('src/a.test.ts:5');
    await expect(run.halt()).resolves.toContain('Task: 32');
    await expect(run.halt()).resolves.toContain('cap 2');
    expect((await run.ledger()).gates.build_review).toMatchObject({ count: MAX_KICKBACKS_PER_GATE });
    expect((await run.ledger()).gates.build_review.mechanicalFaults).toBe(1);
    expect((await run.ledger()).gates.build_review.lastMechanicalFault).toEqual(priorMechanicalFault);
  });
});
