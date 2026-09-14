// Covers: task:7, task:31
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { reduceBuildReviewAdjudication } from '../../src/engine/build-review-adjudication.js';
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
  cases: [reject()],
  mechanical: 'healthy' as const,
  ...overrides,
});

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

  it.each([
    ['retry', 'mechanical-retry', 'build-review coverage retry is pending'],
    ['halt', 'halt', 'uncovered build-review coverage failure'],
  ] as const)('names a retained %s scope blocker as coverage', (mechanical, route, reason) => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: [], cases: [], mechanical })))
      .toMatchObject({ route, reason });
  });

  it('halts rather than passing when current source coverage is incomplete or contradictory', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({ currentSourceIds: ['finding-1', 'finding-2'] })).route).toBe('halt');
    expect(reduceBuildReviewAdjudication(reducerInput({
      cases: [reject(), { ...reject(), id: 'case-conflict', sources: [{ ...reject().sources[0], outcome: 'merged' }] }],
    })).route).toBe('halt');
  });

  it('never routes an old applied action to BUILD when it covers no current source', () => {
    expect(reduceBuildReviewAdjudication(reducerInput({
      currentSourceIds: ['finding-2'],
      cases: [action()],
    })).route).toBe('halt');
  });

  it.each(['reserved', 'failed'] as const)('halts when a refutation deferral is %s', (status) => {
    expect(reduceBuildReviewAdjudication(reducerInput({ cases: [refute(status)] })))
      .toMatchObject({ route: 'halt', reason: 'remediation effect is not finalized' });
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
});
