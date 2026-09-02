// Covers: task:19, task:rem-as-built-rem-ab2-4
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBuildReviewWorkOrder } from '../../src/engine/build-review-work-order.js';
import { applyBuildReviewActionEffects, isBuildEligibleActionCase } from '../../src/engine/remediation-case-effects.js';
import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
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

describe('remediation case recovery', () => {
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
});
