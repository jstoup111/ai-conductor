// Covers: task:11
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PRD_AUDIT_REPORT_PATH,
  PRD_AUDIT_VERDICT_PATH,
  persistPrdAuditVerdict,
  readPrdAuditVerdict,
} from '../../src/engine/prd-audit-verdict-store.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PRD audit typed verdict store', () => {
  const validEvidence = {
    complete: true,
    judgment: {
      version: 'v1' as const,
      criterionJudgments: [{
        criterion: { storyId: 'alpha', ordinal: 1 }, criterionId: 'Salpha.1', grade: 'PASS' as const,
        evidence: 'Evidence.', rationale: 'Rationale.', requirementAssociations: [], evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  };
  it('round trips complete and incomplete judgments with engine metadata and a derived report', async () => {
    for (const { complete, diagnostics, evidence, recordedDispositions } of [
      { complete: true, diagnostics: [], evidence: 'Complete judgment evidence.', recordedDispositions: [] },
      {
        complete: false,
        diagnostics: ['criterion Sbeta.1 is missing a judgment'],
        evidence: 'Incomplete judgment evidence.',
        recordedDispositions: [{
          criterionId: 'Sbeta.1', grade: 'PLAN_GAP' as const, decision: 'record' as const,
          rationale: 'The engine records a negative-path plan gap.', authority: 'engine',
        }],
      },
    ]) {
      const dir = await mkdtemp(join(tmpdir(), 'prd-audit-store-'));
      dirs.push(dir);
      const judgment = {
        version: 'v1' as const,
        criterionJudgments: [{
          criterion: { storyId: 'alpha', ordinal: 1 },
          criterionId: 'Salpha.1',
          grade: 'PASS' as const,
          evidence,
          rationale: 'The validated evidence supports the judgment.',
          requirementAssociations: [],
          evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      };

      await persistPrdAuditVerdict(dir, {
        complete,
        judgment,
        diagnostics,
        recordedDispositions,
      }, { attemptId: `attempt-${complete ? 'complete' : 'incomplete'}`, codeStamp: 'abc123' });

      const persisted = JSON.parse(await readFile(join(dir, PRD_AUDIT_VERDICT_PATH), 'utf8'));
      expect(persisted.judgment).toEqual(judgment);
      expect(persisted.recordedDispositions).toEqual(recordedDispositions);
      expect(persisted).not.toHaveProperty('operator');
      expect(persisted).not.toHaveProperty('authority');
      expect(await readPrdAuditVerdict(dir)).toMatchObject({
        kind: 'present',
        value: {
          complete,
          judgment,
          diagnostics,
          attemptId: `attempt-${complete ? 'complete' : 'incomplete'}`,
          codeStamp: 'abc123',
          recordedDispositions,
        },
      });
      const report = await readFile(join(dir, PRD_AUDIT_REPORT_PATH), 'utf8');
      expect(report).toContain(evidence);
      expect(report.toLowerCase()).toContain(complete ? 'complete' : 'incomplete');
      if (!complete) {
        expect(report).toContain(diagnostics[0]);
        expect(report).toContain('## Recorded dispositions');
        expect(report).toContain('Sbeta.1');
        expect(report).toContain('PLAN_GAP');
      }
    }
  });

  it('surfaces write and rendering failures without treating an old report as authority', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prd-audit-store-failure-'));
    dirs.push(dir);
    await expect(persistPrdAuditVerdict(dir, validEvidence, { attemptId: 'write-fails', codeStamp: null }, {
      write: async () => { throw new Error('authority write failed'); },
    })).rejects.toThrow('authority write failed');
    expect(await readPrdAuditVerdict(dir)).toEqual({ kind: 'absent' });

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'decisions.json'), 'durable operator decision\n');
    await expect(persistPrdAuditVerdict(dir, validEvidence, { attemptId: 'render-fails', codeStamp: null }, {
      render: () => { throw new Error('report rendering failed'); },
    })).rejects.toThrow('report rendering failed');
    expect(await readPrdAuditVerdict(dir)).toMatchObject({ kind: 'present', value: { attemptId: 'render-fails' } });
    expect(await readFile(join(dir, '.pipeline', 'decisions.json'), 'utf8')).toBe('durable operator decision\n');
  });

  it('returns a named invalid-evidence fault rather than plausible report findings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prd-audit-store-invalid-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, PRD_AUDIT_REPORT_PATH), '# PRD audit\n\nStatus: complete\n- Salpha.1: PASS\n');
    await writeFile(join(dir, PRD_AUDIT_VERDICT_PATH), JSON.stringify({ attemptId: 'old', codeStamp: null, judgment: { version: 'v99' } }));
    await expect(readPrdAuditVerdict(dir)).resolves.toMatchObject({
      kind: 'unreadable', reason: expect.stringContaining('invalid evidence'),
    });
  });

  it.each([
    ['a forged criterion ordinal', 'S1.1'],
    ['a duplicate engine ordinal', 'NC-1'],
  ])('rejects %s in persisted no-owner evidence', async (_label, presentationOrdinal) => {
    const dir = await mkdtemp(join(tmpdir(), 'prd-audit-store-invalid-no-owner-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const noOwner = {
      presentationOrdinal,
      grade: 'OVER_SCOPE',
      evidence: 'Visible unowned behavior.',
      rationale: 'The behavior has no criterion owner.',
      intentRelation: 'outside-visible',
    };
    const observations = presentationOrdinal === 'NC-1' ? [noOwner, { ...noOwner }] : [noOwner];
    await writeFile(join(dir, PRD_AUDIT_VERDICT_PATH), JSON.stringify({
      ...validEvidence,
      attemptId: 'invalid-no-owner',
      codeStamp: 'reviewed-head',
      judgment: { ...validEvidence.judgment, noOwnerObservations: observations },
    }));

    await expect(readPrdAuditVerdict(dir)).resolves.toMatchObject({
      kind: 'unreadable', reason: expect.stringContaining('invalid evidence'),
    });
  });
});
