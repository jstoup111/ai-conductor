// Covers: task:2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return { ...actual, buildStepRegistry: vi.fn(actual.buildStepRegistry) };
});

import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
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

  async function resume(runner: StepRunner): Promise<StepName[]> {
    const started: StepName[] = [];
    events.on('step_started', (event) => {
      if (event.type === 'step_started') started.push(event.step);
    });
    await new Conductor({ projectRoot, stateFilePath, stepRunner: runner, events, resume: true }).run();
    return started;
  }

  const successfulRunner: StepRunner = { run: async () => ({ success: true }) };

  it('routes a post-rebase failed build_review verdict through the resume clamp', async () => {
    await writeAppliedRebase({ preserved: ['build_review'], invalidated: [] });
    await writeVerdict(projectRoot, 'build_review', { satisfied: false, checkedAt: 200 });

    await expect(resume(successfulRunner)).resolves.toEqual(['build_review']);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
