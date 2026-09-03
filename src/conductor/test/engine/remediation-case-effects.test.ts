// Covers: task:19, task:rem-as-built-rem-ab2-4, task:rem-as-built-rem-ab4-1
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect, renderBuildReviewDeferralIssue, remediationEffectMarker } from '../../src/engine/remediation-case-effects.js';
import { RemediationCaseStore, type RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';

const feature = { version: 'v1', repository: 'repo', feature: 'feature' } as const;
let root = '';

afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });

async function storeWith(state: RemediationCaseStoreState): Promise<RemediationCaseStore> {
  root = await mkdtemp(join(tmpdir(), 'remediation-case-effects-'));
  const store = new RemediationCaseStore(root, feature);
  // `mutate` is the store's only write seam; seeding goes through it too.
  const seeded = await store.mutate(async () => ({ value: null, nextState: state }));
  if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
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
      status: 'charged', exhausted: true, cumulativeExhausted: false, entry: { count: 3, cumulative: 3 },
    });

    await expect(applyBuildReviewActionEffects({
      projectRoot: root, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the regression' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-1' }, workOrderId: () => 'order-1',
      publishWorkOrder, chargeEffect,
    })).resolves.toMatchObject({
      ok: false,
      reason: 'build-review kickback budget exhausted (per-gate): blocked cases case-1 (effect effect-1); count 3, cumulative 3',
    });

    const read = await store.read();
    expect(read.ok && read.state.cases[0]?.effect).toEqual(expect.objectContaining({ status: 'failed' }));
    await expect(readFile(planPath, 'utf8')).resolves.toBe('original plan\n');
  });

  it.each([
    ['malformed ledger', 'not valid json {'],
    ['unsupported ledger version', JSON.stringify({ version: 2, gates: {} })],
  ])('fails the pending action without charging when its ledger is unreadable (%s)', async (_name, rawLedger) => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'repair', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }] });
    const ledgerPath = join(root, '.pipeline', 'kickback-ledger.json');
    await writeFile(ledgerPath, rawLedger, 'utf8');

    await expect(applyBuildReviewActionEffects({
      projectRoot: root, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the regression' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-1' }, workOrderId: () => 'order-1',
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('kickback ledger') });

    const read = await store.read();
    expect(read.ok && read.state.cases[0]?.effect).toEqual(expect.objectContaining({ status: 'failed' }));
    await expect(readFile(ledgerPath, 'utf8')).resolves.toBe(rawLedger);
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

  it('renders a bounded structured intake body and files distinct effect markers independently', async () => {
    const effect = { kind: 'deferral', title: 'Deferred', body: 'Observed behavior', exclusionRationale: 'outside current plan' } as const;
    expect(renderBuildReviewDeferralIssue(effect, 'case rationale', 'effect-1')).toContain('## Observed');
    expect(renderBuildReviewDeferralIssue(effect, 'case rationale', 'effect-1')).toContain('## Desired Outcome');
    expect(renderBuildReviewDeferralIssue(effect, 'case rationale', 'effect-1')).toContain(remediationEffectMarker('effect-1'));

    const store = await storeWith({ version: 'v1', feature, cases: [
      {
        id: 'case-1', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'case rationale', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-1', outcome: 'deferred', recordedAt: '2026-08-30T00:00:00.000Z' }],
        effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' },
      },
      {
        id: 'case-2', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'case rationale', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-2', outcome: 'deferred', recordedAt: '2026-08-30T00:00:00.000Z' }],
        effect: { id: 'effect-2', kind: 'deferral', status: 'reserved' },
      },
    ] });
    const fileIssue = vi.fn()
      .mockResolvedValueOnce({ issueUrl: 'https://github.test/acme/repo/issues/1' })
      .mockResolvedValueOnce({ issueUrl: 'https://github.test/acme/repo/issues/2' });
    const tracker = { findIssueByEffectMarker: vi.fn().mockResolvedValue(null) } as never;
    for (const caseId of ['case-1', 'case-2']) {
      await expect(applyBuildReviewDeferralEffect({
        projectRoot: root, feature, store, caseId, effect, repo: 'acme/repo', tracker, fileIssue,
      })).resolves.toMatchObject({ ok: true, status: 'applied' });
    }
    expect(fileIssue).toHaveBeenCalledTimes(2);
    expect(fileIssue.mock.calls[0]?.[0].body).toContain(remediationEffectMarker('effect-1'));
    expect(fileIssue.mock.calls[1]?.[0].body).toContain(remediationEffectMarker('effect-2'));
  });

  it('recovers after remote create succeeds before the local issue reference persists', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'case rationale', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'deferred', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' },
    }] });
    const mutableStore = store as unknown as { atomicReplace: (state: RemediationCaseStoreState) => Promise<unknown> };
    const atomicReplace = mutableStore.atomicReplace.bind(store);
    let failOnce = true;
    mutableStore.atomicReplace = async (state) => {
      if (failOnce) {
        failOnce = false;
        return { ok: false, reason: 'atomic-replace-failed' };
      }
      return atomicReplace(state);
    };
    const effect = { kind: 'deferral', title: 'Deferred', body: 'Observed behavior', exclusionRationale: 'outside current plan' } as const;
    const tracker = { findIssueByEffectMarker: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://github.test/acme/repo/issues/12') } as never;
    const fileIssue = vi.fn().mockResolvedValue({ issueUrl: 'https://github.test/acme/repo/issues/12' });
    const input = { projectRoot: root, feature, store, caseId: 'case-1', effect, repo: 'acme/repo', tracker, fileIssue };

    await expect(applyBuildReviewDeferralEffect(input)).resolves.toMatchObject({ ok: false, reason: 'case store atomic-replace-failed' });
    await expect(applyBuildReviewDeferralEffect(input)).resolves.toMatchObject({ ok: true, status: 'applied' });
    expect(fileIssue).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout during exact-marker lookup', 'lookup', new Error('request timed out')],
    ['authentication failure while filing', 'file', new Error('authentication failed')],
    ['rate limit while filing', 'file', new Error('API rate limit exceeded')],
  ] as const)('keeps the deferred effect without an issue reference after %s', async (_name, boundary, failure) => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'case rationale', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'deferred', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' },
    }] });
    const findIssueByEffectMarker = boundary === 'lookup'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(null);
    const fileIssue = boundary === 'file'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn();

    await expect(applyBuildReviewDeferralEffect({
      projectRoot: root, feature, store, caseId: 'case-1', repo: 'acme/repo',
      effect: { kind: 'deferral', title: 'Deferred', body: 'Observed behavior', exclusionRationale: 'outside current plan' },
      tracker: { findIssueByEffectMarker } as never, fileIssue,
    })).resolves.toEqual({ ok: false, reason: `deferred intake failed: ${failure.message}` });

    expect(findIssueByEffectMarker).toHaveBeenCalledWith(remediationEffectMarker('effect-1'), 'acme/repo', root);
    expect(fileIssue).toHaveBeenCalledTimes(boundary === 'file' ? 1 : 0);
    const read = await store.read();
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(`unexpected case store failure: ${read.reason}`);
    const savedEffect = read.state.cases[0]?.effect;
    expect(savedEffect?.kind).toBe('deferral');
    if (savedEffect?.kind !== 'deferral') throw new Error('expected a deferred effect');
    expect(savedEffect.status).toMatch(/^(reserved|failed)$/);
    expect(savedEffect).not.toHaveProperty('issueUrl');
  });
  it('charges a later distinct action under its own reserved effect, not the already-applied one', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [
      {
        // Applied on an earlier lap and still open: BUILD has not resolved it.
        id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'repair', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
        effect: { id: 'effect-1', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      },
      {
        id: 'case-2', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'later repair', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-2', outcome: 'acted', recordedAt: '2026-08-31T00:00:00.000Z' }],
        effect: { id: 'effect-2', kind: 'action', status: 'reserved' },
      },
    ] });
    const chargeEffect = vi.fn().mockResolvedValue({ status: 'charged', exhausted: false, cumulativeExhausted: false, entry: { count: 2, cumulative: 2 } });

    const result = await applyBuildReviewActionEffects({
      projectRoot: root, feature, store,
      tasksByCaseId: new Map([['case-1', [{ title: 'Repair the first' }]], ['case-2', [{ title: 'Repair the second' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-2' }, workOrderId: () => 'order-2', chargeEffect,
    });

    expect(result).toMatchObject({ ok: true, status: 'applied', effectId: 'effect-2' });
    expect(chargeEffect).toHaveBeenCalledWith(root, 'effect-2', expect.anything());
  });

  it('never reopens a failed sibling while finalizing a later reserved action', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [
      {
        id: 'case-failed', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'first repair', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-failed', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
        effect: { id: 'effect-failed', kind: 'action', status: 'failed', diagnostic: 'budget exhausted' },
      },
      {
        id: 'case-live', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'later repair', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'source-live', outcome: 'acted', recordedAt: '2026-08-31T00:00:00.000Z' }],
        effect: { id: 'effect-live', kind: 'action', status: 'reserved' },
      },
    ] });
    const chargeEffect = vi.fn().mockResolvedValue({ status: 'charged', exhausted: false, cumulativeExhausted: false, entry: { count: 2, cumulative: 2 } });

    await expect(applyBuildReviewActionEffects({
      projectRoot: root, feature, store,
      tasksByCaseId: new Map([['case-failed', [{ title: 'Never replay this' }]], ['case-live', [{ title: 'Repair the second' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-live' }, workOrderId: () => 'order-live', chargeEffect,
    })).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'effect-live' });

    const read = await store.read();
    expect(read).toMatchObject({
      ok: true,
      state: { cases: [
        expect.objectContaining({ effect: expect.objectContaining({ id: 'effect-failed', status: 'failed' }) }),
        expect.objectContaining({ effect: expect.objectContaining({ id: 'effect-live', status: 'applied' }) }),
      ] },
    });
  });

  it('names the blocked cases and the counter state when the kickback budget is exhausted', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'repair', confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'source-1', outcome: 'acted', recordedAt: '2026-08-30T00:00:00.000Z' }],
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }] });
    const chargeEffect = vi.fn().mockResolvedValue({
      status: 'charged', exhausted: false, cumulativeExhausted: true, entry: { count: 3, cumulative: 6 },
    });

    const result = await applyBuildReviewActionEffects({
      projectRoot: root, feature, store, tasksByCaseId: new Map([['case-1', [{ title: 'Repair the regression' }]]]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-1' }, workOrderId: () => 'order-1',
      publishWorkOrder: vi.fn().mockResolvedValue({ ok: true, workOrder: {} }), chargeEffect,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'build-review kickback budget exhausted (cumulative): blocked cases case-1 (effect effect-1); count 3, cumulative 6',
    });
  });
});
