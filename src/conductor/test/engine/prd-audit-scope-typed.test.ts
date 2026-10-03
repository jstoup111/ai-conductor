// Covers: task:22, Story 6 c43 c47

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'typed-scope',
  })),
}));

import { classifyPrdAuditGaps, checkStepCompletion } from '../../src/engine/artifacts.js';
import { AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict, readPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { capturePrdWideningDecisions } from '../../src/engine/prd-widening-capture.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

type ScopeRoute =
  | { kind: 'none' }
  | { kind: 'record' }
  | { kind: 'plan-gap-halt'; route: { kind: 'halt'; detail: string } }
  | { kind: 'over-scope-halt'; route: { kind: 'halt'; undecided: unknown[]; refused: unknown[] } }
  | { kind: 'projection-halt'; reason: string };

describe('typed PRD-audit scope routing', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-audit-scope-typed-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function conductor(): { routeCurrentPrdAudit(state: { feature_desc: string }): Promise<ScopeRoute> } {
    return new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
    }) as unknown as { routeCurrentPrdAudit(state: { feature_desc: string }): Promise<ScopeRoute> };
  }

  async function writeVerdict(input: {
    complete?: boolean;
    diagnostics?: readonly string[];
    judgments?: readonly {
      criterionId: string;
      grade: 'PASS' | 'FIXABLE' | 'PLAN_GAP' | 'OVER_SCOPE';
      intentRelation?: 'within' | 'outside-harmless' | 'outside-visible';
    }[];
    noOwnerObservations?: readonly {
      presentationOrdinal: string;
      evidence: string;
      intentRelation: 'within' | 'outside-harmless' | 'outside-visible';
    }[];
  } = {}): Promise<void> {
    await persistPrdAuditVerdict(projectRoot, {
      complete: input.complete ?? true,
      judgment: {
        version: 'v1',
        criterionJudgments: (input.judgments ?? []).map((judgment, index) => ({
          criterion: { storyId: '1', ordinal: index + 1 },
          criterionId: judgment.criterionId,
          grade: judgment.grade,
          evidence: `Typed evidence for ${judgment.criterionId}.`,
          rationale: `Typed rationale for ${judgment.criterionId}.`,
          requirementAssociations: [],
          evidenceTaskIds: [],
          ...(judgment.grade === 'FIXABLE' ? { ownerTaskId: '1' } : {}),
          ...(judgment.grade === 'OVER_SCOPE' ? { intentRelation: judgment.intentRelation! } : {}),
        })),
        noOwnerObservations: (input.noOwnerObservations ?? []).map((observation) => ({
          presentationOrdinal: observation.presentationOrdinal,
          grade: 'OVER_SCOPE' as const,
          evidence: observation.evidence,
          rationale: `Typed rationale for ${observation.presentationOrdinal}.`,
          intentRelation: observation.intentRelation,
        })),
      },
      diagnostics: input.diagnostics ?? [],
      recordedDispositions: [],
    }, { attemptId: 'typed-scope', codeStamp: null });
  }

  it('records typed within-intent and outside-harmless scope observations without operator authority', async () => {
    await writeVerdict({ judgments: [
      { criterionId: 'S1.1', grade: 'OVER_SCOPE', intentRelation: 'within' },
      { criterionId: 'S1.2', grade: 'OVER_SCOPE', intentRelation: 'outside-harmless' },
    ] });

    await expect(checkStepCompletion(projectRoot, 'prd_audit', { sessionStartedAt: 0 })).resolves.toMatchObject({ done: true });
    await expect(classifyPrdAuditGaps(projectRoot, undefined)).resolves.toEqual({ kind: 'clean', summary: 'no blocking FRs' });
    await expect(conductor().routeCurrentPrdAudit({ feature_desc: 'typed-scope' })).resolves.toEqual({ kind: 'record' });

    await expect(readPrdAuditVerdict(projectRoot)).resolves.toMatchObject({
      kind: 'present',
      value: {
        recordedDispositions: expect.arrayContaining([
          expect.objectContaining({ criterionId: 'S1.1', grade: 'OVER_SCOPE', decision: 'record', authority: 'engine' }),
          expect.objectContaining({ criterionId: 'S1.2', grade: 'OVER_SCOPE', decision: 'record', authority: 'engine' }),
        ]),
      },
    });
  });

  it('does not let a recordable scope row mask a PLAN_GAP or incomplete typed evidence', async () => {
    await writeVerdict({ judgments: [
      { criterionId: 'S1.1', grade: 'PLAN_GAP' },
      { criterionId: 'S1.2', grade: 'OVER_SCOPE', intentRelation: 'within' },
    ] });

    await expect(checkStepCompletion(projectRoot, 'prd_audit', { sessionStartedAt: 0 })).resolves.toMatchObject({ done: false });
    await expect(classifyPrdAuditGaps(projectRoot, undefined)).resolves.toMatchObject({ kind: 'needs-decide' });
    await expect(conductor().routeCurrentPrdAudit({ feature_desc: 'typed-scope' })).resolves.toMatchObject({
      kind: 'plan-gap-halt', route: { detail: expect.stringContaining('S1.1') },
    });

    await writeVerdict({
      complete: false,
      diagnostics: ['The typed audit evidence is incomplete.'],
      judgments: [{ criterionId: 'S1.1', grade: 'OVER_SCOPE', intentRelation: 'outside-harmless' }],
    });
    await expect(checkStepCompletion(projectRoot, 'prd_audit', { sessionStartedAt: 0 })).resolves.toMatchObject({ done: false });
    await expect(classifyPrdAuditGaps(projectRoot, undefined)).resolves.toMatchObject({ kind: 'invalid-evidence' });
    await expect(conductor().routeCurrentPrdAudit({ feature_desc: 'typed-scope' })).resolves.toEqual({ kind: 'none' });
  });

  it('keeps outside-visible pending and refused offers on the scope halt before remediation', async () => {
    const evidence = 'The fixture exposes an unapproved user-visible behavior.';
    const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'typed-scope' };
    const sourceId = prdWideningSourceId({ criterion: 'NC-1', grade: 'OVER_SCOPE', evidence, prdIds: [] });
    const offers = await persistPrdWideningOffers(projectRoot, feature, [{
      criterion: 'NC-1', sourceId, evidence, reportSnapshot: evidence, relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error('fixture offer did not persist');
    const offer = offers.offers[0]!;
    const caseStore = new RemediationCaseStore(projectRoot, feature);
    const related = await caseStore.mutate(async (state) => {
      const cases = state.version === 'v2' ? state.prdWideningCases : [];
      const nextCases = cases.map((record) => record.id !== offer.originalCaseId ? record : {
        ...record,
        reconciliationDigest: 'typed-scope-relation',
        relationships: [...record.relationships, {
          currentSourceId: sourceId,
          kind: 'same-case' as const,
          caseId: record.id,
          reason: 'The current typed observation is the original offered behavior.',
        }],
      });
      return {
        value: nextCases,
        nextState: { version: 'v2' as const, feature: state.feature, cases: state.cases, suppressions: state.suppressions ?? [], prdWideningCases: nextCases },
      };
    });
    if (!related.ok) throw new Error('fixture source relation did not persist');
    await writeVerdict({ noOwnerObservations: [{ presentationOrdinal: 'NC-1', evidence, intentRelation: 'outside-visible' }] });

    const entry = conductor() as unknown as {
      routeCurrentPrdAuditOverScope(): Promise<{
        kind: 'halt';
        undecided: unknown[];
        refused: unknown[];
      }>;
    };
    await expect(entry.routeCurrentPrdAuditOverScope()).resolves.toMatchObject({
      kind: 'halt', undecided: [expect.objectContaining({ criterion: 'NC-1' })], refused: [],
    });

    const captured = await capturePrdWideningDecisions([
      '```json over-scope-decisions',
      JSON.stringify([{
        ...offer,
        decision: 'refuse',
        rationale: 'The operator requires the visible widening to be removed.',
      }]),
      '```',
    ].join('\n'), {
      operator: 'fixture-operator',
      offerStore: caseStore,
      decisionStore: new AcceptedWideningDecisionStore(projectRoot, { ...feature, version: 1 }),
    });
    if (captured.kind !== 'captured' || captured.defects.length > 0 || captured.captured.length !== 1) {
      throw new Error('fixture refusal did not persist through the offer-capture seam');
    }

    const refusedRoute = await entry.routeCurrentPrdAuditOverScope();
    expect(refusedRoute).toMatchObject({
      kind: 'halt',
      undecided: [],
        refused: [expect.objectContaining({ criterion: 'NC-1', kind: 'revise-decision', decision: 'refuse' })],
    });
  });
});
