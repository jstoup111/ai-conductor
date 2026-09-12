// Covers: task:7, task:19, task:35, task:rem-as-built-rem-ab2-4, task:rem-as-built-rem-ab4-1
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBuildReviewActionEffects, applyBuildReviewDeferralEffect, hasReservedOrFailedRemediationEffect, isBuildEligibleActionCase, isBuildReviewSettlementObligationCase, renderBuildReviewDeferralIssue, remediationEffectMarker } from '../../src/engine/remediation-case-effects.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { sanitizeIntakeText } from '../../src/engine/engineer/intake/sanitize.js';
import type { TrackerClient } from '../../src/engine/tracker-client.js';
import type { RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';
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
  const record = (effect: RemediationCaseRecord['effect'], overrides: Partial<RemediationCaseRecord> = {}): RemediationCaseRecord => ({
    id: 'case-1', domain: 'build_review', disposition: 'defer', priority: 'low', confidence: 'high',
    rationale: 'Belongs outside this feature.', resolution: 'open',
    sources: [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', recordedAt: '2026-08-30T12:00:00.000Z' }],
    effect, ...overrides,
  });

  it.each([
    ['reserved deferral', { id: 'e', kind: 'deferral', status: 'reserved' }, true],
    ['failed deferral', { id: 'e', kind: 'deferral', status: 'failed', diagnostic: 'tracker unavailable' }, true],
    ['applied deferral', { id: 'e', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' }, false],
    ['no effect', { kind: 'none' }, false],
  ] as const)('shared effect-status test flags %s durable evidence', (_label, effect, expected) => {
    expect(hasReservedOrFailedRemediationEffect(record(effect as RemediationCaseRecord['effect']))).toBe(expected);
  });

  const openAppliedActionRecord = (): RemediationCaseRecord => record({
    id: 'effect-action', kind: 'action', status: 'applied', workOrderId: 'order-1',
  }, {
    disposition: 'act', resolution: 'open',
    sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: '2026-09-11T00:00:00.000Z' }],
  });

  const refutedRecord = (claim: string): RemediationCaseRecord => ({
    ...openAppliedActionRecord(),
    disposition: 'refute',
    refutation: { claim, assertions: [{ assertion: 'the required behavior exists', verdict: 'refuted', evidence: [{ path: 'src/engine/remediation-case-effects.ts', excerpt: 'isBuildEligibleActionCase' }] }] },
  });

  it.each([
    ['an open unresolved act case with an applied action effect', openAppliedActionRecord, true],
    ['a refuted case with its original claim', () => refutedRecord('the finding is wrong'), false],
    ['a refuted case with a revised claim', () => refutedRecord('the asserted behavior is already present'), false],
    ['a refuted case with a narrow claim', () => refutedRecord('the finding does not apply to this case'), false],
  ] as const)('BUILD action eligibility: %s', (_label, fixture, expected) => {
    expect(isBuildEligibleActionCase(fixture())).toBe(expected);
  });

  it.each([
    ['reserved', { id: 'effect-refute', kind: 'deferral', status: 'reserved' }],
    ['failed', { id: 'effect-refute', kind: 'deferral', status: 'failed', diagnostic: 'intake failed' }],
  ] as const)('treats a refutation with a %s deferral as unfinished', (_label, effect) => {
    expect(hasReservedOrFailedRemediationEffect(record(effect, {
      disposition: 'refute', resolution: 'resolved',
      sources: [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }],
      refutation: { claim: 'the finding is wrong', assertions: [{ assertion: 'the required behavior exists', verdict: 'refuted', evidence: [{ path: 'src/engine/remediation-case-effects.ts', excerpt: 'isBuildEligibleActionCase' }] }] },
    }))).toBe(true);
  });

  it.each([
    ['reserved deferral blocks settlement', { id: 'e', kind: 'deferral', status: 'reserved' }, {}, true],
    ['failed deferral blocks settlement', { id: 'e', kind: 'deferral', status: 'failed', diagnostic: 'x' }, {}, true],
    ['applied deferral is benign', { id: 'e', kind: 'deferral', status: 'applied', issueUrl: 'https://x' }, {}, false],
    ['applied action awaits its work order', { id: 'e', kind: 'action', status: 'applied', workOrderId: 'o' }, { disposition: 'act' }, true],
    ['reserved action blocks settlement', { id: 'e', kind: 'action', status: 'reserved' }, { disposition: 'act' }, true],
    ['failed action blocks settlement', { id: 'e', kind: 'action', status: 'failed', diagnostic: 'x' }, { disposition: 'act' }, true],
    ['resolved case carries no obligation', { id: 'e', kind: 'deferral', status: 'failed', diagnostic: 'x' }, { resolution: 'resolved' }, false],
  ] as const)('settlement obligation: %s', (_label, effect, overrides, expected) => {
    expect(isBuildReviewSettlementObligationCase(record(effect as RemediationCaseRecord['effect'], overrides as Partial<RemediationCaseRecord>))).toBe(expected);
  });

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

  it('publishes only current admitted acts with their custom source links and admission rationale', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [
      {
        id: 'case-custom-merged', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'The compatible repair covers both policies.', confidence: 'high', resolution: 'open',
        sources: [
          { sourceId: 'custom:policy-a:finding-1', outcome: 'acted', recordedAt: '2026-09-11T00:00:00.000Z' },
          { sourceId: 'custom:policy-b:finding-2', outcome: 'merged', recordedAt: '2026-09-11T00:00:00.000Z' },
        ],
        effect: { id: 'effect-custom-merged', kind: 'action', status: 'reserved' },
      },
      {
        id: 'case-escalated', domain: 'build_review', disposition: 'escalate', priority: 'critical', rationale: 'Owner decision is required.', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'custom:policy-c:finding-3', outcome: 'escalate', recordedAt: '2026-09-11T00:00:00.000Z' }],
        escalation: { owner: 'architecture' }, effect: { kind: 'none' },
      },
      {
        id: 'case-deferred', domain: 'build_review', disposition: 'defer', priority: 'low', rationale: 'Future work.', confidence: 'high', resolution: 'open',
        sources: [{ sourceId: 'custom:policy-d:finding-4', outcome: 'deferred', recordedAt: '2026-09-11T00:00:00.000Z' }],
        effect: { id: 'effect-deferred', kind: 'deferral', status: 'reserved' },
      },
    ] });
    const publishWorkOrder = vi.fn().mockResolvedValue({ ok: true, workOrder: {} });

    await expect(applyBuildReviewActionEffects({
      projectRoot: root, feature, store,
      tasksByCaseId: new Map([
        ['case-custom-merged', [{
          title: 'Preserve both policy contracts at the implementation boundary',
          admittedTaskIds: ['35'],
          admissionRationale: 'Task 35 owns the admitted consistent repair publication boundary.',
        }]],
        ['case-escalated', [{ title: 'Never publish a decision stop' }]],
        ['case-deferred', [{ title: 'Never publish a deferral' }]],
      ]),
      chargeInput: { treeHash: 'tree', resolvedCount: 0, reason: 'case-custom-merged' },
      workOrderId: () => 'order-custom-merged', publishWorkOrder,
      chargeEffect: vi.fn().mockResolvedValue({ status: 'charged', exhausted: false, cumulativeExhausted: false, entry: { count: 1, cumulative: 1 } }),
    })).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'effect-custom-merged' });

    expect(publishWorkOrder).toHaveBeenCalledWith(root, expect.objectContaining({
      effectId: 'effect-custom-merged',
      cases: [{
        caseId: 'case-custom-merged',
        priority: 'high',
        sources: [
          { sourceId: 'custom:policy-a:finding-1', outcome: 'acted', recordedAt: '2026-09-11T00:00:00.000Z' },
          { sourceId: 'custom:policy-b:finding-2', outcome: 'merged', recordedAt: '2026-09-11T00:00:00.000Z' },
        ],
        tasks: [{
          title: 'Preserve both policy contracts at the implementation boundary',
          admittedTaskIds: ['35'],
          admissionRationale: 'Task 35 owns the admitted consistent repair publication boundary.',
        }],
      }],
    }));
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

  it('files a refuted residual through the same marker-deduplicated deferral executor', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-refuted', domain: 'build_review', disposition: 'refute', priority: 'low', confidence: 'high',
      rationale: 'The original finding is refuted.', resolution: 'resolved',
      sources: [{ sourceId: 'source-refuted', outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }],
      effect: { id: 'effect-refuted', kind: 'deferral', status: 'reserved' },
      refutation: { claim: 'The finding is false.', assertions: [{ assertion: 'The behavior exists.', verdict: 'refuted', evidence: [{ path: 'test/evidence.ts', excerpt: 'evidence' }] }] },
    }] });
    const find = vi.fn().mockResolvedValue('https://github.test/acme/repo/issues/42');
    const fileIssue = vi.fn();

    await expect(applyBuildReviewDeferralEffect({
      projectRoot: root, feature, store, caseId: 'case-refuted', repo: 'acme/repo',
      effect: { kind: 'deferral', title: 'Deferred refutation', body: 'Details', exclusionRationale: 'outside scope' },
      tracker: { findIssueByEffectMarker: find } as never, fileIssue,
    })).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'effect-refuted' });
    expect(find).toHaveBeenCalledWith(remediationEffectMarker('effect-refuted'), 'acme/repo', root);
    expect(fileIssue).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      disposition: 'refute', effect: { id: 'effect-refuted', kind: 'deferral', status: 'applied', issueUrl: 'https://github.test/acme/repo/issues/42' },
    })] } });
  });

  it('files and sanitizes a new refuted residual through the injected tracker client', async () => {
    const store = await storeWith({ version: 'v1', feature, cases: [{
      id: 'case-refuted', domain: 'build_review', disposition: 'refute', priority: 'low', confidence: 'high',
      rationale: 'The original finding is refuted.', resolution: 'resolved',
      sources: [{ sourceId: 'source-refuted', outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }],
      effect: { id: 'effect-refuted', kind: 'deferral', status: 'reserved' },
      refutation: { claim: 'The finding is false.', assertions: [{ assertion: 'The behavior exists.', verdict: 'refuted', evidence: [{ path: 'test/evidence.ts', excerpt: 'evidence' }] }] },
    }] });
    const createIssue = vi.fn().mockResolvedValue('https://github.test/acme/repo/issues/43');
    const intakeTracker = { createIssue } as unknown as TrackerClient;
    const effect = {
      kind: 'deferral' as const,
      title: 'Deferred refutation',
      body: 'Follow up with token ghp_abcdefghijklmnopqrstuvwxyz123456 and /home/operator/private-notes.',
      exclusionRationale: 'outside scope',
    };
    const rendered = renderBuildReviewDeferralIssue(effect, 'The original finding is refuted.', 'effect-refuted');

    await expect(applyBuildReviewDeferralEffect({
      projectRoot: root, feature, store, caseId: 'case-refuted', repo: 'acme/repo', effect,
      tracker: { findIssueByEffectMarker: vi.fn().mockResolvedValue(null) } as never,
      fileIssue: async ({ title, body, priority }) => fileIntakeIssue(
        { title, body, priority, repo: 'acme/repo' },
        { tracker: intakeTracker, gh: async () => ({ stdout: '{}' }), cwd: root },
      ),
    })).resolves.toMatchObject({ ok: true, status: 'applied', effectId: 'effect-refuted' });

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(createIssue).toHaveBeenCalledWith({
      title: 'Deferred refutation',
      body: sanitizeIntakeText(rendered).text,
      repo: 'acme/repo',
    }, root);
    expect(createIssue.mock.calls[0]![0].body).toContain(remediationEffectMarker('effect-refuted'));
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      disposition: 'refute', effect: { id: 'effect-refuted', kind: 'deferral', status: 'applied', issueUrl: 'https://github.test/acme/repo/issues/43' },
    })] } });
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
  ] as const)('records the deferred effect failed without an issue reference after %s', async (_name, boundary, failure) => {
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
    expect(savedEffect.status).toBe('failed');
    expect(savedEffect).toMatchObject({ diagnostic: `deferred intake failed: ${failure.message}` });
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
