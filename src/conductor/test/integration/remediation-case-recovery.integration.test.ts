// Covers: task:5, task:19, task:rem-as-built-rem-ab2-4
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { markBuildReviewWorkOrderAttempted, publishBuildReviewWorkOrder, readBuildReviewWorkOrder } from '../../src/engine/build-review-work-order.js';
import { chargeBuildReviewEffectInLedger, readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { applyBuildReviewActionEffects, isBuildEligibleActionCase, persistBuildReviewDecisionStop } from '../../src/engine/remediation-case-effects.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { RemediationCaseGraph } from '../../src/engine/remediation-case-validator.js';
import { Conductor } from '../test-conductor.js';

const directories: string[] = [];
const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'restart-recovery' };

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'remediation-case-recovery-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const graph: RemediationCaseGraph = {
  sourceOutcomes: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-ref' }],
  cases: [{
    sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-ref' }],
    case: {
      caseRef: 'case-ref', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The behavior needs repair.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the assertion' }] },
    },
  }],
};

/** A custom-policy source must remain durable even after that policy is gone. */
const customGraph: RemediationCaseGraph = {
  sourceOutcomes: [{ sourceId: 'custom:portable-policy@sha256:original:authorization-bypass', outcome: 'acted', caseRef: 'custom-case-ref' }],
  cases: [{
    sources: [{ sourceId: 'custom:portable-policy@sha256:original:authorization-bypass', outcome: 'acted', caseRef: 'custom-case-ref' }],
    case: {
      caseRef: 'custom-case-ref', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The original portable policy found an authorization bypass.',
      effect: { kind: 'action', route: 'build', tasks: [{
        title: 'Restore the authorization check', admittedTaskIds: ['35'],
        admissionRationale: 'Task 35 owns this policy-admitted repair.',
      }] },
    },
  }],
};

function actionAggregate(lapId: string, findings: readonly { readonly name: string; readonly path: string }[]) {
  return joinBuildReviewRubricOutcomes({
    lapId: lapId as never,
    snapshotDigest: `snapshot-${lapId}`,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: lapId as never, snapshotDigest: `snapshot-${lapId}`, contractVersion: 'v3', verdict: 'FAIL',
        findings: findings.map((finding) => ({
          concernKind: 'test-insensitive' as const,
          summary: `${finding.name} is insensitive.`,
          evidenceLocations: [`${finding.path}:1`],
          anchor: { rubric: 'testQuality' as const, locus: { path: finding.path, contentHash: `sha256:${finding.name}`, display: finding.name } },
        })),
      },
    },
  });
}

describe('remediation case recovery', () => {
  it('replays custom decision, work, and charge boundaries by their original durable ids', async () => {
    const projectRoot = await root();
    const store = new RemediationCaseStore(projectRoot, feature);
    const decision = {
      id: 'custom-decision-stop', domain: 'build_review' as const, disposition: 'escalate' as const,
      priority: 'high' as const, confidence: 'high' as const, resolution: 'open' as const,
      rationale: 'The original custom policy requires product direction.',
      sources: [{
        sourceId: 'custom:portable-policy@sha256:original:needs-product-direction', outcome: 'escalate' as const,
        recordedAt: '2026-09-14T00:00:00.000Z',
      }],
      effect: { kind: 'none' as const }, escalation: { owner: 'product' as const },
    };

    // A restart after the decision write sees the same durable stop, not a new
    // provider decision or a default derived from today's policy catalog.
    await expect(persistBuildReviewDecisionStop({ store, record: decision })).resolves.toMatchObject({ ok: true, status: 'persisted' });
    await expect(persistBuildReviewDecisionStop({ store: new RemediationCaseStore(projectRoot, feature), record: decision }))
      .resolves.toMatchObject({ ok: true, status: 'already-persisted' });

    await reconcileRemediationCases(store, {
      graph: customGraph, recordedAt: '2026-09-14T00:00:01.000Z', generateId: (() => {
        const ids = ['custom-case', 'custom-effect'];
        return () => ids.shift()!;
      })(),
    });
    const publish = vi.fn(publishBuildReviewWorkOrder);
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const actionInput = {
      projectRoot, feature,
      tasksByCaseId: new Map([['custom-case', [{
        title: 'Restore the authorization check', admittedTaskIds: ['35'],
        admissionRationale: 'Task 35 owns this policy-admitted repair.',
      }]]]),
      chargeInput: { treeHash: 'custom-tree', resolvedCount: 1, reason: 'custom recovery fixture' },
      workOrderId: () => 'custom-order', publishWorkOrder: publish, chargeEffect: charge,
    };

    await expect(applyBuildReviewActionEffects({ ...actionInput, store })).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'custom-effect' });
    await expect(applyBuildReviewActionEffects({ ...actionInput, store: new RemediationCaseStore(projectRoot, feature) }))
      .resolves.toMatchObject({ ok: true, status: 'already-applied', effectId: 'custom-effect' });

    const order = await readBuildReviewWorkOrder(projectRoot, feature, ['custom-effect']);
    expect({ publishCalls: publish.mock.calls.length, chargeCalls: charge.mock.calls.length }).toEqual({ publishCalls: 1, chargeCalls: 1 });
    expect(order).toMatchObject({ ok: true, workOrder: { effectId: 'custom-effect' } });
    if (!order.ok) throw new Error(`unexpected work-order recovery failure: ${order.reason}`);
    expect(order.workOrder.cases[0]).toMatchObject({
      caseId: 'custom-case',
      sources: [expect.objectContaining({ sourceId: 'custom:portable-policy@sha256:original:authorization-bypass', outcome: 'acted' })],
    });
  });

  it('two restarted executors converge on one stable work order and one charged effect', async () => {
    const projectRoot = await root();
    const store = new RemediationCaseStore(projectRoot, feature);
    await reconcileRemediationCases(store, {
      graph, recordedAt: '2026-08-30T00:00:00.000Z', generateId: (() => {
        const ids = ['case-1', 'effect-1'];
        return () => ids.shift()!;
      })(),
    });
    const input = {
      projectRoot, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the assertion' }]]]),
      chargeInput: { treeHash: 'tree-1', resolvedCount: 1, reason: 'restart fixture' },
      workOrderId: () => 'order-1',
    };

    const [first, second] = await Promise.all([
      applyBuildReviewActionEffects(input),
      applyBuildReviewActionEffects(input),
    ]);

    expect([first.ok, second.ok]).toEqual([true, true]);
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review).toMatchObject({ count: 1, cumulative: 1, chargedEffectIds: ['effect-1'] });
    const order = await readBuildReviewWorkOrder(projectRoot, feature, 'effect-1');
    expect(order).toMatchObject({ ok: true, workOrder: { cases: [{ caseId: 'case-1' }] } });
    const settled = await store.read();
    expect(settled).toMatchObject({ ok: true, state: { cases: [expect.objectContaining({ effect: expect.objectContaining({ status: 'applied' }) })] } });
  });

  it('admits one custom recovery owner when resumes compete', async () => {
    const projectRoot = await root();
    const store = new RemediationCaseStore(projectRoot, feature);
    await reconcileRemediationCases(store, {
      graph: customGraph, recordedAt: '2026-09-14T00:00:00.000Z', generateId: (() => {
        const ids = ['custom-case', 'custom-effect'];
        return () => ids.shift()!;
      })(),
    });
    const publish = vi.fn(publishBuildReviewWorkOrder);
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const input = {
      projectRoot, feature, store,
      tasksByCaseId: new Map([['custom-case', [{
        title: 'Restore the authorization check', admittedTaskIds: ['35'],
        admissionRationale: 'Task 35 owns this policy-admitted repair.',
      }]]]),
      chargeInput: { treeHash: 'competing-custom-tree', resolvedCount: 1, reason: 'competing custom recovery' },
      workOrderId: () => 'custom-order', publishWorkOrder: publish, chargeEffect: charge,
    };

    const outcomes = await Promise.all([
      applyBuildReviewActionEffects(input),
      applyBuildReviewActionEffects(input),
    ]);

    expect(outcomes).toEqual([
      expect.objectContaining({ ok: true, effectId: 'custom-effect' }),
      expect.objectContaining({ ok: true, effectId: 'custom-effect' }),
    ]);
    expect({ publications: publish.mock.calls.length, charges: charge.mock.calls.length }).toEqual({ publications: 1, charges: 1 });
  });

  it('re-reads a late operator disposition before applying an admitted action', async () => {
    const projectRoot = await root();
    const aggregate = actionAggregate('late-operator', [{ name: 'late accepted custom-equivalent finding', path: 'test/late.test.ts' }]);
    const source = projectBuildReviewAggregateSources(aggregate)![0]!;
    let accepted = false;
    const charge = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      projectRoot, feature, aggregate, mechanical: 'healthy', operatorResolvedFindingIds: new Set<string>(),
      resolveOperatorResolvedFindingIds: async () => accepted ? new Set([source.findingId]) : new Set<string>(),
      judge: async () => ({
        mode: 'case-v1', domain: 'build_review',
        sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(source), outcome: 'acted', caseRef: 'late-case' }],
        cases: [{
          caseRef: 'late-case', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The finding was live at judgement.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'Do not publish after acceptance' }] },
        }],
      }),
      chargeInput: { treeHash: 'late-operator-tree', resolvedCount: 1, reason: 'late operator disposition' }, chargeEffect: charge,
      generateId: (() => { const ids = ['late-case-id', 'late-effect']; return () => ids.shift()!; })(),
      emit: async (event) => { if (event.type === 'remediation_effect_reserved') accepted = true; },
    });

    if (!result.ok) throw new Error(result.detail);
    expect(result.route).not.toBe('build');
    expect(charge).not.toHaveBeenCalled();
    await expect(readBuildReviewWorkOrder(projectRoot, feature, ['late-effect'])).resolves.toMatchObject({ ok: false, reason: 'missing-work-order' });
    await expect(new RemediationCaseStore(projectRoot, feature).read()).resolves.toMatchObject({
      ok: true, state: { cases: [expect.objectContaining({ id: 'late-case-id', resolution: 'resolved', effect: expect.objectContaining({ status: 'failed' }) })] },
    });
  });

  it('names corrupt and unavailable recovery state before any effect can publish', async () => {
    const projectRoot = await root();
    const pipeline = join(projectRoot, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    const recovery = (rootPath: string) => new Conductor({
      projectRoot: rootPath, stateFilePath: join(rootPath, '.pipeline/state.json'), stepRunner: {} as never,
      config: { build_review: { adjudication: { enabled: true } } },
    } as never) as unknown as { durableBuildReviewRetryContext(hint: string | undefined): Promise<{ kind: string; reason?: string }> };

    await writeFile(join(pipeline, 'remediation-cases.json'), '{');
    await expect(recovery(projectRoot).durableBuildReviewRetryContext(undefined))
      .resolves.toMatchObject({ kind: 'invalid', reason: 'case store malformed-json' });

    await writeFile(join(pipeline, 'remediation-cases.json'), `${JSON.stringify({
      version: 'v1', feature, cases: [{
        id: 'incomplete-case', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'Applied state without its required order.', resolution: 'open',
        sources: [{ sourceId: 'custom:portable-policy@sha256:original:incomplete', outcome: 'acted', recordedAt: '2026-09-14T00:00:00.000Z' }],
        effect: { id: 'incomplete-effect', kind: 'action', status: 'applied', workOrderId: 'missing-order' },
      }],
    })}\n`);
    await expect(recovery(projectRoot).durableBuildReviewRetryContext(undefined))
      .resolves.toMatchObject({ kind: 'invalid', reason: expect.stringContaining('work order missing-work-order with open action case incomplete-case') });

    const unavailable = new RemediationCaseStore(projectRoot, feature, {
      filesystem: {
        readFile: async () => { const error = Object.assign(new Error('permission denied'), { code: 'EACCES' }); throw error; },
        mkdir: async () => undefined, writeFile: async () => undefined, rename: async () => undefined, rm: async () => undefined,
      },
    });
    const publish = vi.fn(publishBuildReviewWorkOrder);
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    await expect(applyBuildReviewActionEffects({
      projectRoot, feature, store: unavailable, tasksByCaseId: new Map(),
      chargeInput: { treeHash: 'unavailable-tree', resolvedCount: 1, reason: 'unavailable state' }, publishWorkOrder: publish, chargeEffect: charge,
    })).resolves.toMatchObject({ ok: false, reason: 'case store unreadable' });
    expect({ publications: publish.mock.calls.length, charges: charge.mock.calls.length }).toEqual({ publications: 0, charges: 0 });

    const unwritable = new RemediationCaseStore(projectRoot, feature, {
      filesystem: {
        readFile: (path) => readFile(path, 'utf8'), mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
        writeFile: async () => { throw new Error('read-only state'); }, rename: (from, to) => rename(from, to).then(() => undefined),
        rm: (path) => rm(path, { force: true }).then(() => undefined),
      },
    });
    await expect(persistBuildReviewDecisionStop({
      store: unwritable,
      record: {
        id: 'unwritable-stop', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high', resolution: 'open',
        rationale: 'The durable decision state cannot be written.',
        sources: [{ sourceId: 'custom:portable-policy@sha256:original:unwritable', outcome: 'escalate', recordedAt: '2026-09-14T00:00:00.000Z' }],
        effect: { kind: 'none' }, escalation: { owner: 'product' },
      },
    })).resolves.toMatchObject({ ok: false, reason: 'case store atomic-replace-failed' });
  });

  it.each([
    ['charge throws', async () => { throw new Error('ledger unavailable'); }],
    ['per-gate cap is exhausted', async () => ({ status: 'charged' as const, exhausted: true, cumulativeExhausted: false, entry: { count: 3, cumulative: 3 } })],
    ['cumulative cap is exhausted', async () => ({ status: 'charged' as const, exhausted: false, cumulativeExhausted: true, entry: { count: 3, cumulative: 6 } })],
  ])('keeps failed action effects out of retry eligibility when %s', async (_name, chargeEffect) => {
    const projectRoot = await root();
    const store = new RemediationCaseStore(projectRoot, feature);
    await reconcileRemediationCases(store, {
      graph, recordedAt: '2026-08-30T00:00:00.000Z', generateId: (() => {
        const ids = ['case-1', 'effect-1'];
        return () => ids.shift()!;
      })(),
    });

    const charge = vi.fn(chargeEffect);
    await expect(applyBuildReviewActionEffects({
      projectRoot, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the assertion' }]]]),
      chargeInput: { treeHash: 'tree-1', resolvedCount: 1, reason: 'restart fixture' }, workOrderId: () => 'order-1',
      chargeEffect: charge as never,
    })).resolves.toMatchObject({ ok: false });

    const settled = await store.read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: [expect.objectContaining({ effect: expect.objectContaining({ status: 'failed' }) })] },
    });
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    expect(isBuildEligibleActionCase(settled.state.cases[0]!)).toBe(false);
    const freshConductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline/state.json'),
      stepRunner: {} as never,
      config: { build_review: { adjudication: { enabled: true } } },
    } as never);
    const retry = await (freshConductor as unknown as {
      durableBuildReviewRetryContext(hint: string | undefined): Promise<{ kind: string }>;
    }).durableBuildReviewRetryContext(undefined);
    expect({ retry, charges: charge.mock.calls.length }).toEqual({ retry: { kind: 'absent' }, charges: 1 });
  });

  it('reserves nothing a semantic-repeat halt would orphan, so the next lap routes only its own work', async () => {
    const projectRoot = await root();
    const lapOne = actionAggregate('lap-one', [
      { name: 'orphaned reservation', path: 'test/orphaned.test.ts' },
      { name: 'already attempted case', path: 'test/repeated.test.ts' },
    ]);
    const [orphanedSource, repeatedSource] = projectBuildReviewAggregateSources(lapOne)!;
    const repeatedSourceId = buildReviewAdjudicationSourceId(repeatedSource!);
    const store = new RemediationCaseStore(projectRoot, feature);
    await store.mutate(async () => ({
      value: undefined,
      nextState: {
        version: 'v1', feature,
        cases: [{
          id: 'repeat-case', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'This case already reached BUILD.', resolution: 'open',
          sources: [{ sourceId: repeatedSourceId, outcome: 'acted', recordedAt: '2026-09-03T00:00:00.000Z' }],
          effect: { id: 'repeat-effect', kind: 'action', status: 'applied', workOrderId: 'repeat-order' },
        }],
      },
    }));
    await publishBuildReviewWorkOrder(projectRoot, {
      version: 'v1', domain: 'build_review', feature, effectId: 'repeat-effect',
      cases: [{ caseId: 'repeat-case', priority: 'high', tasks: [{ title: 'Do not repeat this work' }] }],
    });
    await markBuildReviewWorkOrderAttempted(projectRoot, feature);

    const lapOneJudgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [
        { sourceId: buildReviewAdjudicationSourceId(orphanedSource!), outcome: 'acted', caseRef: 'orphaned-case' },
        { sourceId: repeatedSourceId, outcome: 'acted', caseRef: 'repeat-case' },
      ],
      cases: [
        {
          caseRef: 'orphaned-case', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'This action must not be reserved by a lap that halts.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the orphaned assertion' }] },
        },
        {
          caseRef: 'repeat-case', existingCaseId: 'repeat-case', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'This repeats the attempted action.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'Do not repeat this work' }] },
        },
      ],
    };
    await expect(coordinateBuildReviewAdjudication({
      projectRoot, feature, aggregate: lapOne, operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy',
      judge: async () => lapOneJudgement, chargeInput: { treeHash: 'tree-one', resolvedCount: 1, reason: 'lap one' },
      generateId: (() => { const ids = ['orphaned-case-id', 'orphaned-effect']; return () => ids.shift()!; })(),
    })).resolves.toMatchObject({ ok: false, detail: 'semantic remediation case repeat repeat-case' });

    const lapTwo = actionAggregate('lap-two', [{ name: 'materially distinct case', path: 'test/distinct.test.ts' }]);
    const distinctSource = projectBuildReviewAggregateSources(lapTwo)![0]!;
    const lapTwoJudgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(distinctSource), outcome: 'acted', caseRef: 'distinct-case' }],
      cases: [{
        caseRef: 'distinct-case', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'This is new work.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the distinct assertion' }] },
      }],
    };
    await expect(coordinateBuildReviewAdjudication({
      projectRoot, feature, aggregate: lapTwo, operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy',
      judge: async () => lapTwoJudgement, chargeInput: { treeHash: 'tree-two', resolvedCount: 1, reason: 'lap two' },
      generateId: (() => { const ids = ['distinct-case-id', 'distinct-effect']; return () => ids.shift()!; })(),
    })).resolves.toMatchObject({ ok: true, route: 'build' });

    const freshStore = new RemediationCaseStore(projectRoot, feature);
    const persisted = await freshStore.read();
    expect(persisted).toMatchObject({
      ok: true,
      state: { cases: expect.arrayContaining([
        expect.objectContaining({ id: 'distinct-case-id', effect: expect.objectContaining({ status: 'applied' }) }),
      ]) },
    });
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    // The repeat halted lap one before reconciliation, so no orphaned reservation exists to block lap two.
    expect(persisted.state.cases.map((record) => record.id)).not.toContain('orphaned-case-id');
    const workOrder = JSON.parse(await readFile(join(projectRoot, '.pipeline/build-review-work-order.json'), 'utf8')) as { cases: Array<{ caseId: string }> };
    expect(workOrder.cases).toEqual([{ caseId: 'distinct-case-id', priority: 'high', tasks: [{ title: 'Repair the distinct assertion' }] }]);

    const freshConductor = new Conductor({
      projectRoot, stateFilePath: join(projectRoot, '.pipeline/state.json'), stepRunner: {} as never,
      config: { build_review: { adjudication: { enabled: true } } },
    } as never);
    const retry = await (freshConductor as unknown as {
      durableBuildReviewRetryContext(hint: string | undefined): Promise<{ kind: string; context?: string }>;
    }).durableBuildReviewRetryContext(undefined);
    expect(retry).toMatchObject({ kind: 'ready' });
    expect(retry.context).not.toContain('orphaned-case-id');
    expect(reduceBuildReviewAdjudication({
      currentSourceIds: [buildReviewAdjudicationSourceId(distinctSource)], cases: persisted.state.cases, mechanical: 'healthy',
    })).toMatchObject({ route: 'build', remainingMechanical: false });
  });

  it('recovers from a cleared rejected-transition halt without changing its valid persisted history', async () => {
    const projectRoot = await root();
    const rejectedAggregate = actionAggregate('rejected-transition', [{ name: 'already-linked finding', path: 'test/linked.test.ts' }]);
    const admissibleAggregate = actionAggregate('admissible-transition', [{ name: 'unlinked finding', path: 'test/unlinked.test.ts' }]);
    const rejectedSourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(rejectedAggregate)![0]!);
    const admissibleSourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(admissibleAggregate)![0]!);
    const store = new RemediationCaseStore(projectRoot, feature);
    const storePath = join(projectRoot, '.pipeline/remediation-cases.json');
    const haltPath = join(projectRoot, '.pipeline/HALT');
    const haltClassPath = join(projectRoot, '.pipeline/HALT.class');

    await store.mutate(async () => ({
      value: undefined,
      nextState: {
        version: 'v1', feature,
        cases: [{
          id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'This applied repair remains the authoritative history.', resolution: 'resolved',
          sources: [{ sourceId: rejectedSourceId, outcome: 'acted', recordedAt: '2026-10-10T00:00:00.000Z' }],
          effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'order-R' },
        }],
      },
    }));
    const savedStore = await readFile(storePath, 'utf8');
    const savedCaseR = (JSON.parse(savedStore) as { cases: readonly unknown[] }).cases[0];

    const rejectedJudgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId: rejectedSourceId, outcome: 'acted', caseRef: 'case-N' }],
      cases: [{
        caseRef: 'case-N', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'This incorrectly proposes a second owner for the existing source.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Do not duplicate the linked finding' }] },
      }],
    };
    const run = (
      aggregate: ReturnType<typeof actionAggregate>,
      judgement: RemediationCaseJudgement,
      ids: readonly [string, string],
      events: unknown[],
    ) =>
      coordinateBuildReviewAdjudication({
        projectRoot, feature, aggregate, mechanical: 'healthy', operatorResolvedFindingIds: new Set<string>(),
        judge: async () => judgement,
        chargeInput: { treeHash: `tree-${aggregate.lapId}`, resolvedCount: 1, reason: 'rejected transition recovery proof' },
        generateId: (() => { const generated = [...ids]; return () => generated.shift()!; })(),
        emit: async (event) => { events.push(event); },
      });

    const initialEvents: unknown[] = [];
    await expect(run(rejectedAggregate, rejectedJudgement, ['case-N', 'effect-N'], initialEvents)).resolves.toMatchObject({ ok: false, detail: expect.stringContaining('case transition rejected') });
    expect(await readFile(storePath, 'utf8')).toBe(savedStore);

    // HALT ownership belongs to Conductor; exercise its real on-disk recovery
    // contract here while the coordinator and case store remain production code.
    await writeFile(haltPath, 'build_review adjudication halted');
    await writeFile(haltClassPath, 'needs-human');
    await Promise.all([rm(haltPath), rm(haltClassPath)]);

    // Repeat before the successful alternative so this branch proves the whole
    // persisted file is still byte-identical to the saved valid history.
    const repeatedEvents: unknown[] = [];
    await expect(run(rejectedAggregate, rejectedJudgement, ['case-N', 'effect-N'], repeatedEvents)).resolves.toMatchObject({ ok: false });
    expect(repeatedEvents).toContainEqual(expect.objectContaining({
      type: 'remediation_adjudication_failed',
      rejectedTransition: { invariant: 'source-linked-by-multiple-cases', caseIds: ['case-R', 'case-N'], sourceIds: [rejectedSourceId] },
    }));
    expect(await readFile(storePath, 'utf8')).toBe(savedStore);

    await writeFile(haltPath, 'build_review adjudication halted');
    await writeFile(haltClassPath, 'needs-human');
    await Promise.all([rm(haltPath), rm(haltClassPath)]);

    const admissibleJudgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId: admissibleSourceId, outcome: 'acted', caseRef: 'case-U' }],
      cases: [{
        caseRef: 'case-U', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'This is a distinct source.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the unlinked finding' }] },
      }],
    };
    const admissibleEvents: unknown[] = [];
    await expect(run(admissibleAggregate, admissibleJudgement, ['case-U', 'effect-U'], admissibleEvents)).resolves.toMatchObject({ ok: true });
    const recovered = await new RemediationCaseStore(projectRoot, feature).read();
    expect(recovered).toMatchObject({ ok: true, state: { cases: expect.arrayContaining([expect.objectContaining({ id: 'case-U' })]) } });
    if (!recovered.ok) throw new Error(`unexpected case-store recovery failure: ${recovered.reason}`);
    const caseR = recovered.state.cases.find((record) => record.id === 'case-R');
    expect(JSON.stringify(caseR)).toBe(JSON.stringify(savedCaseR));
  });
});
