// Covers: task:2, task:10
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return { ...actual, buildStepRegistry: vi.fn(actual.buildStepRegistry) };
});

vi.mock('../../src/engine/rebase-transition.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/rebase-transition.js')>();
  return { ...actual, completeInterruptedRebaseOperation: vi.fn(actual.completeInterruptedRebaseOperation) };
});

import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { readVerdict, writeVerdict, type RebasePreservedCandidate } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import { completeInterruptedRebaseOperation } from '../../src/engine/rebase-transition.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
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

const rebaseAndTail: StepDefinition[] = [
  {
    name: 'rebase', label: 'rebase', phase: 'SHIP', enforcement: 'gating',
    prerequisites: [], skippableForTiers: [], isCheckpoint: false,
  },
  {
    name: 'build_review', label: 'build review', phase: 'BUILD', enforcement: 'gating',
    prerequisites: [], skippableForTiers: [], isCheckpoint: false,
  },
  {
    name: 'prd_audit', label: 'prd audit', phase: 'SHIP', enforcement: 'gating',
    prerequisites: [], skippableForTiers: [], isCheckpoint: false,
  },
];

const wideningFeature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'rebase-fence' };

async function writeOverScopeOffer(projectRoot: string): Promise<void> {
  await writeFile(join(projectRoot, '.pipeline', 'remediation-cases.json'), JSON.stringify({
    version: 'v2',
    feature: wideningFeature,
    cases: [],
    prdWideningCases: [{
      id: 'case-nc-1',
      domain: 'prd_widening',
      offeredCriterion: 'NC.1',
      originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'Visible behavior outside the approved plan.' }],
      currentSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'Visible behavior outside the approved plan.', recordedAt: '2026-10-04T00:00:00.000Z' }],
      relationships: [],
    }],
    suppressions: [],
  }));
}

async function writeClearedAccept(projectRoot: string): Promise<string> {
  const cleared = [
    'Operator decision',
    '',
    '```json over-scope-decisions',
    JSON.stringify([{
      criterion: 'NC.1',
      summary: 'Visible behavior outside the approved plan.',
      decision: 'accept',
      rationale: 'Operator decision.',
    }]),
    '```',
  ].join('\n');
  await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), cleared);
  return cleared;
}

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
    vi.mocked(completeInterruptedRebaseOperation).mockClear();
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
    options: Omit<Partial<ConstructorParameters<typeof Conductor>[0]>, 'projectRoot' | 'stateFilePath' | 'stepRunner' | 'events' | 'resume'> = {},
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
    const validatedOperation = (await readVerdict(projectRoot, 'rebase'))!.rebaseOperation;

    let operationAtFirstDispatch: unknown;
    events.on('step_started', async (event) => {
      if (event.type === 'step_started') {
        operationAtFirstDispatch = (await readVerdict(projectRoot, 'rebase'))?.rebaseOperation;
      }
    });
    await expect(resume(successfulRunner)).resolves.toEqual(['build_review']);
    expect(completeInterruptedRebaseOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: validatedOperation,
    }));
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
    ['with preservation evidence', async () => {
      const suite = { satisfied: true as const, checkedAt: 10 };
      await writeVerdict(projectRoot, 'test_suite', suite);
      await writeVerdict(projectRoot, 'build_review', {
        satisfied: false, checkedAt: 11, kickback: { from: 'rebase', evidence: 'changed replay' },
      });
      await writeApplyingRebase(
        { preserved: ['test_suite'], invalidated: ['build_review'] },
        [preservedCandidate('test_suite', suite)],
      );
    }],
    ['without preservation evidence', async () => {
      await writeVerdict(projectRoot, 'test_suite', { satisfied: true, checkedAt: 10 });
      await writeVerdict(projectRoot, 'build_review', {
        satisfied: false, checkedAt: 11, kickback: { from: 'rebase', evidence: 'changed replay' },
      });
      await writeApplyingRebase({ preserved: ['test_suite'], invalidated: ['build_review'] }, []);
      const rebase = await readVerdict(projectRoot, 'rebase');
      await writeVerdict(projectRoot, 'rebase', {
        ...rebase!,
        rebaseOperation: { ...rebase!.rebaseOperation!, preservationEvidence: undefined },
      });
    }],
  ])('halts when applying-operation completion is refused %s', async (_name, seed) => {
    await seed();
    const stateStore = createFilesystemConductStateStore(stateFilePath);
    const applyBatch = stateStore.applyBatch.bind(stateStore);
    stateStore.applyBatch = async (batch) => batch.name.startsWith('apply rebase operation')
      ? { kind: 'conflict', message: 'concurrent update' }
      : applyBatch(batch);

    await expect(resume(successfulRunner, { stateStore })).resolves.toEqual([]);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'rebase continuation state transition was refused',
    );
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('halts malformed applying records without invoking interrupted-operation completion', async () => {
    await writeApplyingRebase({ preserved: ['test_suite'], invalidated: ['test_suite'] }, []);

    await expect(resume(successfulRunner)).resolves.toEqual([]);
    await expect(readVerdict(projectRoot, 'rebase')).resolves.toMatchObject({
      rebaseOperation: { status: 'applying' },
    });
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'rebase transition record is malformed',
    );
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(completeInterruptedRebaseOperation).not.toHaveBeenCalled();
  });

  it.each([
    ['a full applying record without preservation evidence', async () => {
      await writeState(stateFilePath, {
        rebase: 'done', build_review: 'done', prd_audit: 'done',
      } as ConductState);
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 10 });
      await writeVerdict(projectRoot, 'prd_audit', { satisfied: true, checkedAt: 10 });
      await writeVerdict(projectRoot, 'rebase', {
        satisfied: true,
        checkedAt: 11,
        rebaseOperation: {
          ...rebaseRecord({ preserved: ['prd_audit'], invalidated: ['build_review'] }),
          status: 'applying',
          appliedAt: undefined,
        },
      });
      return ['build_review', 'prd_audit'] as const;
    }],
    ['a provisional preparing record', async () => {
      await writeState(stateFilePath, {
        rebase: 'done', build_review: 'done', prd_audit: 'done',
      } as ConductState);
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 10 });
      await writeVerdict(projectRoot, 'prd_audit', { satisfied: true, checkedAt: 10 });
      await writeVerdict(projectRoot, 'rebase', {
        satisfied: true,
        checkedAt: 11,
        rebaseOperation: {
          ...rebaseRecord({ preserved: [], invalidated: [] }),
          id: 'preparing-rebase-operation-1',
          status: 'applying',
          appliedAt: undefined,
        },
      });
      return rebaseAndTail.slice(1).map((step) => step.name);
    }],
  ])('completes evidence-less interrupted operations from resume for %s', async (_name, seed) => {
    vi.mocked(buildStepRegistry).mockReturnValue(rebaseAndTail);
    const affected = await seed();

    await expect(resume(successfulRunner, {
      daemon: true,
      featureSlug: 'resume-fixture',
      operatorParkBoundary: async () => true,
    })).resolves.toEqual([]);

    await expect(readVerdict(projectRoot, 'rebase')).resolves.toMatchObject({
      rebaseOperation: { status: 'applied', transition: { preserved: [] } },
    });
    for (const gate of affected) {
      await expect(readVerdict(projectRoot, gate)).resolves.toMatchObject({ satisfied: false });
      expect((await readVerdict(projectRoot, gate))?.preservation).toBeUndefined();
    }
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState;
    for (const gate of affected) expect(state[gate]).toBe('pending');
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['a preserved prd_audit failed at the applied transition', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
      await writeVerdict(projectRoot, 'prd_audit', { satisfied: false, checkedAt: 100 });
    }, 'rebase transition still has an outstanding prd_audit repair or re-verification', 're-run the prd_audit gate or reconcile the persisted rebase operation before resuming'],
    ['a preserved prd_audit verdict is absent', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
    }, 'rebase transition still has an outstanding prd_audit repair or re-verification', 're-run the prd_audit gate or reconcile the persisted rebase operation before resuming'],
    ['a preserved build_review lacks replay-bound authority', async () => {
      await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    }, 'rebase transition preserved build_review without its replay-bound authority', 're-run the build_review gate or reconcile the persisted rebase operation before resuming'],
    ['the persisted rebase transition is malformed', async () => {
      await writeAppliedRebase({ preserved: ['build_review'], invalidated: ['build_review'] });
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    }, 'rebase transition record is malformed or inconsistent; reconcile it before publication', undefined],
  ])('halts a resume when %s', async (_name, seed, fault, nextAction) => {
    await seed();

    await expect(resume(successfulRunner)).resolves.toEqual([]);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(fault);
    if (nextAction !== undefined) expect(halt).toContain(nextAction);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it.each([
    ['missing authority', async () => {
      await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
      await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    }, 'rebase transition preserved build_review without its replay-bound authority', 're-run the build_review gate or reconcile the persisted rebase operation before resuming'],
    ['missing verdict', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
    }, 'rebase transition still has an outstanding prd_audit repair or re-verification', 're-run the prd_audit gate or reconcile the persisted rebase operation before resuming'],
    ['pre-applied unsatisfied verdict', async () => {
      await writeAppliedRebase({ preserved: ['prd_audit'], invalidated: [] });
      await writeVerdict(projectRoot, 'prd_audit', { satisfied: false, checkedAt: 100 });
    }, 'rebase transition still has an outstanding prd_audit repair or re-verification', 're-run the prd_audit gate or reconcile the persisted rebase operation before resuming'],
  ])('includes recorded acceptance and a next action for %s', async (_name, seed, fault, nextAction) => {
    await seed();
    await writeOverScopeOffer(projectRoot);
    await writeClearedAccept(projectRoot);

    await expect(resume(successfulRunner)).resolves.toEqual([]);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(fault);
    expect(halt).toContain(nextAction);
    expect(halt).toContain('NC.1');
    expect(halt).toContain('recorded as accept');
  });

  it.each([
    ['a recorded accept', async () => {
      await writeOverScopeOffer(projectRoot);
      return writeClearedAccept(projectRoot);
    }, ['NC.1', 'recorded as accept']],
    ['a pending offer', async () => {
      await writeOverScopeOffer(projectRoot);
      return undefined;
    }, ['NC.1', 'awaiting a decision', 'ai-conductor halt clear']],
    ['no offer or decision', async () => undefined, []],
    ['an unreadable decision store', async () => {
      await writeOverScopeOffer(projectRoot);
      await writeFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), '{not json');
      return undefined;
    }, ['recorded decision state could not be read']],
  ])('adds decision context to an integrity halt with %s without changing HALT.cleared', async (_name, arrange, expected) => {
    await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
    await writeVerdict(projectRoot, 'build_review', { satisfied: true, checkedAt: 100 });
    const clearedBefore = await arrange();

    await expect(resume(successfulRunner)).resolves.toEqual([]);

    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('rebase transition preserved build_review without its replay-bound authority');
    expect(halt).toContain('re-run the build_review gate or reconcile the persisted rebase operation before resuming');
    for (const fragment of expected) expect(halt).toContain(fragment);
    if (expected.length === 0) {
      expect(halt).toBe(
        'rebase transition preserved build_review without its replay-bound authority; re-run the build_review gate or reconcile the persisted rebase operation before resuming\n',
      );
    }
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    if (clearedBefore !== undefined) {
      await expect(readFile(join(projectRoot, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toBe(clearedBefore);
    }
  });
});
