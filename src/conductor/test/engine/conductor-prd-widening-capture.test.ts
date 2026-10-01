// Covers: task:4

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const, repository: '/fixture/repository', feature: 'capture-before-audit',
  })),
}));

// Capturing an operator-cleared widening exercises the production attribution
// gate, so this fixture supplies the machine-scoped operator it represents.
vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>(),
  readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'fixture-operator' })),
}));

import { Conductor } from '../test-conductor.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  ACCEPTED_WIDENINGS_PATH,
  AcceptedWideningDecisionStore,
  type AcceptedWideningDecision,
  type OverScopePersistedOffer,
} from '../../src/engine/accepted-widenings.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import type { ConductorEvent } from '../../src/types/events.js';

const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'capture-before-audit' };
const caseFeature = { version: 'v1' as const, repository: feature.repository, feature: feature.feature };

describe('Conductor PRD widening capture entry', () => {
  let projectRoot: string;
  let statePath: string;
  let offer: OverScopePersistedOffer;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-entry-'));
    statePath = join(projectRoot, 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const offers = await persistPrdWideningOffers(projectRoot, caseFeature, [{
      criterion: 'NC.1', sourceId: 'prd-audit:NC.1', evidence: 'The original visible widening.',
      reportSnapshot: 'original audit report', relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture offer did not persist');
    offer = offers.offers[0]!;
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: 'NC.1', summary: offer.summary, relation: 'outside-visible',
        offerEntryId: offer.originalCaseId, originalCaseId: offer.originalCaseId,
        originalSource: { id: offer.originalSource.id, snapshot: offer.originalSource.snapshot },
        decision: 'accept', rationale: 'The operator accepted the original behavior.',
      }]), '```',
    ].join('\n'));
  });

  afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

  function stateWithPending(...pending: StepName[]): ConductState {
    return Object.fromEntries(ALL_STEPS.map((step) => [step.name, pending.includes(step.name) ? 'pending' : 'done'])) as ConductState;
  }

  async function decisionInventory(): Promise<Array<{ criterion: string; authority: string }>> {
    const stored = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), 'utf8')) as { decisions: Array<{ criterion: string; authority: string }> };
    return stored.decisions.map(({ criterion, authority }) => ({ criterion, authority }));
  }

  async function seedRefusal(): Promise<AcceptedWideningDecision> {
    const result = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: feature.repository, feature: feature.feature,
    }).append({
      criterion: offer.criterion,
      authority: 'refuse',
      rationale: 'The operator declined this original widening.',
      operator: 'fixture-operator',
      offerEntryId: offer.offerEntryId,
      originalCaseId: offer.originalCaseId,
      originalSource: offer.originalSource,
    });
    if (!result.ok) throw new Error(`fixture refusal did not persist: ${result.reason}`);
    return result.decision;
  }

  async function writeRevision(
    decision: 'accept' | 'refuse',
    priorDecision: Pick<AcceptedWideningDecision, 'id' | 'revision'>,
  ): Promise<void> {
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: offer.criterion, summary: offer.summary, relation: offer.relation,
        offerEntryId: offer.offerEntryId, originalCaseId: offer.originalCaseId,
        originalSource: offer.originalSource, decision,
        rationale: 'The operator re-affirmed the recorded authority.',
        priorDecision: { id: priorDecision.id, revision: priorDecision.revision },
      }]),
      '```',
    ].join('\n'));
  }

  function prdEntry(events = new ConductorEventEmitter()): {
    preparePrdWideningBeforeAudit(): Promise<string | undefined>;
  } {
    return new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> };
  }

  it('captures the cleared decision before the serial audit and replays it unchanged through the concurrent join', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
      calls.push(step);
      if (step === 'prd_audit') {
        expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);
        return { success: false, output: 'stop after audit-entry observation' };
      }
      return { success: true };
    }) };
    await writeState(statePath, stateWithPending('prd_audit'));
    await new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(), fromStep: 'prd_audit', maxRetries: 1 }).run();
    expect(calls).toEqual(['prd_audit']);
    expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);
    await unlink(join(projectRoot, '.pipeline', 'accepted-widenings.json'));
    calls.length = 0;
    await writeState(statePath, stateWithPending('manual_test', 'prd_audit', 'architecture_review_as_built'));
    await new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(), fromStep: 'manual_test', mode: 'auto', maxRetries: 1 }).run();
    expect(calls).toContain('prd_audit');
    expect(calls).not.toContain('finish');
    expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }]);
  });

  it('surfaces a concurrent capture defect through prd_audit without dispatching sibling lifecycle steps', async () => {
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), '```json over-scope-decisions\nnot-json\n```');
    await writeState(statePath, stateWithPending('manual_test', 'prd_audit', 'architecture_review_as_built'));
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    await new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(), fromStep: 'manual_test', mode: 'auto', maxRetries: 1 }).run();
    expect(runner.run).not.toHaveBeenCalled();
    expect(await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).toContain('malformed');
  });

  it('names unsupported legacy recovery before dispatch and retains the original clear', async () => {
    const raw = 'OVER_SCOPE_ACCEPT: NC.1 approved by operator';
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(clearPath, raw);
    const runner: StepRunner = { run: vi.fn() };
    const entry = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() }) as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toContain('unsupported-history');
    expect(await readFile(clearPath, 'utf8')).toBe(raw);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('keeps a cleared same-authority revision of the latest refusal inert at the PRD entry boundary', async () => {
    const refusal = await seedRefusal();
    await writeRevision('refuse', refusal);
    const before = await decisionInventory();

    await expect(prdEntry().preparePrdWideningBeforeAudit()).resolves.toBeUndefined();

    expect(await decisionInventory()).toEqual(before);
  });

  it('reports a stale same-authority revision as invalid-decision through the PRD entry event spine', async () => {
    const refusal = await seedRefusal();
    const store = new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: feature.repository, feature: feature.feature,
    });
    const reversal = await store.append({
      criterion: offer.criterion,
      authority: 'accept',
      rationale: 'The operator reversed the original refusal.',
      operator: 'fixture-operator',
      offerEntryId: offer.offerEntryId,
      originalCaseId: offer.originalCaseId,
      originalSource: offer.originalSource,
      supersedes: { id: refusal.id, revision: refusal.revision },
    });
    if (!reversal.ok) throw new Error(`fixture reversal did not persist: ${reversal.reason}`);
    await writeRevision('refuse', refusal);
    const events = new ConductorEventEmitter();
    const emitted: ConductorEvent[] = [];
    events.on('prd_widening_reconciled', (event) => { emitted.push(event); });

    const recovery = await prdEntry(events).preparePrdWideningBeforeAudit();

    expect(recovery).toContain('invalid-decision');
    expect(recovery).toContain(offer.offerEntryId);
    expect(recovery).not.toContain('persistence-failed');
    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'prd_widening_reconciled', sourceId: offer.offerEntryId,
      outcome: 'rejected', reason: 'invalid-decision',
    }));
    expect(emitted).not.toContainEqual(expect.objectContaining({ outcome: 'rejected', reason: 'write-failed' }));
  });

  it('retains a newer fenced refusal beside a migrated v1 acceptance before audit dispatch', async () => {
    const accepted = {
      criterion: 'NC.1', summary: 'The original visible widening.', decision: 'accept',
      rationale: 'Initially approved.', operator: 'operator@example.test', decidedAt: '2026-09-01T00:00:00.000Z',
    };
    await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({ version: 1, decisions: [accepted] }));
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions', JSON.stringify([{
        criterion: accepted.criterion, summary: accepted.summary, decision: 'refuse', rationale: 'The operator later refused this expansion.',
      }]), '```',
    ].join('\n'));
    const calls: StepName[] = [];
    const runner: StepRunner = { run: vi.fn(async (step: StepName) => {
      calls.push(step);
      if (step === 'prd_audit') {
        expect(await decisionInventory()).toEqual([{ criterion: 'NC.1', authority: 'accept' }, { criterion: 'NC.1', authority: 'refuse' }]);
        return { success: false, output: 'stop after entry observation' };
      }
      return { success: true };
    }) };
    await writeState(statePath, stateWithPending('prd_audit'));
    await new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(), fromStep: 'prd_audit', maxRetries: 1 }).run();
    expect(calls).toEqual(['prd_audit']);
    await expect(new AcceptedWideningDecisionStore(projectRoot, { version: 1, repository: feature.repository, feature: feature.feature }).read())
      .resolves.toMatchObject({ kind: 'valid', state: { decisions: [
        { authority: 'accept', revision: 1 }, { authority: 'refuse', revision: 2, supersedes: { revision: 1 } },
      ] } });
  });
});
