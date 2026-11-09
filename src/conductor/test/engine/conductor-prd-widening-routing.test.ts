// Covers: task:21, task:25, task:4, task:5, task:6, task:7, task:8

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'prd-widening-routing',
  })),
}));

// These fixtures model a cleared operator decision, not an unowned machine.
vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>(),
  readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'fixture-operator' })),
}));

import { Conductor, routeTypedPrdAuditOverScope, type PrdAuditOverScopeRoute, type StepRunner } from '../../src/engine/conductor.js';
import { AcceptedWideningDecisionStore, renderOverScopeDecisionBlock, type AcceptedWideningDecision, type IntentRelation } from '../../src/engine/accepted-widenings.js';
import { capturePrdWideningDecisions } from '../../src/engine/prd-widening-capture.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { RemediationCaseStore, type RemediationCasePrdWideningRecord } from '../../src/engine/remediation-case-store.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { validatePrdAuditJudgment } from '../../src/engine/prd-audit-contract.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as coordinatorModule from '../../src/engine/prd-widening-coordinator.js';
import { readMachineOwnerConfig } from '../../src/engine/owner-gate/machine-identity.js';

const sourceId = (evidence: string, criterion = 'NC.1') =>
  prdWideningSourceId({ criterion, grade: 'OVER_SCOPE', evidence, prdIds: [] });

describe('routeTypedPrdAuditOverScope refusal projection', () => {
  const relation = (criteria: readonly string[]): ReadonlyMap<string, IntentRelation> =>
    new Map(criteria.map((criterion): [string, IntentRelation] => [criterion, 'outside-visible']));

  const finding = (criterion: string, evidence: string) => ({
    criterion,
    grade: 'OVER_SCOPE' as const,
    prdIds: [] as readonly string[],
    evidence,
  });

  const ncCase = (
    caseId: string,
    sourceId: string,
    evidence: string,
    offeredCriterion = 'NC.1',
  ): RemediationCasePrdWideningRecord => ({
    id: caseId,
    domain: 'prd_widening',
    offeredCriterion,
    originalSources: [{ sourceId: 'src-original', snapshot: 'The original user-visible widening.' }],
    currentSources: [{ sourceId, snapshot: evidence, recordedAt: '2026-01-01T00:00:00.000Z' }],
    relationships: [{ currentSourceId: sourceId, kind: 'same-case', caseId, reason: 'same behavior' }],
    reconciliationDigest: 'digest-1',
  });

  const refuseDecision = (
    criterion: string,
    overrides: Partial<AcceptedWideningDecision> = {},
  ): AcceptedWideningDecision => ({
    id: 'dec-1',
    criterion,
    authority: 'refuse',
    rationale: 'The operator refused this behavior.',
    operator: 'operator',
    revision: 1,
    ...overrides,
  });

  it('emits refusal-rework with decision-and-case evidence for an all-refused, defect-free set', () => {
    const storyEvidence = 'The story behavior lies outside the approved intent.';
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('S1.1', storyEvidence), finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['S1.1', 'NC.1']),
      [
        refuseDecision('S1.1', { id: 'dec-story-1' }),
        refuseDecision('NC.1', {
          id: 'dec-nc-1',
          originalSource: { id: 'src-original', snapshot: 'The original user-visible widening.' },
          originalCaseId: 'case-1',
        }),
      ],
      [ncCase('case-1', ncId, ncEvidence)],
    );

    if (route.kind !== 'refusal-rework') throw new Error(`expected refusal-rework, got ${route.kind}`);
    expect(route.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: 'S1.1', decision: 'refuse', accepted: false }),
      expect.objectContaining({ criterion: 'NC.1', decision: 'refuse', accepted: false }),
    ]));
    expect(route.refusals).toEqual([
      { key: 'S1.1', decisionId: 'dec-story-1', revision: 1, rationale: 'The operator refused this behavior.' },
      {
        key: 'NC.1', decisionId: 'dec-nc-1', revision: 1, rationale: 'The operator refused this behavior.',
        caseId: 'case-1', snapshot: 'The original user-visible widening.',
      },
    ]);
  });

  it('keeps a refused + pending set on the existing halt', () => {
    const ncRefused = 'The original user-visible widening.';
    const ncPending = 'A second undecided visible behavior.';
    const refusedId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncRefused, prdIds: [] });
    const pendingId = prdWideningSourceId({ criterion: 'NC.2', grade: 'OVER_SCOPE', evidence: ncPending, prdIds: [] });

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncRefused), finding('NC.2', ncPending)], rejectedRows: [] },
      relation(['NC.1', 'NC.2']),
      [refuseDecision('NC.1', {
        originalSource: { id: 'src-original', snapshot: 'The original user-visible widening.' },
        originalCaseId: 'case-1',
      })],
      [
        ncCase('case-1', refusedId, ncRefused, 'NC.1'),
        ncCase('case-2', pendingId, ncPending, 'NC.2'),
      ],
    );

    if (route.kind !== 'halt') throw new Error(`expected halt, got ${route.kind}`);
    expect(route.undecided.map((entry) => entry.criterion)).toEqual(['NC.2']);
    expect(route.refused.map((entry) => entry.criterion)).toEqual(['NC.1']);
  });

  it('records an all-accepted set as before', () => {
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['NC.1']),
      [{
        ...refuseDecision('NC.1', {
          originalSource: { id: 'src-original', snapshot: 'The original user-visible widening.' },
          originalCaseId: 'case-1',
        }),
        authority: 'accept',
        rationale: 'The operator accepted this behavior.',
      }],
      [ncCase('case-1', ncId, ncEvidence)],
    );

    if (route.kind !== 'record') throw new Error(`expected record, got ${route.kind}`);
    expect(route.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: 'NC.1', decision: 'accept', accepted: true }),
    ]));
  });

  it('halts with persistence-failed when a refused NC decision lacks its snapshot', () => {
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['NC.1']),
      [refuseDecision('NC.1', { id: 'dec-nc-1', originalCaseId: 'case-1' })],
      [ncCase('case-1', ncId, ncEvidence)],
    );

    if (route.kind !== 'halt') throw new Error(`expected halt, got ${route.kind}`);
    expect(route.detail).toContain('persistence-failed');
    expect(route.detail).toContain('NC.1');
  });

  it('keeps the projection-failed halt when a defect accompanies refusals', () => {
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });
    const legacyCase: RemediationCasePrdWideningRecord = {
      id: 'case-1',
      domain: 'prd_widening',
      originalSources: [{ sourceId: 'src-original', snapshot: 'The original user-visible widening.' }],
      currentSources: [{ sourceId: ncId, snapshot: ncEvidence, recordedAt: '2026-01-01T00:00:00.000Z' }],
      relationships: [{ currentSourceId: ncId, kind: 'same-case', caseId: 'case-1', reason: 'same behavior' }],
      reconciliationDigest: 'digest-1',
    };

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['NC.1']),
      [refuseDecision('NC.1', {
        originalSource: { id: 'src-original', snapshot: 'The original user-visible widening.' },
        originalCaseId: 'case-1',
      })],
      [legacyCase],
    );

    if (route.kind !== 'halt') throw new Error(`expected halt, got ${route.kind}`);
    expect(route.detail).toContain('projection-failed');
    expect(route.detail).toContain('NC.1');
  });

  it('classifies a later accept revision as accepted rather than refusal-rework', () => {
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });
    const source = { id: 'src-original', snapshot: 'The original user-visible widening.' };

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['NC.1']),
      [
        refuseDecision('NC.1', { id: 'dec-refuse-1', originalSource: source, originalCaseId: 'case-1', revision: 1 }),
        { ...refuseDecision('NC.1', { id: 'dec-accept-1', originalSource: source, originalCaseId: 'case-1', revision: 2 }), authority: 'accept', rationale: 'The operator reversed the refusal.', supersedes: { id: 'dec-refuse-1', revision: 1 } },
      ],
      [ncCase('case-1', ncId, ncEvidence)],
    );

    if (route.kind !== 'record') throw new Error(`expected record, got ${route.kind}`);
    expect(route.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: 'NC.1', decision: 'accept', accepted: true }),
    ]));
  });

  it('keeps an all-pending machine-cleared set as the same halt without refusal-rework', () => {
    const ncEvidence = 'The original user-visible widening.';
    const ncId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: ncEvidence, prdIds: [] });

    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [finding('NC.1', ncEvidence)], rejectedRows: [] },
      relation(['NC.1']),
      [],
      [ncCase('case-1', ncId, ncEvidence)],
    );

    if (route.kind !== 'halt') throw new Error(`expected halt, got ${route.kind}`);
    expect(route.undecided.map((entry) => entry.criterion)).toEqual(['NC.1']);
    expect(route.refused).toEqual([]);
  });
});

describe('typed PRD widening routing', () => {
  it('routes a complete typed OVER_SCOPE judgment when its derived report is altered', async () => {
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'OVER_SCOPE',
          evidence: 'The change exposes an unapproved behavior.',
          rationale: 'The behavior lies outside the approved intent.',
          requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'typed-over-scope', codeStamp: null });
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), 'Presentation was independently edited.');

    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events: new ConductorEventEmitter(),
    });
    const entry = conductor as unknown as {
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', {} as ConductState)).resolves.toMatchObject({
      kind: 'halt', findings: [{ criterion: 'S1.1', grade: 'OVER_SCOPE' }],
    });
  });

  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-widening-routing-'));
    statePath = join(projectRoot, 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    const offers = await persistPrdWideningOffers(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    }, [{
      criterion: 'NC.1', sourceId: sourceId('The original user-visible widening.'),
      evidence: 'The original user-visible widening.',
      reportSnapshot: 'original report', relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture offer did not persist');
    const offer = offers.offers[0]!;
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: offer.criterion, summary: offer.summary, relation: offer.relation, offerEntryId: offer.offerEntryId,
        originalCaseId: offer.originalCaseId, originalSource: offer.originalSource,
        decision: 'accept', rationale: 'The operator accepted the original behavior.',
      }]),
      '```',
    ].join('\n'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function stateWithPending(...pending: StepName[]): ConductState {
    return Object.fromEntries(ALL_STEPS.map((step) => [
      step.name, pending.includes(step.name) ? 'pending' : 'done',
    ])) as ConductState;
  }

  async function writeTypedOverScope(evidence: string, criterion = 'NC.1'): Promise<void> {
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1', criterionJudgments: [],
        noOwnerObservations: [{
          presentationOrdinal: criterion, grade: 'OVER_SCOPE', evidence,
          rationale: 'The fixture supplies typed outside-visible scope evidence.', intentRelation: 'outside-visible',
        }],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: `typed-${criterion}`, codeStamp: null });
  }

  async function writeTypedStoryOverScope(criterionId: string, evidence: string): Promise<void> {
    const match = /^S(\d+)\.(\d+)$/.exec(criterionId);
    if (!match) throw new Error(`expected a story criterion, got ${criterionId}`);
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: match[1]!, ordinal: Number(match[2]) }, criterionId, grade: 'OVER_SCOPE', evidence,
          rationale: 'Fixture scope evidence.', requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: `typed-${criterionId}`, codeStamp: null });
  }

  async function writeTypedMixedOverScope(
    ncCriterion = 'NC.1',
    ncEvidence = 'The original user-visible widening.',
  ): Promise<void> {
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '3', ordinal: 17 }, criterionId: 'S3.17', grade: 'OVER_SCOPE',
          evidence: 'The story widening is outside visible scope.', rationale: 'Fixture scope evidence.',
          requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
        }],
        noOwnerObservations: [{
          presentationOrdinal: ncCriterion, grade: 'OVER_SCOPE', evidence: ncEvidence,
          rationale: 'Fixture scope evidence.', intentRelation: 'outside-visible',
        }],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'typed-mixed', codeStamp: null });
  }

  function prdAuditEntry(): { preparePrdWideningBeforeAudit(): Promise<string | undefined> } {
    return new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> };
  }

  async function verifyMixedStoryAndNcReproduction(ncEvidence: string): Promise<void> {
    await writeTypedMixedOverScope('NC-2', ncEvidence);
    const events = new ConductorEventEmitter();
    const imported: Array<{ readonly decisionId?: string }> = [];
    events.on('prd_widening_reconciled', event => {
      if (event.type === 'prd_widening_reconciled' && event.outcome === 'imported') imported.push(event);
    });
    const entry = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> };

    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    const feature = { version: 1 as const, repository: '/fixture/repository', feature: 'prd-widening-routing' };
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, feature).read();
    const cases = await new RemediationCaseStore(projectRoot, { ...feature, version: 'v1' }).read();
    if (decisions.kind !== 'valid' || !cases.ok || cases.state.version !== 'v4') throw new Error('expected captured authority');
    expect(imported).toHaveLength(2);
    expect(imported.map(({ decisionId }) => decisions.state.decisions.find((decision) => decision.id === decisionId)?.criterion)
      .sort()).toEqual(['NC-2', 'S3.17']);
    const ncDecision = decisions.state.decisions.find((decision) => decision.criterion === 'NC-2');
    if (!ncDecision?.originalCaseId) throw new Error('expected captured NC-2 authority');
    const routedCases = cases.state.prdWideningCases.map((candidate) => candidate.id !== ncDecision.originalCaseId ? candidate : {
      ...candidate,
      currentSources: [{
        sourceId: sourceId(ncEvidence, 'NC-2'), snapshot: ncEvidence, recordedAt: '2026-01-01T00:00:00.000Z',
      }],
      relationships: [{
        currentSourceId: sourceId(ncEvidence, 'NC-2'), kind: 'same-case' as const,
        caseId: candidate.id, reason: 'The current observation is the persisted offer.',
      }],
      reconciliationDigest: 'fixture-3548-publication',
    });
    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [
        { criterion: 'S3.17', grade: 'OVER_SCOPE' as const, prdIds: [], evidence: 'The story widening is outside visible scope.' },
        { criterion: 'NC-2', grade: 'OVER_SCOPE' as const, prdIds: [], evidence: ncEvidence },
      ], rejectedRows: [] },
      new Map([['S3.17', 'outside-visible' as const], ['NC-2', 'outside-visible' as const]]),
      decisions.state.decisions, routedCases,
    );
    if (route.kind !== 'refusal-rework') throw new Error(`expected refusal-rework, got ${route.kind}`);
    expect(route.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: 'S3.17', decision: 'refuse' }),
      expect.objectContaining({ criterion: 'NC-2', decision: 'accept', accepted: true }),
    ]));
  }

  it('keeps the offerless-NC mixed block on the legacy whole-block capture path', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const ncEvidence = 'The second visible widening is outside approved scope.';
    await writeFile(clearPath, [
      '```json over-scope-decisions', JSON.stringify([
        {
          criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse',
          rationale: 'The operator refuses this newly raised story criterion.',
        },
        {
          criterion: 'NC-2', summary: ncEvidence, decision: 'accept',
          rationale: 'The operator accepts this newly raised no-owner criterion.',
        },
      ]), '```',
    ].join('\n'));
    await verifyMixedStoryAndNcReproduction(ncEvidence);
  });

  it('proves the #3548 mixed story and offer-backed NC reproduction through PRD-audit entry', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const ncEvidence = 'The second visible widening is outside approved scope.';
    const offers = await persistPrdWideningOffers(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    }, [{
      criterion: 'NC-2', sourceId: sourceId(ncEvidence, 'NC-2'), evidence: ncEvidence,
      reportSnapshot: 'second original report', relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture NC-2 offer did not persist');
    const nc = JSON.parse(offers.block.match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, ['```json over-scope-decisions', JSON.stringify([
      {
        criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse',
        rationale: 'The operator refuses this newly raised story criterion.',
      },
      { ...nc, decision: 'accept', rationale: 'The operator accepts this newly raised no-owner criterion.' },
    ]), '```'].join('\n'));
    await verifyMixedStoryAndNcReproduction(ncEvidence);
  });

  it('records an accepted offerless S4.2 beside a pending offer-backed NC.1', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const nc = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, ['```json over-scope-decisions', JSON.stringify([
      {
        criterion: 'S4.2', summary: 'The story widening is outside visible scope.', decision: 'accept',
        rationale: 'The operator accepts this newly raised story criterion.',
      },
      { ...nc, decision: 'pending' },
    ]), '```'].join('\n'));
    await writeTypedStoryOverScope('S4.2', 'The story widening is outside visible scope.');

    await expect(prdAuditEntry().preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    if (decisions.kind !== 'valid') throw new Error('expected captured S4.2 decision');
    const route = routeTypedPrdAuditOverScope(
      { prd: 'present', findings: [{ criterion: 'S4.2', grade: 'OVER_SCOPE', prdIds: [], evidence: 'The story widening is outside visible scope.' }], rejectedRows: [] },
      new Map([['S4.2', 'outside-visible' as const]]), decisions.state.decisions, [],
    );

    expect(route).toMatchObject({
      kind: 'record', findings: [expect.objectContaining({ criterion: 'S4.2', decision: 'accept', accepted: true })],
    });
  });

  it('keeps a pending story criterion in the next halt after recording its decided sibling', async () => {
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), ['```json over-scope-decisions', JSON.stringify([
      {
        criterion: 'S1.2', summary: 'The first story widening is outside visible scope.', decision: 'refuse',
        rationale: 'The operator refuses this newly raised story criterion.',
      },
      { criterion: 'S1.3', summary: 'The second story widening is outside visible scope.', decision: 'pending' },
    ]), '```'].join('\n'));
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [
          {
            criterion: { storyId: '1', ordinal: 2 }, criterionId: 'S1.2', grade: 'OVER_SCOPE',
            evidence: 'The first story widening is outside visible scope.', rationale: 'Fixture scope evidence.',
            requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
          },
          {
            criterion: { storyId: '1', ordinal: 3 }, criterionId: 'S1.3', grade: 'OVER_SCOPE',
            evidence: 'The second story widening is outside visible scope.', rationale: 'Fixture scope evidence.',
            requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
          },
        ],
        noOwnerObservations: [],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'typed-story-only', codeStamp: null });

    await expect(prdAuditEntry().preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    if (decisions.kind !== 'valid') throw new Error('expected captured S1.2 decision');
    expect(decisions.state.decisions).toHaveLength(1);
    expect(decisions.state.decisions[0]).toMatchObject({ criterion: 'S1.2', authority: 'refuse' });
    const route = routeTypedPrdAuditOverScope(
      {
        prd: 'present', findings: [
          { criterion: 'S1.2', grade: 'OVER_SCOPE', prdIds: [], evidence: 'The first story widening is outside visible scope.' },
          { criterion: 'S1.3', grade: 'OVER_SCOPE', prdIds: [], evidence: 'The second story widening is outside visible scope.' },
        ], rejectedRows: [],
      },
      new Map([['S1.2', 'outside-visible' as const], ['S1.3', 'outside-visible' as const]]), decisions.state.decisions, [],
    );

    if (route.kind !== 'halt') throw new Error(`expected halt, got ${route.kind}`);
    expect(JSON.parse(renderOverScopeDecisionBlock(route.undecided, route.refused).match(/\[.*\]/s)?.[0] ?? '[]')).toEqual([
      expect.objectContaining({ criterion: 'S1.3', decision: 'pending' }),
    ]);
  });

  it('renders one criterion-named recovery per capture-defect reason at PRD-audit entry', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const nc = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, [
      '```json over-scope-decisions', JSON.stringify([
        { ...nc, criterion: 'NC.1', offerEntryId: undefined },
        { criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: '' },
      ]), '```',
    ].join('\n'));
    await writeTypedMixedOverScope();
    const events = new ConductorEventEmitter();
    const rejected: unknown[] = [];
    events.on('prd_widening_reconciled', event => { if (event.type === 'prd_widening_reconciled' && event.outcome === 'rejected') rejected.push(event); });
    const entry = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> };

    const recovery = await entry.preparePrdWideningBeforeAudit();
    expect(recovery).toContain('changed-offer-reference');
    expect(recovery).toContain('NC.1');
    expect(recovery).toContain('missing-rationale');
    expect(recovery).toContain('S3.17');
    expect(recovery).not.toMatch(/malformed-history|known-good copy|no specific record/);
    expect(rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'NC.1', reason: 'changed-offer-reference' }),
      expect.objectContaining({ sourceId: 'S3.17', reason: 'missing-rationale' }),
    ]));
  });

  it.each([
    ['changed offer reference', async (nc: Record<string, unknown>) => [{ ...nc, criterion: 'NC-2', offerEntryId: undefined }], 'changed-offer-reference', 'NC-2', 'correct that entry against the latest halt'],
    ['missing rationale', async () => [{ criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: '' }], 'missing-rationale', 'S3.17', 'provide a rationale for that entry'],
    ['duplicated offer entry', async (nc: Record<string, unknown>) => [nc, nc], 'duplicate-decision-entry', 'NC.1', 'keep one entry per criterion'],
    ['unparsable block', async () => '{not-json', 'unreadable-decision-block', undefined, "repair the block's JSON"],
    ['non-object entry', async (nc: Record<string, unknown>) => [nc, null], 'unreadable-decision-entry', undefined, 'repair the named decision entry'],
    ['unoffered story criterion', async () => [{ criterion: 'S9.9', summary: 'An unoffered story criterion.', decision: 'accept', rationale: 'It was not offered.' }], 'unknown-criterion', 'S9.9', 'remove the unoffered criterion'],
  ] as const)('returns its own recovery and rejection source for a %s', async (_name, entries, reason, criterion, action) => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const nc = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0] as Record<string, unknown>;
    const body = await entries(nc);
    await writeFile(clearPath, typeof body === 'string'
      ? `\`\`\`json over-scope-decisions\n${body}\n\`\`\``
      : ['```json over-scope-decisions', JSON.stringify(body), '```'].join('\n'));
    await writeTypedMixedOverScope();
    const events = new ConductorEventEmitter();
    const rejected: unknown[] = [];
    events.on('prd_widening_reconciled', event => { if (event.type === 'prd_widening_reconciled' && event.outcome === 'rejected') rejected.push(event); });

    const recovery = await (new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> }).preparePrdWideningBeforeAudit();

    expect(recovery).toContain(reason);
    expect(recovery).toContain(action);
    if (criterion !== undefined) {
      expect(recovery).toContain(criterion);
      expect(rejected).toContainEqual(expect.objectContaining({ sourceId: criterion }));
    }
    expect(recovery).not.toMatch(/malformed-history|known-good copy|no specific record/);
  });

  it.each(['absent', 'non-json'] as const)('keeps S3.17 pending when its verdict file is %s', async (verdictState) => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(clearPath, [
      '```json over-scope-decisions', JSON.stringify([{
        criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse',
        rationale: 'The operator refuses the offered story criterion.',
      }]), '```',
    ].join('\n'));
    const verdictPath = join(projectRoot, '.pipeline', 'prd-audit-verdict.json');
    if (verdictState === 'absent') await rm(verdictPath, { force: true });
    else await writeFile(verdictPath, '{not-json');
    const events = new ConductorEventEmitter();
    const rejected: unknown[] = [];
    events.on('prd_widening_reconciled', event => { if (event.type === 'prd_widening_reconciled' && event.outcome === 'rejected') rejected.push(event); });
    const recovery = await (new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> }).preparePrdWideningBeforeAudit();

    expect(recovery).toContain('offered-set-unavailable');
    expect(recovery).toContain('S3.17');
    expect(recovery).toContain('leave the named entry pending so the next audit offers it again');
    expect(rejected).toContainEqual(expect.objectContaining({ sourceId: 'S3.17', reason: 'offered-set-unavailable' }));
    await expect(new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read()).resolves.toMatchObject({ kind: 'absent' });
  });

  it.each([
    ['retired marker', 'OVER_SCOPE_ACCEPT: S3.17 approved by operator'],
    ['non-array decision block', '```json over-scope-decisions\n{"entries":[]}\n```'],
  ] as const)('returns unsupported-history and records nothing for a %s', async (_name, clear) => {
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), clear);
    const recovery = await prdAuditEntry().preparePrdWideningBeforeAudit();
    expect(recovery).toContain('unsupported-history');
    await expect(new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read()).resolves.toMatchObject({ kind: 'absent' });
  });

  it('records an offered sibling while rejecting unoffered S9.9', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const nc = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, ['```json over-scope-decisions', JSON.stringify([
      { criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: 'The operator refuses it.' },
      { criterion: 'S9.9', summary: 'An unoffered story criterion.', decision: 'accept', rationale: 'It was not offered.' }, nc,
    ]), '```'].join('\n'));
    await writeTypedMixedOverScope();
    await expect(prdAuditEntry().preparePrdWideningBeforeAudit()).resolves.toContain('unknown-criterion');
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    expect(decisions).toMatchObject({ kind: 'valid' });
    if (decisions.kind !== 'valid') throw new Error('expected captured sibling decisions');
    expect(decisions.state.decisions.map((decision) => decision.criterion)).toEqual(expect.arrayContaining(['S3.17', 'NC.1']));
    expect(decisions.state.decisions.map((decision) => decision.criterion)).not.toContain('S9.9');
  });

  async function persistedNc2(): Promise<Record<string, unknown>> {
    const offers = await persistPrdWideningOffers(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    }, [{
      criterion: 'NC.2', sourceId: sourceId('A second original visible widening.', 'NC.2'),
      evidence: 'A second original visible widening.', reportSnapshot: 'second original report', relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture NC.2 offer did not persist');
    return JSON.parse(offers.block.match(/\[.*\]/s)?.[0] ?? '[]')[0];
  }

  it('records NC.2 while an empty S3.17 rationale halts capture', async () => {
    const nc2 = await persistedNc2();
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), ['```json over-scope-decisions', JSON.stringify([
      { criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: '' },
      { ...nc2, decision: 'accept', rationale: 'The operator accepts the offered NC.2 behavior.' },
    ]), '```'].join('\n'));
    await writeTypedMixedOverScope();
    const recovery = await prdAuditEntry().preparePrdWideningBeforeAudit();
    expect(recovery).toContain('missing-rationale');
    expect(recovery).toContain('S3.17');
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    expect(decisions).toMatchObject({ kind: 'valid' });
    if (decisions.kind !== 'valid') throw new Error('expected captured NC.2 sibling');
    expect(decisions.state.decisions.map((decision) => decision.criterion)).toEqual(['NC.2']);
  });

  it('records S3.17 while a stripped NC.2 offer reference halts capture', async () => {
    const nc2 = await persistedNc2();
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), ['```json over-scope-decisions', JSON.stringify([
      { criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: 'The operator refuses it.' },
      { ...nc2, decision: 'accept', rationale: 'The operator accepts the offered NC.2 behavior.', offerEntryId: undefined },
    ]), '```'].join('\n'));
    await writeTypedMixedOverScope();
    const recovery = await prdAuditEntry().preparePrdWideningBeforeAudit();
    expect(recovery).toContain('changed-offer-reference');
    expect(recovery).toContain('NC.2');
    const decisions = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    expect(decisions).toMatchObject({ kind: 'valid' });
    if (decisions.kind !== 'valid') throw new Error('expected captured S3.17 sibling');
    expect(decisions.state.decisions.map((decision) => decision.criterion)).toEqual(['S3.17']);
  });

  it('halts missing-operator for S3.17 without recording either entry', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const nc = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, ['```json over-scope-decisions', JSON.stringify([
      { criterion: 'S3.17', summary: 'The story widening is outside visible scope.', decision: 'refuse', rationale: 'The operator refuses it.' },
      nc,
    ]), '```'].join('\n'));
    await writeTypedMixedOverScope();
    vi.mocked(readMachineOwnerConfig).mockResolvedValueOnce({ spec_owner: null });
    const events = new ConductorEventEmitter();
    const rejected: unknown[] = [];
    events.on('prd_widening_reconciled', event => { if (event.type === 'prd_widening_reconciled' && event.outcome === 'rejected') rejected.push(event); });
    const recovery = await (new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: { run: vi.fn(async () => ({ success: true })) }, events,
    }) as unknown as { preparePrdWideningBeforeAudit(): Promise<string | undefined> }).preparePrdWideningBeforeAudit();
    expect(recovery).toContain('missing-operator');
    expect(recovery).toContain('S3.17');
    expect(rejected).toContainEqual(expect.objectContaining({ sourceId: 'S3.17', reason: 'missing-operator' }));
    await expect(new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read()).resolves.toMatchObject({ kind: 'absent' });
  });

  it.each([
    ['accepted-widenings.json', '{not-json', 'malformed-history'],
    ['accepted-widenings.json', '{"version":999,"decisions":[]}', 'unsupported-history'],
    ['accepted-widenings.json', JSON.stringify({
      version: 2,
      feature: { version: 1, repository: '/fixture/repository', feature: 'another-feature' },
      decisions: [],
    }), 'foreign-feature'],
  ] as const)('halts the PRD-audit entry as %s for %s without changing either history', async (file, raw, recovery) => {
    const acceptedPath = join(projectRoot, '.pipeline', 'accepted-widenings.json');
    const casesPath = join(projectRoot, '.pipeline', 'remediation-cases.json');
    const casesBefore = await readFile(casesPath, 'utf8');
    await writeFile(join(projectRoot, '.pipeline', file), raw, 'utf8');

    const result = await prdAuditEntry().preparePrdWideningBeforeAudit();

    expect(result).toContain(recovery);
    expect(result).toContain('.pipeline/accepted-widenings.json');
    expect(result).toContain('.pipeline/remediation-cases.json');
    await expect(readFile(join(projectRoot, '.pipeline', file), 'utf8')).resolves.toBe(raw);
    await expect(readFile(casesPath, 'utf8')).resolves.toBe(casesBefore);
    await expect(readFile(acceptedPath, 'utf8')).resolves.toBe(raw);
  });

  it.each([
    ['decision authority', () => vi.spyOn(AcceptedWideningDecisionStore.prototype, 'append')
      .mockResolvedValue({ ok: false, reason: 'atomic-replace-failed' } as never)],
    ['remediation case', () => vi.spyOn(RemediationCaseStore.prototype, 'mutate')
      .mockResolvedValue({ ok: false, reason: 'atomic-replace-failed' } as never)],
  ] as const)('maps an injected %s migration persistence failure to persistence-failed', async (_store, fail) => {
    await writeFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
      version: 1,
      decisions: [{
        criterion: 'NC.1', summary: 'The original user-visible widening.', decision: 'accept',
        rationale: 'The legacy decision was accepted.', operator: 'fixture-operator', decidedAt: '2026-10-01T00:00:00.000Z',
      }],
    }), 'utf8');
    const spy = fail();
    try {
      await expect(prdAuditEntry().preparePrdWideningBeforeAudit()).resolves.toContain('persistence-failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps rejected cleared rows out of well-formed history while appending the valid decision only', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    const casesPath = join(projectRoot, '.pipeline', 'remediation-cases.json');
    const casesBefore = await readFile(casesPath, 'utf8');
    const valid = JSON.parse((await readFile(clearPath, 'utf8')).match(/\[.*\]/s)?.[0] ?? '[]')[0];
    await writeFile(clearPath, [
      '```json over-scope-decisions',
      JSON.stringify([
        valid,
        {
          criterion: 'S9.9', summary: 'An unoffered story criterion.', decision: 'accept',
          rationale: 'This entry must be rejected because it was never offered.',
        },
      ]),
      '```',
    ].join('\n'));

    await prdAuditEntry().preparePrdWideningBeforeAudit();
    await expect(new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read()).resolves.toMatchObject({
      kind: 'valid', state: { decisions: [{ criterion: 'NC.1', authority: 'accept' }] },
    });
    await expect(readFile(casesPath, 'utf8')).resolves.toBe(casesBefore);
  });

  it('uses the validator-emitted NC-1 presentation ordinal in the typed contract', () => {
    const result = validatePrdAuditJudgment({
      version: 'v1', criterionJudgments: [],
      noOwnerObservations: [{ grade: 'OVER_SCOPE', evidence: 'A distinct visible widening.', rationale: 'The finding has no owning criterion.', intentRelation: 'outside-visible' }],
    }, { criteria: [], requirements: [] });
    expect(result).toMatchObject({ ok: true, judgment: { noOwnerObservations: [{ presentationOrdinal: 'NC-1' }] } });
  });

  it('keeps a validator-emitted later NC-1 distinct from a decided legacy NC.1 case without BUILD work', async () => {
    const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'prd-widening-routing' };
    const caseStore = new RemediationCaseStore(projectRoot, feature);
    const before = await caseStore.read();
    if (!before.ok || before.state.version !== 'v4') throw new Error('expected original widening case');
    const originalCaseId = before.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: feature.feature } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate' ? {
        success: true,
        finalStructuredResult: {
          version: 'v1',
          results: [{
            sourceId: sourceId('A semantically different visible behavior.', 'NC-1'),
            kind: 'different',
            reason: 'The later observation describes an independent behavior.',
          }],
        },
      } : { success: true }),
    };
    const conductor = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<PrdAuditOverScopeRoute>;
    };

    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    const validation = validatePrdAuditJudgment({
      version: 'v1', criterionJudgments: [],
      noOwnerObservations: [{
        grade: 'OVER_SCOPE', evidence: 'A semantically different visible behavior.',
        rationale: 'The later observation has no owning criterion.', intentRelation: 'outside-visible',
      }],
    }, { criteria: [], requirements: [] });
    if (!validation.ok) throw new Error(validation.diagnostics.join('; '));
    expect(validation.judgment.noOwnerObservations[0]!.presentationOrdinal).toBe('NC-1');
    await persistPrdAuditVerdict(projectRoot, {
      complete: true, judgment: validation.judgment, diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'validator-emitted-nc-1', codeStamp: null });

    const route = await entry.routeCurrentPrdAuditOverScope(feature.feature, state);
    expect(route).toMatchObject({
      kind: 'halt',
      findings: [expect.objectContaining({ criterion: 'NC-1', accepted: false })],
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('remediate', state, expect.any(Object));
    await expect(new AcceptedWideningDecisionStore(projectRoot, { ...feature, version: 1 }).read()).resolves.toMatchObject({
      kind: 'valid', state: { decisions: [expect.objectContaining({ originalCaseId, authority: 'accept' })] },
    });
    await expect(caseStore.read()).resolves.toMatchObject({
      state: {
        prdWideningCases: expect.arrayContaining([
          expect.objectContaining({ id: originalCaseId }),
          expect.objectContaining({
            currentSources: [expect.objectContaining({ sourceId: sourceId('A semantically different visible behavior.', 'NC-1') })],
            relationships: [expect.objectContaining({ kind: 'different' })],
          }),
        ]),
      },
    });
  });

  it.each(['same-case', 'different'] as const)('captures the rendered %s offer after reconciliation', async (kind) => {
    const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'prd-widening-routing' };
    const caseStore = new RemediationCaseStore(projectRoot, feature);
    const original = await caseStore.read();
    if (!original.ok || original.state.version !== 'v4') throw new Error('missing fixture');
    const caseId = original.state.prdWideningCases[0]!.id;
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(clearPath, (await readFile(clearPath, 'utf8')).replace('"accept"', '"refuse"'));
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true, finalStructuredResult: {
      version: 'v1', results: [{ sourceId: sourceId('Reworded current behavior.', 'NC.2'), kind,
        ...(kind === 'same-case' ? { caseId } : {}),
        reason: 'Fixture semantic judgement.',
      }],
    } })) };
    const entry = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() }) as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<PrdAuditOverScopeRoute>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('Reworded current behavior.', 'NC.2');
    const route = await entry.routeCurrentPrdAuditOverScope(feature.feature, { feature_desc: feature.feature } as ConductState);
    if (route.kind === 'none') throw new Error('expected a findings-bearing route');
    expect(route.findings).toEqual(expect.arrayContaining([expect.objectContaining({ criterion: 'NC.2' })]));
    if (kind === 'same-case') {
      // An all-refused set routes to BUILD rework, so it no longer renders an
      // editable operator offer.
      if (route.kind !== 'refusal-rework') throw new Error(`expected refusal-rework, got ${route.kind}`);
      expect(route.refusals).toHaveLength(1);
    } else {
      if (route.kind !== 'halt') throw new Error('expected an operator offer');
      const rendered = renderOverScopeDecisionBlock([...route.undecided, ...route.refused]);
      const cleared = rendered.replaceAll('"decision": "pending"', '"decision": "accept", "rationale": "Explicit operator reversal."');
      const result = await capturePrdWideningDecisions(cleared, {
        operator: 'operator', offerStore: caseStore,
        decisionStore: new AcceptedWideningDecisionStore(projectRoot, { ...feature, version: 1 }),
        offeredStoryCriteria: { kind: 'available', criteria: new Set() },
      });
      expect(result.defects).toEqual([]);
      expect(result.captured).toEqual([expect.objectContaining({ authority: 'accept' })]);
    }
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('reports the actual context size and limit through recovery and the event spine', async () => {
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('prd_widening_reconciled', event => { emitted.push(event); });
    const runner: StepRunner = { run: vi.fn() };
    const entry = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events }) as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('x'.repeat(8001));
    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', {} as ConductState)).resolves.toMatchObject({
      kind: 'halt', detail: expect.stringContaining('context-overflow:proseBytes actual=8001 limit=8000'),
    });
    expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'context-overflow:proseBytes actual=8001 limit=8000' })]));
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('renders captured original authority into both serial and concurrent audit dispatches without semantic remediation', async () => {
    const contexts: unknown[] = [];
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push(step);
        if (step === 'prd_audit') {
          contexts.push((options as { prdWideningReviewContext?: unknown } | undefined)?.prdWideningReviewContext);
        }
        return step === 'prd_audit' && calls.filter((item) => item === 'prd_audit').length === 1
          ? { success: false, output: 'stop after serial dispatch' }
          : { success: true };
      }),
    };

    await writeState(statePath, stateWithPending('prd_audit'));
    await new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner,
      events: new ConductorEventEmitter(), fromStep: 'prd_audit', maxRetries: 1,
    }).run();

    // Repeat the pre-audit boundary through the concurrent validation path;
    // clearing v2 decisions proves it cannot inherit the serial object's memory.
    await unlink(join(projectRoot, '.pipeline', 'accepted-widenings.json'));
    await writeState(statePath, stateWithPending('manual_test', 'prd_audit', 'architecture_review_as_built'));
    await new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner,
      events: new ConductorEventEmitter(), fromStep: 'manual_test', mode: 'auto', maxRetries: 1,
      verifyArtifacts: false,
    }).run();

    expect(contexts).toEqual([
      expect.objectContaining({
        decisions: [expect.objectContaining({
          authority: 'accept', originalSource: { id: sourceId('The original user-visible widening.'), snapshot: 'The original user-visible widening.' },
        })],
      }),
      expect.objectContaining({
        decisions: [expect.objectContaining({ authority: 'accept' })],
      }),
    ]);
    expect(calls).not.toContain('remediate');
  });

  it('reconciles a replacement report against the captured offer before routing accepted authority', async () => {
    const coordinate = vi.spyOn(coordinatorModule, 'coordinatePrdWidening');
    const caseStore = new RemediationCaseStore(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    });
    const stored = await caseStore.read();
    if (!stored.ok || stored.state.version !== 'v4') throw new Error('expected v4 fixture store');
    const originalCaseId = stored.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate'
        ? {
            success: true,
            finalStructuredResult: {
              version: 'v1',
              results: [{
                sourceId: sourceId('Replacement wording for the same behavior.'), kind: 'same-case', caseId: originalCaseId,
                reason: 'The replacement report describes the accepted original behavior.',
              }],
            },
          }
        : { success: true }),
    };
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(),
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('Replacement wording for the same behavior.');

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'record', findings: [{ criterion: 'NC.1', decision: 'accept' }],
    });
    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'record', findings: [{ criterion: 'NC.1', decision: 'accept' }],
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(coordinate).toHaveBeenCalledWith(expect.objectContaining({
      freshness: expect.objectContaining({ sample: expect.any(Function) }),
      decisionStore: expect.objectContaining({ read: expect.any(Function) }),
      codeDigest: expect.any(String),
      readCodeDigest: expect.any(Function),
    }));
    coordinate.mockRestore();
  });

  it('sends a renumbered current NC through reconciliation instead of minting a second pending offer', async () => {
    const caseStore = new RemediationCaseStore(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    });
    const stored = await caseStore.read();
    if (!stored.ok || stored.state.version !== 'v4') throw new Error('expected v4 fixture store');
    const originalCaseId = stored.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate' ? {
        success: true,
        finalStructuredResult: {
          version: 'v1',
          results: [{ sourceId: sourceId('The original user-visible widening.', 'NC.2'), kind: 'same-case', caseId: originalCaseId, reason: 'The renumbered source is the original behavior.' }],
        },
      } : { success: true }),
    };
    const conductor = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('The original user-visible widening.', 'NC.2');

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'record', findings: [{ criterion: 'NC.2', decision: 'accept' }],
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    await expect(caseStore.read()).resolves.toMatchObject({ state: { prdWideningCases: [expect.objectContaining({ id: originalCaseId })] } });
  });

  it('rejects a report change made during the production reconciliation boundary as stale', async () => {
    const stored = await new RemediationCaseStore(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    }).read();
    if (!stored.ok || stored.state.version !== 'v4') throw new Error('expected v4 fixture store');
    const originalCaseId = stored.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step !== 'remediate') return { success: true };
        await writeTypedOverScope('A changed source arrived while reconciliation ran.');
        return {
          success: true,
          finalStructuredResult: {
            version: 'v1',
            results: [{ sourceId: sourceId('Replacement wording needs reconciliation.'), kind: 'same-case', caseId: originalCaseId, reason: 'Original result.' }],
          },
        };
      }),
    };
    const conductor = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('Replacement wording needs reconciliation.');

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'halt', detail: expect.stringContaining('stale-relation'),
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('surfaces an exhausted unavailable reconciliation allowance without creating work', async () => {
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate'
        ? { success: false, output: 'Provider selected for reconciliation is unavailable.' }
        : { success: true }),
    };
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(),
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('Replacement wording needs reconciliation.');

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'halt', detail: expect.stringContaining('attempts-exhausted'),
    });
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runner.run).toHaveBeenCalledWith('remediate', state, expect.objectContaining({
      remediationRequest: expect.objectContaining({ mode: 'prd-widening-reconciliation' }),
    }));
  });

  it.each([
    ['the unconfigured remediate default', undefined, undefined, 3],
    ['a SHIP tier override', { phases: { SHIP: { by_tier: { M: { max_retries: 2 } } } } }, 'M', 2],
  ] as const)('passes %s to the reconciliation coordinator', async (_description, config, complexityTier, expectedAttempts) => {
    const coordinate = vi.spyOn(coordinatorModule, 'coordinatePrdWidening');
    const state = {
      session_started_at: Date.now(),
      feature_desc: 'prd-widening-routing',
      ...(complexityTier === undefined ? {} : { complexity_tier: complexityTier }),
    } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate'
        ? { success: false, output: 'Provider selected for reconciliation is unavailable.' }
        : { success: true }),
    };
    const conductor = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(), config,
    });
    const entry = conductor as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<unknown>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('Replacement wording needs reconciliation.');

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'halt', detail: expect.stringContaining('attempts-exhausted'),
    });
    expect(coordinate).toHaveBeenCalledWith(expect.objectContaining({
      mechanicalFailure: expect.objectContaining({ remainingAttempts: expectedAttempts }),
    }));
    expect(runner.run).toHaveBeenCalledTimes(expectedAttempts);
    coordinate.mockRestore();
  });

  it('harvests an empty-rationale refusal as pending, never as refusal-rework', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(clearPath, (await readFile(clearPath, 'utf8'))
      .replace('"accept"', '"refuse"')
      .replace('The operator accepted the original behavior.', ''));

    const decisionStore = new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'prd-widening-routing',
    });
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };
    const entry = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() }) as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<PrdAuditOverScopeRoute>;
    };

    const prepared = await entry.preparePrdWideningBeforeAudit();
    expect(prepared).toBeDefined();
    await writeTypedOverScope('The original user-visible widening.', 'NC.1');
    const route = await entry.routeCurrentPrdAuditOverScope('prd-widening-routing', { feature_desc: 'prd-widening-routing' } as ConductState);

    if (route.kind !== 'halt') throw new Error(`expected pending halt, got ${route.kind}`);
    expect(route.undecided.map((entry) => entry.criterion)).toEqual(['NC.1']);
    expect(route.refused).toEqual([]);
    const decisions = await decisionStore.read();
    expect(decisions.kind === 'valid' ? decisions.state.decisions : []).toEqual([]);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('surfaces refusal-rework through routeCurrentPrdAudit as over-scope-refusal-rework', async () => {
    const clearPath = join(projectRoot, '.pipeline', 'HALT.cleared');
    await writeFile(clearPath, (await readFile(clearPath, 'utf8')).replace('"accept"', '"refuse"'));

    const caseStore = new RemediationCaseStore(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'prd-widening-routing',
    });
    const stored = await caseStore.read();
    if (!stored.ok || stored.state.version !== 'v4') throw new Error('expected v4 fixture store');
    const originalCaseId = stored.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => step === 'remediate'
        ? {
            success: true,
            finalStructuredResult: {
              version: 'v1',
              results: [{ sourceId: sourceId('The original user-visible widening.', 'NC.1'), kind: 'same-case', caseId: originalCaseId, reason: 'Fixture semantic judgement.' }],
            },
          }
        : { success: true }),
    };
    const entry = new Conductor({ projectRoot, stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter() }) as unknown as {
      preparePrdWideningBeforeAudit(): Promise<string | undefined>;
      routeCurrentPrdAudit(state: ConductState): Promise<{ kind: string; route?: { refusals?: readonly unknown[] } }>;
    };

    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeTypedOverScope('The original user-visible widening.', 'NC.1');
    const route = await entry.routeCurrentPrdAudit(state);

    expect(route.kind).toBe('over-scope-refusal-rework');
    expect(route.route?.refusals).toHaveLength(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
