// Covers: task:3, task:7, task:8, task:31, task:rem-prd-audit-8, task:rem-prd-audit-8-2, task:rem-prd-audit-8-3
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import { persistBuildReviewDecisionStop } from '../../src/engine/remediation-case-effects.js';
import { RemediationCaseStore, type RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';

let projectRoot = '';
afterEach(async () => { if (projectRoot) await rm(projectRoot, { recursive: true, force: true }); projectRoot = ''; });

const action = (status: 'reserved' | 'applied' | 'failed' = 'applied'): RemediationCaseRecord => ({
  id: 'case-action', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'fix it',
  confidence: 'high', resolution: 'open', sources: [{ sourceId: 'finding-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
  effect: status === 'applied'
    ? { id: 'effect-action', kind: 'action', status, workOrderId: 'order-1' }
    : status === 'failed'
      ? { id: 'effect-action', kind: 'action', status, diagnostic: 'write failed' }
      : { id: 'effect-action', kind: 'action', status },
});

const reject = (): RemediationCaseRecord => ({
  id: 'case-reject', domain: 'build_review', disposition: 'reject', priority: 'low', rationale: 'not actionable',
  confidence: 'high', resolution: 'open', sources: [{ sourceId: 'finding-1', outcome: 'rejected', recordedAt: '2026-08-30T00:00:00.000Z' }], effect: { kind: 'none' },
});

const decisionStop = (owner: 'product' | 'plan' | 'architecture' = 'plan'): RemediationCaseRecord => ({
  id: `case-${owner}-stop`, domain: 'build_review', disposition: 'escalate', priority: 'high',
  rationale: `The current approved outcome requires a ${owner} decision.`, confidence: 'high', resolution: 'open',
  sources: [{ sourceId: 'finding-1', outcome: 'escalate', recordedAt: '2026-09-11T00:00:00.000Z' }],
  effect: { kind: 'none' }, escalation: { owner },
});

const refute = (status: 'none' | 'reserved' | 'failed' = 'none'): RemediationCaseRecord => ({
  id: 'case-refute', domain: 'build_review', disposition: 'refute', priority: 'low', rationale: 'claim is refuted',
  confidence: 'high', resolution: 'resolved', sources: [{ sourceId: 'finding-1', outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }],
  effect: status === 'none'
    ? { kind: 'none' }
    : status === 'failed'
      ? { id: 'effect-refute', kind: 'deferral', status, diagnostic: 'intake failed' }
      : { id: 'effect-refute', kind: 'deferral', status },
  refutation: { claim: 'the finding is wrong', assertions: [{ assertion: 'the required behavior exists', verdict: 'refuted', evidence: [{ path: 'src/engine/build-review-adjudication.ts', excerpt: 'reduceBuildReviewAdjudication' }] }] },
});

const reducerInput = (overrides: Partial<Parameters<typeof reduceBuildReviewAdjudication>[0]> = {}) => ({
  currentSourceIds: ['finding-1'],
  feature: 'adjudication-test',
  child: undefined,
  cases: [reject()],
  mechanical: 'healthy' as const,
  ...overrides,
});

function implementationQualityAggregate() {
  return joinBuildReviewRubricOutcomes({
    lapId: 'lap-implementation-quality-adjudication' as never,
    snapshotDigest: 'snapshot-implementation-quality-adjudication',
    results: {
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
      security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
      implementationQuality: {
        kind: 'judged', rubric: 'implementationQuality',
        lapId: 'lap-implementation-quality-adjudication' as never,
        snapshotDigest: 'snapshot-implementation-quality-adjudication',
        contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'primitive-obsession',
          summary: 'Raw strings permit invalid domain states.',
          evidenceLocations: ['src/domain.ts:8'],
          anchor: {
            rubric: 'implementationQuality',
            locus: {
              path: 'src/domain.ts',
              contentHash: `sha256:${'a'.repeat(64)}`,
              display: 'changed domain state',
            },
          },
        }],
      },
    },
  });
}

describe('reduceBuildReviewAdjudication', () => {
  it.each([
    ['finalized non-action content', reducerInput(), 'pass'],
    ['new applied action', reducerInput({ cases: [action()] }), 'build'],
    ['pure below-cap mechanical failure', reducerInput({ currentSourceIds: [], cases: [], mechanical: 'retry' }), 'mechanical-retry'],
    ['exhausted mechanical failure', reducerInput({ currentSourceIds: [], cases: [], mechanical: 'halt' }), 'halt'],
    ['mixed action and infrastructure', reducerInput({ cases: [action()], mechanical: 'retry' }), 'build'],
    ['unfinished action effect', reducerInput({ cases: [action('reserved')] }), 'halt'],
    ['finalized refutation', reducerInput({ cases: [refute()] }), 'pass'],
  ] as const)('%s selects %s', (_label, input, route) => {
    expect(reduceBuildReviewAdjudication(input).route).toBe(route);
  });

  it('retains the infrastructure blocker on a mixed action lap', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ cases: [action()], mechanical: 'retry' })))
      .toMatchObject({ route: 'build', remainingMechanical: true, reason: 'applied action effect with retained coverage blocker' });
  });

  it('routes an acted security source to BUILD without any plan-binding condition', () => {
    const securitySourceId = 'security:sha256:injection';
    const result = reduceBuildReviewAdjudication({
      currentSourceIds: [securitySourceId],
      feature: 'adjudication-test', child: undefined,
      cases: [{ ...action(), sources: [{ sourceId: securitySourceId, outcome: 'acted', recordedAt: '2026-09-15T00:00:00.000Z' }] }],
      mechanical: 'healthy',
    });

    expect(result).toMatchObject({ route: 'build', remainingMechanical: false, reason: 'applied action effect' });
  });

  it('routes an acted implementation-quality source with an admitted work order to BUILD and preserves the source charge', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'implementation-quality-adjudication-'));
    const aggregate = implementationQualityAggregate();
    const source = projectBuildReviewAggregateSources(aggregate)?.[0];
    if (!source) throw new Error('expected implementation-quality source');
    const sourceId = buildReviewAdjudicationSourceId(source);
    const sourceCharge = {
      findingId: source.findingId,
      rubric: source.rubric,
      sourceId,
    };
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'implementation-quality-case' }],
      cases: [{
        caseRef: 'implementation-quality-case', disposition: 'act', priority: 'medium', confidence: 'high',
        rationale: 'Task 8 owns the implementation-quality repair.',
        effect: {
          kind: 'action', route: 'build', tasks: [{
            title: 'Replace the raw domain-state string with an explicit domain type.',
            admittedTaskIds: ['8'], admissionRationale: 'Task 8 owns implementation-quality remediation.',
          }],
        },
      }],
      consistency: {
        verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['implementation-quality-case'],
        rationale: 'The repair is bounded to the admitted task.',
      },
    };

    const result = await coordinateBuildReviewAdjudication({
      projectRoot,
      feature: { version: 'v1', repository: 'acme/repo', feature: 'implementation-quality' },
      aggregate, operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy', judge: async () => judgement,
      chargeInput: { treeHash: 'tree-implementation-quality', resolvedCount: 1, reason: 'implementation-quality fixture' },
      generateId: (() => {
        const ids = ['case-implementation-quality', 'effect-implementation-quality'];
        return () => ids.shift()!;
      })(),
      readPlanContract: async () => ({
        path: '.docs/plans/implementation-quality.md', pointers: [],
        admittedTaskContracts: [{ id: '8', contract: 'Route implementationQuality findings through admission, caps, and dispositions.' }],
      }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '8', status: 'in_progress' }] }),
    });

    expect(sourceCharge).toMatchObject({
      findingId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      rubric: 'implementationQuality',
      sourceId: `implementationQuality:${source.findingId}`,
    });
    expect(result).toMatchObject({ ok: true, route: 'build', durable: { repairCaseIds: ['case-implementation-quality'] } });
    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review-work-order.json'), 'utf8'))).toMatchObject({
      effectId: 'effect-implementation-quality',
      cases: [{
        caseId: 'case-implementation-quality',
        tasks: [{ admittedTaskIds: ['8'] }],
      }],
    });
    await expect(new RemediationCaseStore(projectRoot, { version: 'v1', repository: 'acme/repo', feature: 'implementation-quality' }).read())
      .resolves.toMatchObject({ ok: true, state: { cases: [{
        sources: [{ sourceId: sourceCharge.sourceId, outcome: 'acted' }],
        effect: { id: 'effect-implementation-quality', kind: 'action', status: 'applied' },
      }] } });
    await expect(readKickbackLedger(projectRoot)).resolves.toMatchObject({ gates: { build_review: {
      count: 1, cumulative: 1, chargedEffectIds: ['effect-implementation-quality'],
    } } });
  });

  it.each([
    'duplication', 'excess-complexity', 'obscured-intent', 'primitive-obsession',
    'representable-invalid-state', 'non-exhaustive-domain-match', 'non-semantic-name',
  ] as const)('never turns an unadmitted implementation-quality %s act into a plan route', (kind) => {
    const sourceId = `implementationQuality:${kind}`;
    const result = reduceBuildReviewAdjudication({
      currentSourceIds: [sourceId], feature: 'adjudication-test', child: undefined, mechanical: 'healthy',
      cases: [{ ...reject(), sources: [{ sourceId, outcome: 'rejected', recordedAt: '2026-10-10T00:00:00.000Z' }] }],
    });

    expect(result).toMatchObject({ route: 'pass' });
    expect(result).not.toHaveProperty('plan');
    expect(result).not.toHaveProperty('appendedTask');
  });

  it.each([
    'duplication', 'excess-complexity', 'obscured-intent', 'primitive-obsession',
    'representable-invalid-state', 'non-exhaustive-domain-match', 'non-semantic-name',
  ] as const)('keeps every implementation-quality %s disposition within adjudication (never a plan route)', (kind) => {
    const sourceId = `implementationQuality:${kind}`;
    const cases = [
      { label: 'act-admitted', record: { ...action(), sources: [{ sourceId, outcome: 'acted' as const, recordedAt: '2026-10-10T00:00:00.000Z' }] }, route: 'build' },
      { label: 'act-unadmitted', record: { ...reject(), sources: [{ sourceId, outcome: 'rejected' as const, recordedAt: '2026-10-10T00:00:00.000Z' }] }, route: 'pass' },
      { label: 'defer', record: { ...reject(), sources: [{ sourceId, outcome: 'deferred' as const, recordedAt: '2026-10-10T00:00:00.000Z' }] }, route: 'pass' },
      { label: 'refute', record: { ...refute(), sources: [{ sourceId, outcome: 'refuted' as const, recordedAt: '2026-10-10T00:00:00.000Z' }] }, route: 'pass' },
      { label: 'escalate', record: { ...decisionStop(), sources: [{ sourceId, outcome: 'escalate' as const, recordedAt: '2026-10-10T00:00:00.000Z' }] }, route: 'halt' },
    ] as const;

    for (const { label, record, route } of cases) {
      const result = reduceBuildReviewAdjudication({ currentSourceIds: [sourceId], feature: 'adjudication-test', child: undefined, cases: [record], mechanical: 'healthy' });
      expect(result, `${kind}/${label}`).toMatchObject({ route });
      expect(result).not.toHaveProperty('plan');
      expect(result).not.toHaveProperty('appendedTask');
    }
  });

  it.each([
    ['retry', 'mechanical-retry', 'build-review coverage retry is pending'],
    ['halt', 'halt', 'uncovered build-review coverage failure'],
  ] as const)('names a retained %s scope blocker as coverage', (mechanical, route, reason) => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: [], cases: [], mechanical })))
      .toMatchObject({ route, reason });
  });

  it('halts rather than passing when current source coverage is incomplete or duplicated', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: ['finding-1', 'finding-2'] })).route).toBe('halt');
    expect(reduceBuildReviewAdjudication(reducerInput({
      currentSourceIds: ['finding-1', 'finding-1'],
    })).route).toBe('halt');
  });

  it('reads a shared source through its open escalation rather than contradicting resolved history', () => {
    const sourceId = 'security:shared';
    const resolvedR: RemediationCaseRecord = {
      ...action(), id: 'case-resolved-r', resolution: 'resolved',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
    };
    const openEscalation: RemediationCaseRecord = {
      ...decisionStop('architecture'), id: 'case-open-escalation',
      sources: [{ sourceId, outcome: 'escalate', recordedAt: '2026-10-19T00:00:00.000Z' }],
    };

    expect(reduceBuildReviewAdjudication({ currentSourceIds: [sourceId], feature: 'adjudication-test', child: undefined, cases: [resolvedR, openEscalation], mechanical: 'healthy' }))
      .toMatchObject({ route: 'halt', reason: 'architecture decision is required for current remediation sources' });
  });

  it('routes an open action rather than its resolved shared-source history to BUILD', () => {
    const sourceId = 'security:shared';
    const resolvedR: RemediationCaseRecord = {
      ...action(), id: 'case-resolved-r', resolution: 'resolved',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
    };
    const openAction: RemediationCaseRecord = {
      ...action(), id: 'case-open-n',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-19T00:00:00.000Z' }],
    };

    expect(reduceBuildReviewAdjudication({ currentSourceIds: [sourceId], feature: 'adjudication-test', child: undefined, cases: [resolvedR, openAction], mechanical: 'healthy' }))
      .toMatchObject({ route: 'build', reason: 'applied action effect' });
  });

  it('preserves the former coverage result when sources are not shared', () => {
    const sourceIds = ['security:a', 'testQuality:b'];
    const cases: RemediationCaseRecord[] = [
      { ...reject(), sources: [{ sourceId: sourceIds[0]!, outcome: 'rejected', recordedAt: '2026-10-18T00:00:00.000Z' }] },
      { ...reject(), id: 'case-b', sources: [{ sourceId: sourceIds[1]!, outcome: 'rejected', recordedAt: '2026-10-19T00:00:00.000Z' }] },
    ];
    const formerAnyLinkCoverage = sourceIds.every((sourceId) => cases.some((record) =>
      record.sources.some((source) => source.sourceId === sourceId)));

    expect(formerAnyLinkCoverage).toBe(true);
    expect(reduceBuildReviewAdjudication({ currentSourceIds: sourceIds, feature: 'adjudication-test', child: undefined, cases, mechanical: 'healthy' }))
      .toMatchObject({ route: 'pass' });
  });

  it('keeps a current source with no link as a coverage halt', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: ['security:missing'], cases: [] })))
      .toMatchObject({ route: 'halt', reason: 'current remediation source coverage is incomplete or contradictory' });
  });

  it('routes an applied action that BUILD never attempted to BUILD even when it covers no current source', () => {
    // A lap that halted after applying its actions left their published work
    // order unbuilt; the next lap reports other findings. Halting here held
    // that work forever, and PASS would stamp the gate done around it.
    const rejectedCurrent: RemediationCaseRecord = {
      ...reject(), sources: [{ sourceId: 'finding-2', outcome: 'rejected', recordedAt: '2026-08-31T00:00:00.000Z' }],
    };
    expect(reduceBuildReviewAdjudication(reducerInput({
      currentSourceIds: ['finding-2'],
      cases: [action(), rejectedCurrent],
    }))).toMatchObject({ route: 'build', reason: 'applied action effect awaits its BUILD attempt' });
  });

  it.each(['reserved', 'failed'] as const)('halts when a refutation deferral is %s', (status) => {
    expect(reduceBuildReviewAdjudication(reducerInput({ cases: [refute(status)] })))
      .toMatchObject({ route: 'halt', reason: 'remediation effect is not finalized' });
  });

  it.each([
    { feature: 'operator-acceptance', child: undefined, scope: '' },
    { feature: 'operator-acceptance', child: 2 as never, scope: ' --child 2' },
  ])('names the failed action case and its scoped operator-resolution command', ({ feature, child, scope }) => {
    expect(reduceBuildReviewAdjudication(reducerInput({
      feature, child, cases: [action('failed')],
    }))).toMatchObject({
      route: 'halt',
      reason: expect.stringContaining(`ai-conductor build-review resolve-case --feature ${feature}${scope} --case case-action`),
    });
  });

  it.each(['product', 'plan', 'architecture'] as const)(
    'retains a current %s decision-owner stop without publishing work',
    (owner) => {
      expect(reduceBuildReviewAdjudication(reducerInput({ cases: [decisionStop(owner)] })))
        .toMatchObject({ route: 'halt', remainingMechanical: false, reason: `${owner} decision is required for current remediation sources` });
    },
  );

  it('does not let an historic decision stop prevent a changed approved baseline from being evaluated', () => {
    const historicStop = decisionStop('architecture');
    expect(reduceBuildReviewAdjudication(reducerInput({
      currentSourceIds: ['finding-2'],
      cases: [historicStop, { ...reject(), id: 'case-new-baseline', sources: [{ ...reject().sources[0], sourceId: 'finding-2' }] }],
    }))).toMatchObject({ route: 'pass' });
    expect(historicStop).toMatchObject({
      disposition: 'escalate', escalation: { owner: 'architecture' },
      sources: [{ sourceId: 'finding-1', outcome: 'escalate' }],
    });
  });

  it('persists one inspectable owner stop without a deferral, work order, charge, or sealed-artifact mutation', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-owner-stop-'));
    const sealedArtifact = join(projectRoot, 'approved-plan.md');
    await writeFile(sealedArtifact, 'approved baseline\n');
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'owner-stop' } as const;
    const stop = decisionStop('product');

    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: stop,
    })).resolves.toEqual({ ok: true, status: 'persisted', caseId: stop.id });
    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: stop,
    })).resolves.toEqual({ ok: true, status: 'already-persisted', caseId: stop.id });

    await expect(new RemediationCaseStore(projectRoot, feature).read()).resolves.toMatchObject({
      ok: true,
      state: { cases: [{
        id: stop.id, disposition: 'escalate', rationale: stop.rationale,
        escalation: { owner: 'product' }, sources: stop.sources, effect: { kind: 'none' },
      }] },
    });
    await expect(readFile(sealedArtifact, 'utf8')).resolves.toBe('approved baseline\n');
  });

  it('treats a re-raised stop on a resolved case with the same sources as settled, without halting state', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-resolved-stop-'));
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'resolved-stop' } as const;
    const resolved: RemediationCaseRecord = { ...decisionStop('architecture'), resolution: 'resolved' };
    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: { ...resolved, resolution: 'open' },
    })).resolves.toMatchObject({ ok: true, status: 'persisted' });
    await new RemediationCaseStore(projectRoot, feature).mutate(async (state) => ({
      value: undefined,
      nextState: { ...state, cases: state.cases.map((record) => ({ ...record, resolution: 'resolved' as const })) },
    }));

    const reRaised = {
      ...decisionStop('architecture'),
      rationale: 'A fresh judgement worded differently.',
      sources: decisionStop('architecture').sources.map((source) => ({ ...source, recordedAt: '2030-01-01T00:00:00.000Z' })),
    };
    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: reRaised,
    })).resolves.toEqual({ ok: true, status: 'already-resolved', caseId: resolved.id });

    const persisted = await new RemediationCaseStore(projectRoot, feature).read();
    expect(persisted).toMatchObject({ ok: true, state: { cases: [{ id: resolved.id, resolution: 'resolved' }] } });
    if (!persisted.ok) return;
    expect(persisted.state.cases).toHaveLength(1);
    expect(reduceBuildReviewAdjudication(reducerInput({ cases: persisted.state.cases })).route).not.toBe('halt');
  });

  it('persists a stop with new sources under a fresh id instead of overwriting a resolved case', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-resolved-new-source-'));
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'resolved-new-source' } as const;
    const original = decisionStop('architecture');
    await persistBuildReviewDecisionStop({ store: new RemediationCaseStore(projectRoot, feature), record: original });
    await new RemediationCaseStore(projectRoot, feature).mutate(async (state) => ({
      value: undefined,
      nextState: { ...state, cases: state.cases.map((record) => ({ ...record, resolution: 'resolved' as const })) },
    }));

    const newSource = {
      ...original,
      sources: [{ ...original.sources[0], sourceId: 'finding-new' }],
    };
    const result = await persistBuildReviewDecisionStop({ store: new RemediationCaseStore(projectRoot, feature), record: newSource });

    expect(result).toMatchObject({ ok: true, status: 'persisted' });
    expect(result.ok && result.caseId).not.toBe(original.id);
    await expect(new RemediationCaseStore(projectRoot, feature).read()).resolves.toMatchObject({
      ok: true,
      state: { cases: [
        { id: original.id, resolution: 'resolved', sources: original.sources },
        { resolution: 'open', sources: [{ sourceId: 'finding-new' }] },
      ] },
    });
  });

  it('converges a rationale-only replay of an open decision stop', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-open-conflict-'));
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'open-conflict' } as const;
    const stop = decisionStop('architecture');
    await persistBuildReviewDecisionStop({ store: new RemediationCaseStore(projectRoot, feature), record: stop });

    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: { ...stop, rationale: 'changed' },
    })).resolves.toEqual({ ok: true, status: 'already-persisted', caseId: stop.id });
  });

  it('still refuses a conflicting owner for an open decision-stop case id', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-open-owner-conflict-'));
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'open-owner-conflict' } as const;
    const stop = decisionStop('architecture');
    await persistBuildReviewDecisionStop({ store: new RemediationCaseStore(projectRoot, feature), record: stop });

    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: { ...stop, escalation: { owner: 'plan' } },
    })).resolves.toEqual({ ok: false, reason: 'conflicting-case-id' });
  });

  it('persists a blocked consistency stop and derives its halt from the durable evidence', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-consistency-stop-'));
    const feature = { version: 'v1', repository: 'acme/repo', feature: 'consistency-stop' } as const;
    const stop: RemediationCaseRecord = {
      id: 'case-consistency-stop', domain: 'build_review', disposition: 'escalate', priority: 'high',
      rationale: 'The proposed cases contradict one another.', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'finding-1', outcome: 'rejected', recordedAt: '2026-09-17T00:00:00.000Z' }],
      effect: { kind: 'none' },
      consistencyStop: { sourceIds: ['finding-1'], rationale: 'The proposed cases contradict one another.' },
    };

    await expect(persistBuildReviewDecisionStop({
      store: new RemediationCaseStore(projectRoot, feature), record: stop,
    })).resolves.toMatchObject({ ok: true, caseId: stop.id });
    const persisted = await new RemediationCaseStore(projectRoot, feature).read();
    expect(persisted).toMatchObject({ ok: true, state: { cases: [stop] } });
    if (!persisted.ok) return;
    expect(reduceBuildReviewAdjudication({
      currentSourceIds: ['finding-1'], feature: 'adjudication-test', child: undefined, cases: persisted.state.cases, mechanical: 'healthy',
    })).toMatchObject({
      route: 'halt',
      reason: 'build-review adjudication consistency is blocked for finding-1: The proposed cases contradict one another.',
    });
  });
});
