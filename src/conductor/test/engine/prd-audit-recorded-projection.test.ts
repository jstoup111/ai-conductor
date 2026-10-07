// Covers: task:23
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const forceProjectionFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'recorded-projection',
  })),
}));

vi.mock('../../src/engine/prd-audit-verdict-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/prd-audit-verdict-store.js')>();
  return {
    ...actual,
    persistPrdAuditVerdict: vi.fn(async (...args: Parameters<typeof actual.persistPrdAuditVerdict>) => {
      if (forceProjectionFailure.enabled) throw new Error('injected projection write failure');
      return actual.persistPrdAuditVerdict(...args);
    }),
  };
});

import { AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict, readPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { recordedShipmentFindings } from '../../src/engine/shipment-association.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('PRD-audit recorded disposition projection', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'prd-audit-recorded-projection-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'OVER_SCOPE',
          evidence: 'src/unplanned.ts:1',
          rationale: 'The reviewer found user-visible work beyond the approved plan.',
          requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'outside-visible',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'typed-audit', codeStamp: null });
  });

  afterEach(async () => {
    forceProjectionFailure.enabled = false;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('replaces a prior recorded acceptance with the later refusal in the typed verdict and shipment handoff', async () => {
    const decisions = new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'recorded-projection',
    });
    const first = await decisions.append({
      criterion: 'S1.1', authority: 'accept', rationale: 'The initial operator accepted this widening.', operator: 'first@example.test',
    });
    if (!first.ok) throw new Error(`initial decision failed: ${first.reason}`);

    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
    });
    const route = conductor as unknown as {
      routeCurrentPrdAuditOverScope(): Promise<unknown>;
    };
    await expect(route.routeCurrentPrdAuditOverScope()).resolves.toMatchObject({
      kind: 'record', findings: [{ criterion: 'S1.1', decision: 'accept' }],
    });

    const reversal = await decisions.append({
      criterion: 'S1.1', authority: 'refuse', rationale: 'The later operator revoked the widening approval.', operator: 'second@example.test',
    });
    if (!reversal.ok) throw new Error(`reversal decision failed: ${reversal.reason}`);
    await expect(route.routeCurrentPrdAuditOverScope()).resolves.toMatchObject({
      kind: 'refusal-rework', findings: [{ criterion: 'S1.1', decision: 'refuse' }],
    });

    const stored = await readPrdAuditVerdict(projectRoot);
    if (stored.kind !== 'present') throw new Error('expected typed PRD-audit verdict');
    expect(stored.value).toMatchObject({
      judgment: {
        criterionJudgments: [{
          criterionId: 'S1.1', grade: 'OVER_SCOPE',
          rationale: 'The reviewer found user-visible work beyond the approved plan.',
        }],
      },
      recordedDispositions: [{
        criterionId: 'S1.1', grade: 'OVER_SCOPE', decision: 'refuse',
        rationale: 'The later operator revoked the widening approval.', authority: 'second@example.test',
      }],
    });
    expect(recordedShipmentFindings({ prdAudit: stored.value })).toEqual([{
      gate: 'prd_audit', grade: 'OVER_SCOPE', criterion: 'S1.1',
      summary: 'The reviewer found user-visible work beyond the approved plan.',
      accepted: false, decision: 'refuse',
      rationale: 'The later operator revoked the widening approval.', authority: 'second@example.test',
    }]);
  });

  it('keeps a failed replacement projection routing-blocking without losing the durable reversal', async () => {
    const decisions = new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'recorded-projection',
    });
    const first = await decisions.append({
      criterion: 'S1.1', authority: 'accept', rationale: 'The initial operator accepted this widening.', operator: 'first@example.test',
    });
    if (!first.ok) throw new Error(`initial decision failed: ${first.reason}`);
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      events: new ConductorEventEmitter(),
    });
    const route = conductor as unknown as {
      routeCurrentPrdAuditOverScope(): Promise<unknown>;
    };
    await route.routeCurrentPrdAuditOverScope();

    const reversal = await decisions.append({
      criterion: 'S1.1', authority: 'refuse', rationale: 'The later operator revoked the widening approval.', operator: 'second@example.test',
    });
    if (!reversal.ok) throw new Error(`reversal decision failed: ${reversal.reason}`);
    forceProjectionFailure.enabled = true;
    try {
      await expect(route.routeCurrentPrdAuditOverScope()).resolves.toMatchObject({
        kind: 'halt',
        findings: [{ criterion: 'S1.1', decision: 'refuse' }],
        defects: [{ kind: 'unrenderable-decision' }],
        detail: expect.stringContaining('projection-failed'),
      });
    } finally {
      forceProjectionFailure.enabled = false;
    }

    await expect(readPrdAuditVerdict(projectRoot)).resolves.toMatchObject({
      kind: 'present',
      value: {
        judgment: { criterionJudgments: [{ criterionId: 'S1.1', grade: 'OVER_SCOPE' }] },
        recordedDispositions: [{ decision: 'accept', authority: 'first@example.test' }],
      },
    });
    await expect(decisions.read()).resolves.toMatchObject({
      kind: 'valid', state: { decisions: [
        { authority: 'accept', operator: 'first@example.test' },
        { authority: 'refuse', operator: 'second@example.test' },
      ] },
    });
  });
});
