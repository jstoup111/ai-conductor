// Covers: task:11

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prdAuditBlockingFindings, prdAuditBlockingReason } from '../../src/engine/artifacts.js';
import type { PersistedPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';

const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'reconciled-reason' };
const evidence = 'The audit found a visible widening.';
const sourceId = prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence, prdIds: [] });

type Judgment = PersistedPrdAuditVerdict['judgment'];

function verdict(judgment: Partial<Pick<Judgment, 'criterionJudgments' | 'noOwnerObservations'>>): PersistedPrdAuditVerdict {
  return {
    complete: true,
    judgment: { version: 'v1', criterionJudgments: [], noOwnerObservations: [], ...judgment },
    diagnostics: [],
    recordedDispositions: [],
  } as unknown as PersistedPrdAuditVerdict;
}

const wideningVerdict = verdict({
  noOwnerObservations: [{
    presentationOrdinal: 'NC.1',
    grade: 'OVER_SCOPE',
    evidence,
    rationale: 'Fixture supplies typed audit evidence.',
    intentRelation: 'outside-visible',
  }],
});

describe('prd_audit reconciled verdict reasons', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-audit-reconciled-reason-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    planPath = join(projectRoot, '.docs', 'plans', 'reconciled-reason.md');
    await writeFile(planPath, '### Task 1: Repair the implementation\n');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function publishRelation(kind: 'same-case' | 'uncertain' | 'different'): Promise<void> {
    const store = new RemediationCaseStore(projectRoot, feature);
    const result = await store.mutate(async (_state) => ({
      value: undefined,
      nextState: {
        version: 'v2' as const,
        feature,
        cases: [],
        suppressions: [],
        prdWideningCases: [{
          id: 'case-1',
          domain: 'prd_widening' as const,
          offeredCriterion: 'NC.1',
          originalSources: [{ sourceId, snapshot: evidence }],
          currentSources: [{ sourceId, snapshot: evidence, recordedAt: '2026-10-04T00:00:00.000Z' }],
          relationships: [kind === 'same-case'
            ? { currentSourceId: sourceId, kind, caseId: 'case-1', reason: 'same subject' }
            : kind === 'uncertain'
              ? { currentSourceId: sourceId, kind, candidateCaseIds: ['case-1'], reason: 'ambiguous subject' }
              : { currentSourceId: sourceId, kind, reason: 'different subject' }],
          reconciliationDigest: 'reconciled-lap',
        }],
      },
    }));
    if (!result.ok) throw new Error(`fixture write failed: ${result.reason}`);
  }

  async function score(subject: PersistedPrdAuditVerdict = wideningVerdict) {
    return prdAuditBlockingReason(await prdAuditBlockingFindings(projectRoot, subject));
  }

  it('re-scores all six post-reconciliation fixtures before persisting the prd_audit verdict reason', async () => {
    // (a) Same-lap offer has a fresh relation but no operator decision.
    await publishRelation('same-case');
    const awaitingDecision = await score();
    expect(awaitingDecision).toContain('NC.1 (OVER_SCOPE) [awaiting-decision]');
    expect(awaitingDecision).toContain('ai-conductor halt clear');
    expect(awaitingDecision).not.toContain('[missing-relation]');
    expect(awaitingDecision).not.toContain('close the gap (BUILD)');

    // (b) An accepted prior lap is not blocking, while (c) and (f) preserve
    // the reconciler's uncertain classification for both uncertain/different.
    const acceptedStore = new AcceptedWideningDecisionStore(projectRoot, { version: 1, repository: feature.repository, feature: feature.feature });
    const acceptedAppend = await acceptedStore.append({
      criterion: 'NC.1', authority: 'accept', rationale: 'Accepted between audit laps.', operator: 'fixture-operator',
      originalSource: { id: sourceId, snapshot: evidence }, originalCaseId: 'case-1', offerEntryId: 'case-1',
    });
    if (!acceptedAppend.ok) throw new Error(`fixture decision write failed: ${acceptedAppend.reason}`);
    expect((await prdAuditBlockingFindings(projectRoot, wideningVerdict)).labels).toEqual([]);

    // These fixture assertions keep the post-route renderer's six inputs in
    // one executable contract; the implementation owns their final wording.
    await publishRelation('uncertain');
    const uncertain = await score();
    expect(uncertain).toContain('[uncertain-relation]');

    await publishRelation('different');
    const different = await score();
    expect(different).toContain('[uncertain-relation]');

    // (d) Corrupt authority stays an unsatisfied named verdict.
    await writeFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), '{broken json');
    const corrupt = await score();
    expect(corrupt).toContain('[corrupt-decision-store]');

    // (e) A non-scope gap retains the ordinary renderer and never inherits a
    // widening classification.
    const fixable = await score(verdict({
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 2 }, criterionId: 'S1.2', grade: 'FIXABLE',
        evidence: 'Repair the implementation', rationale: 'Fixture repair.',
        requirementAssociations: [], evidenceTaskIds: ['1'], ownerTaskId: '1',
      }],
    }));
    expect(fixable).toContain('close the gap (BUILD) or amend the PRD (DECIDE)');
    expect(fixable).not.toMatch(/\[(awaiting-decision|uncertain-relation|corrupt-decision-store)\]/);
  });
});
