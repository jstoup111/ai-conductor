// Covers: task:21 — invalidated evidence cannot drive a PLAN_GAP decision.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict, readPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('typed PRD-audit PLAN_GAP routing', () => {
  it('refuses a matching-attempt invalidated PLAN_GAP without a plan-decision halt or record-and-ship', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-plan-gap-typed-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PLAN_GAP',
          evidence: 'Unowned product behavior.', rationale: 'Fixture.', requirementAssociations: [], evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
      config: { gate_code_validity: { enabled: true } },
      git: async (args) => args[0] === 'merge-base'
        ? { exitCode: 0, stdout: '', stderr: '' }
        : { exitCode: 0, stdout: '.docs/specs/feature.md\n', stderr: '' },
    }) as unknown as {
      currentRunId?: string;
      routeCurrentPrdAudit(state: { feature_desc: string }): Promise<{ kind: string; reason?: string }>;
    };
    conductor.currentRunId = 'current-audit';

    await expect(conductor.routeCurrentPrdAudit({ feature_desc: 'feature' })).resolves.toMatchObject({
      kind: 'projection-halt', reason: expect.stringContaining('code stamp is no longer preservable'),
    });
    await expect(readPrdAuditVerdict(root)).resolves.toMatchObject({
      kind: 'present', value: { recordedDispositions: [] },
    });
  });
});
