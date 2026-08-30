import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect, remediationEffectMarker } from '../../src/engine/remediation-case-effects.js';
import { RemediationCaseStore, type RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';

const feature = { version: 'v1', repository: 'repo', feature: 'feature' } as const;
let root = '';

afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });

async function storeWith(state: RemediationCaseStoreState): Promise<RemediationCaseStore> {
  root = await mkdtemp(join(tmpdir(), 'remediation-case-effects-'));
  const store = new RemediationCaseStore(root, feature);
  await store.replace(state);
  return store;
}

describe('remediation case effects', () => {
  it('publishes and charges a stable action order once', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'repair', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }] });
    const input = {
      projectRoot: root, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the regression' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-1' }, workOrderId: () => 'order-1',
    };
    await expect(applyBuildReviewActionEffects(input)).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'effect-1' });
    await expect(applyBuildReviewActionEffects(input)).resolves.toMatchObject({ ok: true, status: 'already-applied', effectId: 'effect-1' });
    const read = await store.read();
    expect(read.ok && read.state.cases[0]?.effect).toEqual({ id: 'effect-1', kind: 'action', status: 'applied', workOrderId: 'order-1' });
  });

  it('records failed action effects without writing the active plan when the charge is exhausted', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'repair', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }] });
    const planPath = join(root, 'active-plan.md');
    await writeFile(planPath, 'original plan\n');
    const publishWorkOrder = vi.fn().mockResolvedValue({ ok: true, workOrder: {} });
    const chargeEffect = vi.fn().mockResolvedValue({
      status: 'charged', exhausted: true, cumulativeExhausted: false, entry: {},
    });

    await expect(applyBuildReviewActionEffects({
      projectRoot: root, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the regression' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-1' }, workOrderId: () => 'order-1',
      publishWorkOrder, chargeEffect,
    })).resolves.toMatchObject({ ok: false, reason: 'build-review kickback budget exhausted' });

    const read = await store.read();
    expect(read.ok && read.state.cases[0]?.effect).toEqual(expect.objectContaining({ status: 'failed' }));
    await expect(readFile(planPath, 'utf8')).resolves.toBe('original plan\n');
  });

  it('reuses an exact deferred issue marker instead of filing a duplicate', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'out of scope', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'deferred', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' },
    }] });
    const find = vi.fn().mockResolvedValue('https://github.test/acme/repo/issues/12');
    const fileIssue = vi.fn();
    await expect(applyBuildReviewDeferralEffect({
      projectRoot: root, feature, store, caseId: 'case-1', repo: 'acme/repo',
      effect: { kind: 'deferral', title: 'Deferred', body: 'Details', exclusionRationale: 'outside scope' },
      tracker: { findIssueByEffectMarker: find } as never, fileIssue,
    })).resolves.toMatchObject({ ok: true, status: 'applied' });
    expect(find).toHaveBeenCalledWith(remediationEffectMarker('effect-1'), 'acme/repo', root);
    expect(fileIssue).not.toHaveBeenCalled();
  });
});
