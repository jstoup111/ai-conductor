// Covers: task:2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return { ...actual, buildStepRegistry: vi.fn(actual.buildStepRegistry) };
});

import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { readVerdict, writeVerdict, type RebasePreservedCandidate } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const rebaseRecord = (transition: { preserved: StepName[]; invalidated: StepName[] }) => ({
  id: 'rebase-operation-1',
  status: 'applied' as const,
  appliedAt: 100,
  transition: { ...transition, reverified: [] },
  replay: {
    preRebaseHead: 'pre', mergeBase: 'base', target: 'main', completedHead: 'head', expectedTree: 'tree',
  },
});

function preservedCandidate(gate: 'prd_audit' | 'test_suite', verdict: { satisfied: true; checkedAt: number }) {
  const originalVerdictDigest = `sha256:${createHash('sha256').update(JSON.stringify(verdict)).digest('hex')}`;
  return {
    gate,
    original: {
      artifactDigest: originalVerdictDigest,
      attemptId: `${verdict.checkedAt}`,
      runId: `${verdict.checkedAt}`,
      codeStamp: 'head',
    },
    originalVerdictDigest,
    relevantInputIdentities: [],
  } satisfies RebasePreservedCandidate;
}

const onlyBuildReview: StepDefinition[] = [{
  name: 'build_review', label: 'build review', phase: 'BUILD', enforcement: 'gating',
  prerequisites: [], skippableForTiers: [], isCheckpoint: false,
}];

describe('Conductor resume rebase-operation fence', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-resume-rebase-fence-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
    vi.mocked(buildStepRegistry).mockReturnValue(onlyBuildReview);
    await writeState(stateFilePath, { build_review: 'pending' } as ConductState);
  });

  afterEach(async () => {
    vi.mocked(buildStepRegistry).mockReset();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeAppliedRebase(transition: { preserved: StepName[]; invalidated: StepName[] }) {
    await writeVerdict(projectRoot, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: rebaseRecord(transition),
    });
  }

  async function writeApplyingRebase(
    transition: { preserved: ('prd_audit' | 'test_suite')[]; invalidated: StepName[] },
    preservationEvidence: readonly RebasePreservedCandidate[],
  ) {
    await writeVerdict(projectRoot, 'rebase', {
      satisfied: true,
      checkedAt: 150,
      rebaseOperation: {
        ...rebaseRecord(transition),
        status: 'applying',
        appliedAt: undefined,
        preservationEvidence,
      },
    });
  }

  async function resume(
    runner: StepRunner,
    options: { fullSuiteVerifier?: ConstructorParameters<typeof Conductor>[0]['fullSuiteVerifier'] } = {},
  ): Promise<StepName[]> {
    const started: StepName[] = [];
    events.on('step_started', (event) => {
      if (event.type === 'step_started') started.push(event.step);
    });
    await new Conductor({ projectRoot, stateFilePath, stepRunner: runner, events, resume: true, ...options }).run();
    return started;
  }

  const successfulRunner: StepRunner = { run: async () => ({ success: true }) };

  it('routes a post-rebase failed build_review verdict through the resume clamp', async () => {
    await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
    await writeVerdict(projectRoot, 'build_review', { satisfied: false, checkedAt: 200 });

    await expect(resume(successfulRunner)).resolves.toEqual(['build_review']);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('completes an applying operation before its first resumed dispatch and is idempotent on the next resume', async () => {
    const suite = { satisfied: true as const, checkedAt: 10 };
    await writeVerdict(projectRoot, 'test_suite', suite);
    await writeVerdict(projectRoot, 'build_review', {
      satisfied: false, checkedAt: 11, kickback: { from: 'rebase', evidence: 'changed replay' },
    });
    await writeApplyingRebase(
      { preserved: ['test_suite'], invalidated: ['build_review'] },
      [preservedCandidate('test_suite', suite)],
    );

    let operationAtFirstDispatch: unknown;
    events.on('step_started', async (event) => {
      if (event.type === 'step_started') {
        operationAtFirstDispatch = (await readVerdict(projectRoot, 'rebase'))?.rebaseOperation;
      }
    });
    await expect(resume(successfulRunner)).resolves.toEqual(['build_review']);
    expect(operationAtFirstDispatch).toMatchObject({ status: 'applied', appliedAt: expect.any(Number) });
    await expect(readVerdict(projectRoot, 'test_suite')).resolves.toMatchObject({
      preservation: { gate: 'test_suite', operationId: 'rebase-operation-1' },
    });
    await expect(readVerdict(projectRoot, 'build_review')).resolves.toMatchObject({ satisfied: false });

    const gateDirectory = join(projectRoot, '.pipeline', 'gates');
    const before = await Promise.all(['rebase', 'test_suite', 'build_review'].map(async (gate) =>
      [gate, await readFile(join(gateDirectory, `${gate}.json`), 'utf8')] as const,
    ));
    await expect(resume(successfulRunner)).resolves.toEqual([]);
    const after = await Promise.all(['rebase', 'test_suite', 'build_review'].map(async (gate) =>
      [gate, await readFile(join(gateDirectory, `${gate}.json`), 'utf8')] as const,
    ));
    expect(after).toEqual(before);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reopens a mismatched non-tree-attesting preservation candidate through the clamp', async () => {
    const original = { satisfied: true as const, checkedAt: 10 };
    await writeVerdict(projectRoot, 'prd_audit', { satisfied: true, checkedAt: 11 });
    await writeVerdict(projectRoot, 'build_review', {
      satisfied: false, checkedAt: 12, kickback: { from: 'rebase', evidence: 'changed replay' },
    });
    await writeApplyingRebase(
      { preserved: ['prd_audit'], invalidated: ['build_review'] },
      [preservedCandidate('prd_audit', original)],
    );

    await expect(resume(successfulRunner)).resolves.toEqual(['build_review']);
    await expect(readVerdict(projectRoot, 'rebase')).resolves.toMatchObject({
      rebaseOperation: { status: 'applied', transition: { preserved: [], invalidated: expect.arrayContaining(['prd_audit']) } },
    });
    await expect(readVerdict(projectRoot, 'prd_audit')).resolves.toMatchObject({ satisfied: false });
    expect(await readVerdict(projectRoot, 'prd_audit')).not.toHaveProperty('preservation');
    expect(JSON.parse(await readFile(stateFilePath, 'utf8'))).toMatchObject({ prd_audit: 'pending' });
  });

  it('reuses a mismatched test-suite candidate when the shared pre-verifier confirms the current tree', async () => {
    const original = { satisfied: true as const, checkedAt: 10 };
    await writeVerdict(projectRoot, 'test_suite', { satisfied: true, checkedAt: 11 });
    await writeVerdict(projectRoot, 'build_review', {
      satisfied: false, checkedAt: 12, kickback: { from: 'rebase', evidence: 'changed replay' },
    });
    await writeApplyingRebase(
      { preserved: ['test_suite'], invalidated: ['build_review'] },
      [preservedCandidate('test_suite', original)],
    );

    const started = await resume(successfulRunner, {
      fullSuiteVerifier: {
        inspect: async () => ({ status: 'CURRENT' as const, evidence: {} as never }),
        ensure: async () => ({ status: 'REUSED' as const, evidence: {} as never }),
      },
    });
    expect(started).toEqual(['build_review']);
    await expect(readVerdict(projectRoot, 'rebase')).resolves.toMatchObject({
      rebaseOperation: { transition: { preserved: [], reverified: ['test_suite'] } },
    });
    await expect(readVerdict(projectRoot, 'test_suite')).resolves.toMatchObject({ satisfied: true });
    expect(await readVerdict(projectRoot, 'test_suite')).not.toHaveProperty('preservation');
  });

  it.each([
    ['a preserved prd_audit failed at the applied transition', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
      await writeVerdict(projectRoot, 'prd_audit', { satisfied: false, checkedAt: 100 });
    }],
    ['a preserved prd_audit verdict is absent', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
    }],
    ['a preserved build_review lacks replay-bound authority', async () => {
      await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    }],
    ['the persisted rebase transition is malformed', async () => {
      await writeAppliedRebase({ preserved: ['build_review'], invalidated: ['build_review'] });
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    }],
  ])('halts a resume when %s', async (_name, seed) => {
    await seed();

    await expect(resume(successfulRunner)).resolves.toEqual([]);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /outstanding prd_audit repair|preserved build_review without its replay-bound authority|rebase transition record is malformed/,
    );
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });
});
