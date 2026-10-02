// Covers: task:11
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  it('round trips complete and incomplete judgments with engine metadata and a derived report', async () => {
    for (const { complete, diagnostics, evidence, recordedDispositions } of [
      { complete: true, diagnostics: [], evidence: 'Complete judgment evidence.', recordedDispositions: [] },
      {
        complete: false,
        diagnostics: ['criterion Sbeta.1 is missing a judgment'],
        evidence: 'Incomplete judgment evidence.',
        recordedDispositions: [{ criterionId: 'Sbeta.1', grade: 'PLAN_GAP' as const }],
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
});
