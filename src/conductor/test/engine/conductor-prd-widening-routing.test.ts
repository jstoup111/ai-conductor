// Covers: task:21

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

import { Conductor, routePrdAuditOverScopeV2, type StepRunner } from '../../src/engine/conductor.js';
import { AcceptedWideningDecisionStore, renderOverScopeDecisionBlock } from '../../src/engine/accepted-widenings.js';
import { capturePrdWideningDecisions } from '../../src/engine/prd-widening-capture.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as coordinatorModule from '../../src/engine/prd-widening-coordinator.js';

const report = (evidence: string, criterion = 'NC.1') => [
  '**PRD:** none',
  '',
  '## Verdict Table',
  '| Criterion | Grade | Plan task | PRD: | Intent relation | Evidence |',
  '| --- | --- | --- | --- | --- | --- |',
  '| S1.1 | PASS | — | none | within | Covered behavior |',
  '',
  '## Findings without an owning criterion',
  '| Finding | Grade | Intent relation | Evidence |',
  '| --- | --- | --- | --- |',
  `| ${criterion} | OVER_SCOPE | outside-visible | ${evidence} |`,
].join('\n');

const sourceId = (evidence: string, criterion = 'NC.1') => prdWideningSourceId({ criterion, grade: 'OVER_SCOPE', evidence, prdIds: [] });
const caseRecord = {
  id: 'case-1', domain: 'prd_widening' as const, offeredCriterion: 'NC.1',
  originalSources: [{ sourceId: sourceId('Original wording.'), snapshot: 'Original wording.' }],
  currentSources: [{ sourceId: sourceId('Replacement wording.'), snapshot: 'Replacement wording.', recordedAt: '2026-09-09T00:00:00.000Z' }],
  relationships: [{ currentSourceId: sourceId('Replacement wording.'), kind: 'same-case' as const, caseId: 'case-1', reason: 'Same behavior.' }],
  reconciliationDigest: 'published-batch',
};

describe('v2 PRD widening routing', () => {
  it('uses a fresh relation and decision identity rather than reviewer wording', () => {
    const accepted = routePrdAuditOverScopeV2(report('Replacement wording.'), [{
      id: 'decision-1', criterion: 'NC.1', authority: 'accept', rationale: 'Approved.', operator: 'operator', revision: 1,
      originalSource: { id: sourceId('Original wording.'), snapshot: 'Original wording.' }, originalCaseId: 'case-1', offerEntryId: 'case-1',
    }], [caseRecord]);
    expect(accepted).toMatchObject({ kind: 'record', findings: [{ criterion: 'NC.1', decision: 'accept' }] });

    const refused = routePrdAuditOverScopeV2(report('Replacement wording.'), [{
      id: 'decision-2', criterion: 'NC.1', authority: 'refuse', rationale: 'Not approved.', operator: 'operator', revision: 1,
      originalSource: { id: sourceId('Original wording.'), snapshot: 'Original wording.' }, originalCaseId: 'case-1', offerEntryId: 'case-1',
    }], [caseRecord]);
    expect(refused).toMatchObject({ kind: 'halt', refused: [{ criterion: 'NC.1', decision: 'refuse' }] });
  });

  it('uses the shared freshness projection and retains the original offer for a renumbered refusal', () => {
    const renumbered = { ...caseRecord, currentSources: [{
      sourceId: sourceId('Replacement wording.', 'NC.2'), snapshot: 'Replacement wording.', recordedAt: '2026-09-09T00:00:00.000Z',
    }], relationships: [{
      currentSourceId: sourceId('Replacement wording.', 'NC.2'), kind: 'same-case' as const, caseId: 'case-1', reason: 'Same behavior after renumbering.',
    }] };
    const refusal = {
      id: 'decision-refuse', criterion: 'NC.1', authority: 'refuse' as const, rationale: 'Not approved.', operator: 'operator', revision: 1,
      originalSource: { id: sourceId('Original wording.'), snapshot: 'Original wording.' }, originalCaseId: 'case-1', offerEntryId: 'case-1',
    };
    expect(routePrdAuditOverScopeV2(report('Replacement wording.', 'NC.2'), [refusal], [renumbered]))
      .toMatchObject({
        kind: 'halt',
        refused: [{
          criterion: 'NC.1', kind: 'revise-decision', offerEntryId: 'case-1',
          originalSource: refusal.originalSource, priorDecision: { id: 'decision-refuse', revision: 1 },
        }],
      });

    // A relation without the coordinator's frozen-input digest is stale for
    // routing too; it cannot be promoted merely because its source text fits.
    expect(routePrdAuditOverScopeV2(report('Replacement wording.'), [{ ...refusal, authority: 'accept' }], [{
      ...caseRecord,
      reconciliationDigest: undefined,
    }])).toMatchObject({ kind: 'halt', undecided: [{ criterion: 'NC.1' }] });
  });

  it('withholds an editable block when a stored case lacks its immutable offer', () => {
    const route = routePrdAuditOverScopeV2(report('Replacement wording.'), [], [{ ...caseRecord, offeredCriterion: undefined }]);
    expect(route).toMatchObject({ kind: 'halt', detail: expect.stringContaining('projection-failed'),
      undecided: [], refused: [], defects: [{ kind: 'projection-failed', criterion: 'NC.1' }],
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

  it.each(['same-case', 'different'] as const)('captures the rendered %s offer after reconciliation', async (kind) => {
    const feature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'prd-widening-routing' };
    const caseStore = new RemediationCaseStore(projectRoot, feature);
    const original = await caseStore.read();
    if (!original.ok || original.state.version !== 'v2') throw new Error('missing fixture');
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
      routeCurrentPrdAuditOverScope(featureDesc: string, state: ConductState): Promise<ReturnType<typeof routePrdAuditOverScopeV2>>;
    };
    await expect(entry.preparePrdWideningBeforeAudit()).resolves.toBeUndefined();
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('Reworded current behavior.', 'NC.2'));
    const route = await entry.routeCurrentPrdAuditOverScope(feature.feature, { feature_desc: feature.feature } as ConductState);
    if (route.kind !== 'halt') throw new Error('expected an operator offer');
    expect(route.findings).toEqual(expect.arrayContaining([expect.objectContaining({ criterion: 'NC.2' })]));
    const rendered = renderOverScopeDecisionBlock([...route.undecided, ...route.refused]);
    const cleared = rendered.replaceAll('"decision": "pending"', '"decision": "accept", "rationale": "Explicit operator reversal."');
    const result = await capturePrdWideningDecisions(cleared, {
      operator: 'operator', offerStore: caseStore,
      decisionStore: new AcceptedWideningDecisionStore(projectRoot, { ...feature, version: 1 }),
    });
    expect(result.defects).toEqual([]);
    expect(result.captured).toEqual([expect.objectContaining({ authority: 'accept' })]);
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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('x'.repeat(8001)));
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
    if (!stored.ok || stored.state.version !== 'v2') throw new Error('expected v2 fixture store');
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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('Replacement wording for the same behavior.'));

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
    if (!stored.ok || stored.state.version !== 'v2') throw new Error('expected v2 fixture store');
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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('The original user-visible widening.', 'NC.2'));

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
    if (!stored.ok || stored.state.version !== 'v2') throw new Error('expected v2 fixture store');
    const originalCaseId = stored.state.prdWideningCases[0]!.id;
    const state = { session_started_at: Date.now(), feature_desc: 'prd-widening-routing' } as ConductState;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step !== 'remediate') return { success: true };
        await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('A changed source arrived while reconciliation ran.'));
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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('Replacement wording needs reconciliation.'));

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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('Replacement wording needs reconciliation.'));

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
    await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), report('Replacement wording needs reconciliation.'));

    await expect(entry.routeCurrentPrdAuditOverScope('prd-widening-routing', state)).resolves.toMatchObject({
      kind: 'halt', detail: expect.stringContaining('attempts-exhausted'),
    });
    expect(coordinate).toHaveBeenCalledWith(expect.objectContaining({
      mechanicalFailure: expect.objectContaining({ remainingAttempts: expectedAttempts }),
    }));
    expect(runner.run).toHaveBeenCalledTimes(expectedAttempts);
    coordinate.mockRestore();
  });
});
