import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'capture-before-audit',
  })),
}));

import { Conductor } from '../test-conductor.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';

const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'capture-before-audit' };
const caseFeature = { version: 'v1' as const, repository: feature.repository, feature: feature.feature };

describe('Conductor PRD widening capture entry', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    statePath = join(projectRoot, 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const offers = await persistPrdWideningOffers(projectRoot, caseFeature, [{
      criterion: 'NC.1',
      sourceId: 'prd-audit:NC.1',
      evidence: 'The original visible widening.',
      reportSnapshot: 'original audit report',
      relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture offer did not persist');
    const offer = offers.offers[0]!;
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: 'NC.1',
        summary: 'Editable wording is not authority.',
        relation: 'outside-visible',
        offerEntryId: offer.originalCaseId,
        originalCaseId: offer.originalCaseId,
        originalSource: { id: offer.originalSource.id, snapshot: offer.originalSource.snapshot },
        decision: 'accept',
        rationale: 'The operator accepted the original behavior.',
      }]),
      '```',
    ].join('\n'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function stateWithPending(...pending: StepName[]): ConductState {
    return Object.fromEntries(ALL_STEPS.map((step) => [step.name, pending.includes(step.name) ? 'pending' : 'done'])) as ConductState;
  }

  async function decisionInventory(): Promise<Array<{ criterion: string; authority: string }>> {
    const stored = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), 'utf8')) as {
      decisions: Array<{ criterion: string; authority: string }>;
    };
    return stored.decisions.map(({ criterion, authority }) => ({ criterion, authority }));
  }

  it('captures the cleared decision before the serial audit and replays it unchanged through the concurrent join', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calls.push(step);
        if (step === 'prd_audit') {
          expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);
          return { success: false, output: 'stop after audit-entry observation' };
        }
        return { success: true };
      }),
    };

    await writeState(statePath, stateWithPending('prd_audit'));
    await new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'prd_audit',
      maxRetries: 1,
    }).run();

    expect(calls).toEqual(['prd_audit']);
    expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);

    // Start the group path with the same durable offer and editable clear but
    // no captured decision. Its branch must execute the same entry preflight,
    // not merely observe the serial route's earlier write.
    await unlink(join(projectRoot, '.pipeline', 'accepted-widenings.json'));
    calls.length = 0;
    await writeState(statePath, stateWithPending('manual_test', 'prd_audit', 'architecture_review_as_built'));
    await new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      mode: 'auto',
      maxRetries: 1,
    }).run();

    expect(calls).toContain('prd_audit');
    expect(calls).not.toContain('finish');
    expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);
  });

  it('surfaces a concurrent capture defect through prd_audit without dispatching sibling lifecycle steps', async () => {
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), '```json over-scope-decisions\nnot-json\n```');
    await writeState(statePath, stateWithPending('manual_test', 'prd_audit', 'architecture_review_as_built'));
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };

    await new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      mode: 'auto',
      maxRetries: 1,
    }).run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).toContain('malformed');
  });
});
