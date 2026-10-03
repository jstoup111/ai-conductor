import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import {
  PRD_AUDIT_VERDICT_PATH,
  persistPrdAuditVerdict,
  readPrdAuditVerdict,
} from '../../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../../src/engine/prd-audit-contract.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';

const dirs: string[] = [];

const cleanJudgment: PrdAuditJudgment = {
  version: 'v1',
  criterionJudgments: [{
    criterion: { storyId: '1', ordinal: 1 },
    criterionId: 'S1.1',
    grade: 'PASS',
    evidence: 'The completed behavior is covered by the implementation.',
    rationale: 'The active criterion has no remaining gap.',
    requirementAssociations: [],
    evidenceTaskIds: [],
  }],
  noOwnerObservations: [],
};

// These typed-completion fixtures isolate judgment semantics from the
// code-validity integration, which is exercised with real Git in the
// preservation fixtures below.
const validityDisabled = { gate_code_validity: { enabled: false } };

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prd-audit-completion-'));
  dirs.push(dir);
  return dir;
}

const WIDENING_FEATURE = {
  version: 'v1' as const,
  repository: '/fixture/repository',
  feature: 'prd-audit-completion',
};

const visibleScopeObservation = {
  presentationOrdinal: 'NC-1',
  grade: 'OVER_SCOPE' as const,
  evidence: 'The completed feature now exposes a separately visible behavior.',
  rationale: 'The behavior is outside the approved feature intent.',
  intentRelation: 'outside-visible' as const,
};

async function persistCompleteJudgment(
  dir: string,
  judgment: PrdAuditJudgment,
): Promise<void> {
  await persistPrdAuditVerdict(dir, {
    complete: true,
    judgment,
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });
}

async function persistVisibleWideningEvidence(
  dir: string,
  authority?: 'accept' | 'refuse',
): Promise<void> {
  const sourceId = prdWideningSourceId({
    criterion: visibleScopeObservation.presentationOrdinal,
    grade: visibleScopeObservation.grade,
    evidence: visibleScopeObservation.evidence,
    prdIds: [],
  });
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, '.pipeline', 'remediation-cases.json'), JSON.stringify({
    version: 'v2',
    feature: WIDENING_FEATURE,
    cases: [],
    prdWideningCases: [{
      id: 'scope-case-1',
      domain: 'prd_widening',
      offeredCriterion: visibleScopeObservation.presentationOrdinal,
      originalSources: [{ sourceId: 'original-scope-source', snapshot: 'The original visible scope offer.' }],
      currentSources: [{ sourceId, snapshot: visibleScopeObservation.evidence, recordedAt: '2026-10-02T00:00:00.000Z' }],
      relationships: [{ currentSourceId: sourceId, kind: 'same-case', caseId: 'scope-case-1', reason: 'The current observation is the accepted original behavior.' }],
      reconciliationDigest: 'published-scope-relation',
    }],
    suppressions: [],
  }), 'utf8');
  if (authority === undefined) return;

  const appended = await new AcceptedWideningDecisionStore(dir, {
    version: 1,
    repository: WIDENING_FEATURE.repository,
    feature: WIDENING_FEATURE.feature,
  }, { newDecisionId: () => `scope-${authority}` }).append({
    criterion: visibleScopeObservation.presentationOrdinal,
    authority,
    rationale: `The operator ${authority === 'accept' ? 'accepted' : 'refused'} this visible scope change.`,
    operator: 'operator@example.test',
    originalSource: { id: 'original-scope-source', snapshot: 'The original visible scope offer.' },
    originalCaseId: 'scope-case-1',
    offerEntryId: 'scope-offer-1',
  });
  if (!appended.ok) throw new Error(`fixture decision did not persist: ${appended.reason}`);
}

describe('typed PRD-audit completion', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('accepts complete clean criterion evidence when a later source PRD is unreadable', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: cleanJudgment,
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });
    await mkdir(join(dir, '.docs', 'specs', 'current-feature.md'), { recursive: true });

    const completion = await checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0, config: validityDisabled,
    });

    expect(completion.done).toBe(true);
    expect(completion.routeClass).toBeUndefined();
  });

  it('rejects a matching-attempt null-stamp verdict without rewriting it', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: cleanJudgment,
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: null });
    const path = join(dir, PRD_AUDIT_VERDICT_PATH);
    const before = await readFile(path, 'utf8');

    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'absent',
      reason: expect.stringContaining('not-current output'),
    });
    await expect(readFile(path, 'utf8')).resolves.toBe(before);
  });

  it('does not reuse a matching-attempt cached PASS after HEAD moves on a PRD gate surface', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: cleanJudgment,
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });

    const movedHeadGit = async (args: readonly string[]) => {
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'diff') {
        return { exitCode: 0, stdout: '.docs/specs/current-feature.md\n', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: `unexpected git call: ${args.join(' ')}` };
    };
    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0,
      config: { gate_code_validity: { enabled: true } },
      git: movedHeadGit,
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'absent',
      verdictFreshness: { outcome: 'stale_invalidated' },
    });
  });

  it('settles an accepted outside-visible finding from the same durable projection used by routing', async () => {
    const dir = await fixtureDir();
    await persistCompleteJudgment(dir, {
      version: 'v1', criterionJudgments: [], noOwnerObservations: [visibleScopeObservation],
    });
    await persistVisibleWideningEvidence(dir, 'accept');

    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
    })).resolves.toMatchObject({ done: true });
  });

  it('does not let a criterion-keyed acceptance settle a no-owner observation', async () => {
    const dir = await fixtureDir();
    await persistCompleteJudgment(dir, {
      version: 'v1', criterionJudgments: [], noOwnerObservations: [visibleScopeObservation],
    });
    await persistVisibleWideningEvidence(dir);
    const appended = await new AcceptedWideningDecisionStore(dir, {
      version: 1,
      repository: WIDENING_FEATURE.repository,
      feature: WIDENING_FEATURE.feature,
    }, { newDecisionId: () => 'criterion-accept' }).append({
      criterion: 'S1.1',
      authority: 'accept',
      rationale: 'The operator accepted the criterion-owned finding.',
      operator: 'operator@example.test',
    });
    if (!appended.ok) throw new Error(`fixture decision did not persist: ${appended.reason}`);

    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('NC-1 (OVER_SCOPE)'),
    });
  });

  it.each([
    ['pending', undefined],
    ['refused', 'refuse'],
  ] as const)('keeps a %s outside-visible finding blocking', async (_label, authority) => {
    const dir = await fixtureDir();
    await persistCompleteJudgment(dir, {
      version: 'v1', criterionJudgments: [], noOwnerObservations: [visibleScopeObservation],
    });
    await persistVisibleWideningEvidence(dir, authority);

    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('NC-1 (OVER_SCOPE)'),
    });
  });

  it.each(['within', 'outside-harmless'] as const)(
    'records a %s OVER_SCOPE finding without granting approval authority',
    async (intentRelation) => {
      const dir = await fixtureDir();
      await persistCompleteJudgment(dir, {
        version: 'v1', criterionJudgments: [], noOwnerObservations: [{
          ...visibleScopeObservation,
          intentRelation,
        }],
      });

      await expect(checkStepCompletion(dir, 'prd_audit', {
        attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
      })).resolves.toMatchObject({ done: true });
    },
  );

  it('does not let an accepted scope finding settle another blocking grade', async () => {
    const dir = await fixtureDir();
    await persistCompleteJudgment(dir, {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 },
        criterionId: 'S1.1',
        grade: 'FIXABLE',
        evidence: 'The implementation still misses the required error behavior.',
        rationale: 'A task-owned repair remains necessary.',
        requirementAssociations: [],
        evidenceTaskIds: [],
        ownerTaskId: '1',
      }],
      noOwnerObservations: [visibleScopeObservation],
    });
    await persistVisibleWideningEvidence(dir, 'accept');

    await expect(checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0, config: validityDisabled,
    })).resolves.toMatchObject({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('S1.1 (FIXABLE)'),
    });
  });

  it('keeps incomplete diagnostics and findings blocking despite scope and negative-gap dispositions', async () => {
    const dir = await fixtureDir();
    const partialJudgment: PrdAuditJudgment = {
      version: 'v1',
      criterionJudgments: [
        {
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'OVER_SCOPE',
          evidence: 'A visible behavior is outside the current intent.',
          rationale: 'The scope finding remains available for a later decision.',
          requirementAssociations: [],
          evidenceTaskIds: [],
          intentRelation: 'outside-visible',
        },
        {
          criterion: { storyId: '1', ordinal: 2 },
          criterionId: 'S1.2',
          grade: 'PLAN_GAP',
          evidence: 'No current task owns this negative-path behavior.',
          rationale: 'The potential recordable gap remains a reviewer finding.',
          requirementAssociations: [],
          evidenceTaskIds: [],
        },
      ],
      noOwnerObservations: [],
    };
    const diagnostics = [
      'criterionJudgments[2].criterion does not resolve active criterion S1.3',
      'criterionJudgments[3].intentRelation is required for OVER_SCOPE',
    ];
    await persistPrdAuditVerdict(dir, {
      complete: false,
      judgment: partialJudgment,
      diagnostics,
      recordedDispositions: [
        {
          criterionId: 'S1.1',
          grade: 'OVER_SCOPE',
          decision: 'accept',
          rationale: 'This is only a fixture for a later scope decision.',
          authority: 'operator',
        },
        {
          criterionId: 'S1.2',
          grade: 'PLAN_GAP',
          decision: 'record',
          rationale: 'This is only a fixture for negative-path recording.',
          authority: 'engine',
        },
      ],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });
    const verdictPath = join(dir, PRD_AUDIT_VERDICT_PATH);
    const before = await readFile(verdictPath, 'utf8');

    const completion = await checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0,
      config: validityDisabled,
    });

    expect(completion).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'structured-result-rejected',
    });
    expect(completion.reason).toContain(diagnostics[0]);
    expect(completion.reason).toContain(diagnostics[1]);
    expect(completion.reason).not.toMatch(/accept|record/i);
    expect(await readFile(verdictPath, 'utf8')).toBe(before);
    await expect(readPrdAuditVerdict(dir)).resolves.toEqual({
      kind: 'present',
      value: {
        attemptId: 'current-audit',
        codeStamp: 'reviewed-head',
        complete: false,
        judgment: partialJudgment,
        diagnostics,
        recordedDispositions: expect.any(Array),
      },
    });
  });
});
