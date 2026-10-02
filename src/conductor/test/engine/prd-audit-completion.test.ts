import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import {
  PRD_AUDIT_VERDICT_PATH,
  persistPrdAuditVerdict,
  readPrdAuditVerdict,
} from '../../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../../src/engine/prd-audit-contract.js';

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

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prd-audit-completion-'));
  dirs.push(dir);
  return dir;
}

describe('typed PRD-audit completion', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('accepts complete clean criterion evidence from the persisted typed verdict', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: cleanJudgment,
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: null });

    const completion = await checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0,
    });

    expect(completion.done).toBe(true);
    expect(completion.routeClass).toBeUndefined();
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
    }, { attemptId: 'current-audit', codeStamp: null });
    const verdictPath = join(dir, PRD_AUDIT_VERDICT_PATH);
    const before = await readFile(verdictPath, 'utf8');

    const completion = await checkStepCompletion(dir, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0,
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
        codeStamp: null,
        complete: false,
        judgment: partialJudgment,
        diagnostics,
        recordedDispositions: expect.any(Array),
      },
    });
  });
});
