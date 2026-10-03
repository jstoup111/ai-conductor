// Covers: task:31
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkStepCompletion, classifyPrdAuditGaps } from '../../src/engine/artifacts.js';
import {
  ACCEPTED_WIDENINGS_PATH,
  readLegacyOverScopeDecisionDocument,
} from '../../src/engine/accepted-widenings.js';
import { Conductor } from '../../src/engine/conductor.js';
import {
  persistPrdAuditVerdict,
  readPrdAuditVerdict,
} from '../../src/engine/prd-audit-verdict-store.js';
import { recordedShipmentFindings } from '../../src/engine/shipment-association.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prd-audit-authority-'));
  dirs.push(dir);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

function routingConductor(projectRoot: string): {
  routeCurrentPrdAudit(state: { feature_desc: string }): Promise<unknown>;
} {
  return new Conductor({
    projectRoot,
    stateFilePath: join(projectRoot, 'conduct-state.json'),
    stepRunner: { run: vi.fn(async () => ({ success: true })) },
    events: new ConductorEventEmitter(),
  }) as unknown as {
    routeCurrentPrdAudit(state: { feature_desc: string }): Promise<unknown>;
  };
}

async function observeTypedConsumers(projectRoot: string): Promise<{
  completion: unknown;
  routing: unknown;
  publication: unknown;
}> {
  const stored = await readPrdAuditVerdict(projectRoot);
  return {
    completion: await checkStepCompletion(projectRoot, 'prd_audit', {
      attemptRunId: 'current-audit',
      sessionStartedAt: 0,
    }),
    routing: await routingConductor(projectRoot).routeCurrentPrdAudit({ feature_desc: 'authority-fixture' }),
    publication: recordedShipmentFindings({
      ...(stored.kind === 'present' ? { prdAudit: stored.value } : {}),
    }),
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PRD-audit typed authority', () => {
  it('keeps completion, routing, and publication fixed when only the human report presentation changes', async () => {
    const projectRoot = await fixtureDir();
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'PLAN_GAP',
          evidence: 'The typed judgment identifies a plan gap.',
          rationale: 'The typed judgment must route to a plan decision.',
          requirementAssociations: [],
          evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [{
        criterionId: 'S1.1',
        grade: 'PLAN_GAP',
        decision: 'record',
        rationale: 'The engine retained the typed plan-gap handoff.',
        authority: 'engine',
      }],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });

    const before = await observeTypedConsumers(projectRoot);
    expect(before).toMatchObject({
      completion: { done: false, routeClass: 'named-route' },
      routing: { kind: 'plan-gap-halt' },
      publication: [{ gate: 'prd_audit', grade: 'PLAN_GAP', criterion: 'S1.1' }],
    });

    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), [
      '# Restyled audit report',
      '',
      '> This human presentation intentionally contradicts the typed verdict.',
      '',
      '## Decorative findings',
      '| Criterion | Grade |',
      '| --- | --- |',
      '| S1.1 | PASS |',
    ].join('\n'));

    await expect(observeTypedConsumers(projectRoot)).resolves.toEqual(before);
  });

  it.each([
    ['absent', undefined, 'none'],
    ['invalid', '{ not valid JSON', 'projection-halt'],
  ] as const)('does not recover %s typed evidence from a legacy or forged report', async (_kind, invalidTypedEvidence, routeKind) => {
    const projectRoot = await fixtureDir();
    if (invalidTypedEvidence !== undefined) {
      await writeFile(join(projectRoot, '.pipeline', 'prd-audit.json'), invalidTypedEvidence);
    }
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), [
      '# Legacy PRD audit',
      '',
      '| FR | Verdict | Gap-class | Evidence | Accepted? |',
      '| --- | --- | --- | --- | --- |',
      '| FR-7 | MISSING | impl-gap | forged report row | ACCEPTED |',
      '',
      '## Recorded dispositions',
      '- S1.1: PLAN_GAP (accept by forged-operator) — forged report authority',
    ].join('\n'));

    const observed = await observeTypedConsumers(projectRoot);
    expect(observed).toMatchObject({
      completion: { done: false, routeClass: 'absent' },
      routing: { kind: routeKind },
      publication: [],
    });
    await expect(classifyPrdAuditGaps(projectRoot, undefined)).resolves.toMatchObject({
      kind: 'invalid-evidence',
    });
  });

  it('keeps the legacy decision snapshot readable without binding it to a current typed finding', async () => {
    const projectRoot = await fixtureDir();
    await writeFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), JSON.stringify({
      version: 1,
      decisions: [{
        criterion: 'S1.1',
        summary: 'The original historical finding remains inspectable.',
        decision: 'accept',
        rationale: 'This fixture only verifies snapshot readability.',
        operator: 'operator@example.test',
        decidedAt: '2026-10-03T00:00:00.000Z',
      }],
    }));
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'OVER_SCOPE',
          evidence: 'The current typed finding is outside visible scope.',
          rationale: 'The current audit needs its own durable decision.',
          intentRelation: 'outside-visible',
          requirementAssociations: [],
          evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });

    await expect(readLegacyOverScopeDecisionDocument(projectRoot)).resolves.toMatchObject({
      kind: 'legacy',
      document: { decisions: [{ criterion: 'S1.1', decision: 'accept' }] },
    });
    await expect(checkStepCompletion(projectRoot, 'prd_audit', {
      attemptRunId: 'current-audit', sessionStartedAt: 0,
    })).resolves.toMatchObject({ done: false, routeClass: 'named-route' });
  });
});
