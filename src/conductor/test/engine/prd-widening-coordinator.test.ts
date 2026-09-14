// Covers: task:18, task:19
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { coordinatePrdWidening, type PrdWideningCoordinatorResult } from '../../src/engine/prd-widening-coordinator.js';
import type { AcceptedWideningDecision } from '../../src/engine/accepted-widenings.js';
import { buildPrdWideningContext, type PrdWideningContext } from '../../src/engine/prd-widening-context.js';
import type { RemediationCaseStoreMutation, RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';
import type { RemediationCasePrdWideningRecord } from '../../src/engine/remediation-case-store.js';

const context = {
  version: 'v1' as const,
  digest: '',
  currentSources: [{ id: 'prd-audit:NC.1', criterion: 'NC.1', grade: 'OVER_SCOPE' as const, evidence: 'A new public behavior.', prdIds: [] }],
  cases: [],
  decisions: [],
};

describe('PRD widening coordinator', () => {
  it('publishes then replays unchanged mixed criterion and NC history without rematching the criterion case', async () => {
    const criterionCase: RemediationCasePrdWideningRecord = {
      id: 'criterion-case', domain: 'prd_widening', originalSources: [{ sourceId: 'S1.1', snapshot: 'Criterion history.' }], currentSources: [], relationships: [],
    };
    const ncCase: RemediationCasePrdWideningRecord = {
      id: 'nc-case', domain: 'prd_widening', originalSources: [{ sourceId: 'NC.1', snapshot: 'Original NC history.' }], currentSources: [], relationships: [],
    };
    const decisions: readonly AcceptedWideningDecision[] = [{
      id: 'criterion-decision', criterion: 'S1.1', authority: 'accept', rationale: 'Criterion authority.', operator: 'operator', revision: 1, originalCaseId: criterionCase.id,
    }];
    const report = { prd: 'present' as const, rejectedRows: [], findings: [{ criterion: 'NC.7', grade: 'OVER_SCOPE' as const, evidence: 'Reworded no-criterion widening.', prdIds: [] }] };
    let state: RemediationCaseStoreState = {
      version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' }, cases: [], suppressions: [], prdWideningCases: [criterionCase, ncCase],
    };
    const store = {
      mutate: async (operation: (current: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<PrdWideningCoordinatorResult>>) => {
        const mutation = await operation(state);
        if (mutation.nextState !== undefined) state = mutation.nextState;
        return { ok: true as const, value: mutation.value };
      },
    };
    const currentContext = (): PrdWideningContext => {
      const built = buildPrdWideningContext(report, state.version === 'v2' ? state.prdWideningCases : [], decisions);
      if (!built.ok) throw new Error('expected bounded context');
      return built.value;
    };
    let calls = 0;
    const judge = async (value: PrdWideningContext) => {
      calls += 1;
      expect(value.cases.map((item) => item.id)).toEqual(['nc-case']);
      return { version: 'v1' as const, results: [{ sourceId: value.currentSources[0]!.id, kind: 'same-case' as const, caseId: ncCase.id, reason: 'Same NC widening.' }] };
    };

    await expect(coordinatePrdWidening({ store, context: currentContext(), judge, now: '2026-09-10T00:00:00.000Z' }))
      .resolves.toMatchObject({ kind: 'published', reused: false });
    await expect(coordinatePrdWidening({ store, context: currentContext(), judge, now: '2026-09-10T00:00:00.000Z' }))
      .resolves.toMatchObject({ kind: 'published', reused: true });
    expect(calls).toBe(1);
  });

  it('retains decisions while distinct similar findings publish and replay effect-free outcomes', async () => {
    const currentSources: readonly PrdWideningContext['currentSources'][number][] = [
      {
        id: 'prd-audit:NC.20',
        criterion: 'NC.20',
        grade: 'OVER_SCOPE',
        evidence: 'Commit 4f2e9a edits src/conductor/src/engine/lease.ts: the reviewer says the 1000ms-to-5000ms lease wait now blocks a different recovery path.',
        prdIds: ['PRD-lease'],
      },
      {
        id: 'prd-audit:NC.21',
        criterion: 'NC.21',
        grade: 'OVER_SCOPE',
        evidence: 'Commit 4f2e9a edits src/conductor/src/engine/lease.ts: the reviewer says the 1000ms-to-5000ms lease wait may instead describe the older recovery path.',
        prdIds: ['PRD-lease'],
      },
    ];
    const legacyCase: RemediationCasePrdWideningRecord = {
      id: 'prd-case-original-lease-wait',
      domain: 'prd_widening',
      originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'The original 1000ms-to-5000ms lease wait.' }],
      currentSources: [],
      relationships: [],
    };
    const decisions: readonly AcceptedWideningDecision[] = [
      {
        id: 'decision-accepted-original',
        criterion: 'NC.1',
        authority: 'accept',
        rationale: 'The original lease-wait behavior was accepted.',
        operator: 'operator',
        revision: 1,
        originalSource: { id: 'prd-audit:NC.1', snapshot: 'The original 1000ms-to-5000ms lease wait.' },
        originalCaseId: legacyCase.id,
        offerEntryId: 'offer-accepted-original',
      },
      {
        id: 'decision-refused-history',
        criterion: 'NC.2',
        authority: 'refuse',
        rationale: 'The separately proposed widening was refused.',
        operator: 'operator',
        revision: 1,
        originalSource: { id: 'prd-audit:NC.2', snapshot: 'The refused historical widening.' },
        originalCaseId: 'prd-case-refused-history',
        offerEntryId: 'offer-refused-history',
      },
    ];
    let state: RemediationCaseStoreState = {
      version: 'v2',
      feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
      cases: [],
      suppressions: [],
      prdWideningCases: [legacyCase],
    };
    const store = {
      mutate: async (operation: (current: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<PrdWideningCoordinatorResult>>) => {
        const mutation = await operation(state);
        if (mutation.nextState !== undefined) state = mutation.nextState;
        return { ok: true as const, value: mutation.value };
      },
    };
    const rebuildContext = (): PrdWideningContext => {
      const cases = state.version === 'v2' ? state.prdWideningCases : [];
      const snapshot = { version: 'v1' as const, currentSources, cases, decisions };
      return { ...snapshot, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
    };
    let judgeCalls = 0;
    const judge = async (judged: PrdWideningContext) => {
      judgeCalls += 1;
      expect(judged.currentSources).toEqual(currentSources);
      expect(judged.cases).toEqual([legacyCase]);
      expect(judged.decisions).toEqual(decisions);
      expect(judged.currentSources.map((source) => source.id)).not.toContain(decisions[1].originalSource!.id);
      return {
        version: 'v1' as const,
        results: [
          {
            sourceId: currentSources[0].id,
            kind: 'different' as const,
            reason: 'Despite the shared commit, path, and lease-wait wording, this is a different recovery behavior.',
          },
          {
            sourceId: currentSources[1].id,
            kind: 'uncertain' as const,
            candidateCaseIds: [legacyCase.id],
            reason: 'The shared commit, path, and wording leave the historical relation uncertain.',
          },
        ],
      };
    };
    const ids = ['different-case', 'uncertain-case'];
    const reconcile = async () => coordinatePrdWidening({
      store,
      context: rebuildContext(),
      judge,
      now: '2026-09-09T00:00:00.000Z',
      createId: () => ids.shift()!,
    });

    await expect(reconcile()).resolves.toMatchObject({ kind: 'published', reused: false });
    expect(judgeCalls).toBe(1);
    expect(state.version).toBe('v2');
    if (state.version !== 'v2') throw new Error('expected v2 state');
    expect(state.prdWideningCases).toEqual([
      legacyCase,
      {
        id: 'prd-widening-different-case',
        domain: 'prd_widening',
        originalSources: [{ sourceId: currentSources[0].id, snapshot: currentSources[0].evidence }],
        currentSources: [{ sourceId: currentSources[0].id, snapshot: currentSources[0].evidence, recordedAt: '2026-09-09T00:00:00.000Z' }],
        relationships: [{
          currentSourceId: currentSources[0].id,
          kind: 'different',
          reason: 'Despite the shared commit, path, and lease-wait wording, this is a different recovery behavior.',
        }],
      },
      {
        id: 'prd-widening-uncertain-case',
        domain: 'prd_widening',
        originalSources: [{ sourceId: currentSources[1].id, snapshot: currentSources[1].evidence }],
        currentSources: [{ sourceId: currentSources[1].id, snapshot: currentSources[1].evidence, recordedAt: '2026-09-09T00:00:00.000Z' }],
        relationships: [{
          currentSourceId: currentSources[1].id,
          kind: 'uncertain',
          candidateCaseIds: [legacyCase.id],
          reason: 'The shared commit, path, and wording leave the historical relation uncertain.',
        }],
      },
    ]);

    await expect(reconcile()).resolves.toMatchObject({ kind: 'published', reused: true });
    expect(judgeCalls).toBe(1);
  });

  it('reuses the decided lease-wait case after the reviewer expands its summary', async () => {
    const source: PrdWideningContext['currentSources'][number] = {
      id: 'prd-audit:NC.9',
      criterion: 'NC.9',
      grade: 'OVER_SCOPE' as const,
      evidence: 'The lease wait is expanded from 1000ms to 5000ms, so a concurrent worker can remain blocked for five seconds.',
      prdIds: [],
    };
    const decidedCase: RemediationCasePrdWideningRecord = {
      id: 'prd-case-lease-wait',
      domain: 'prd_widening' as const,
      originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'The lease wait was widened from 1000ms to 5000ms.' }],
      currentSources: [],
      relationships: [],
    };
    const decision: AcceptedWideningDecision = {
      id: 'decision-lease-wait',
      criterion: 'NC.1',
      authority: 'accept' as const,
      rationale: 'The original 1000ms-to-5000ms lease-wait widening was approved.',
      operator: 'operator',
      revision: 1,
      originalSource: { id: 'prd-audit:NC.1', snapshot: 'The lease wait was widened from 1000ms to 5000ms.' },
      originalCaseId: decidedCase.id,
      offerEntryId: 'offer-lease-wait',
    };
    let state: RemediationCaseStoreState = {
      version: 'v2',
      feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
      cases: [],
      suppressions: [],
      prdWideningCases: [decidedCase],
    };
    const store = {
      mutate: async (operation: (current: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<PrdWideningCoordinatorResult>>) => {
        const mutation = await operation(state);
        if (mutation.nextState !== undefined) state = mutation.nextState;
        return { ok: true as const, value: mutation.value };
      },
    };
    const rebuildContext = (): PrdWideningContext => {
      const cases = state.version === 'v2' ? state.prdWideningCases : [];
      const snapshot = { version: 'v1' as const, currentSources: [source], cases, decisions: [decision] };
      return { ...snapshot, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
    };
    let judgeCalls = 0;
    const judge = async (judged: PrdWideningContext) => {
      judgeCalls += 1;
      expect(judged).toMatchObject({ currentSources: [source], cases: [decidedCase], decisions: [decision] });
      return {
        version: 'v1' as const,
        results: [{
          sourceId: source.id,
          kind: 'same-case' as const,
          caseId: decidedCase.id,
          reason: 'The expanded reviewer summary describes the already decided 1000ms-to-5000ms lease-wait widening.',
        }],
      };
    };
    const reconcile = async () => coordinatePrdWidening({
      store,
      context: rebuildContext(),
      judge,
      now: '2026-09-09T00:00:00.000Z',
    });

    await expect(reconcile()).resolves.toMatchObject({ kind: 'published', reused: false });
    expect(judgeCalls).toBe(1);
    expect(state).toMatchObject({
      prdWideningCases: [{
        id: decidedCase.id,
        originalSources: decidedCase.originalSources,
        currentSources: [{ sourceId: source.id, snapshot: source.evidence, recordedAt: '2026-09-09T00:00:00.000Z' }],
        relationships: [{
          currentSourceId: source.id,
          kind: 'same-case',
          caseId: decidedCase.id,
        }],
      }],
    });

    await expect(reconcile()).resolves.toMatchObject({ kind: 'published', reused: true });
    expect(judgeCalls).toBe(1);
  });

  it('rejudges and refreshes an approved case when its NC evidence is reworded', async () => {
    const previousEvidence = 'The reviewer says the release adds a public CLI flag.';
    const rewordedEvidence = 'The reviewer now describes the same public CLI flag with a clearer impact summary.';
    const source: PrdWideningContext['currentSources'][number] = {
      id: 'prd-audit:NC.1',
      criterion: 'NC.1',
      grade: 'OVER_SCOPE',
      evidence: rewordedEvidence,
      prdIds: [],
    };
    const decidedCase: RemediationCasePrdWideningRecord = {
      id: 'prd-case-approved-cli-flag',
      domain: 'prd_widening',
      originalSources: [{ sourceId: source.id, snapshot: previousEvidence }],
      currentSources: [{ sourceId: source.id, snapshot: previousEvidence, recordedAt: '2026-09-08T00:00:00.000Z' }],
      relationships: [{
        currentSourceId: source.id,
        kind: 'same-case',
        caseId: 'prd-case-approved-cli-flag',
        reason: 'The original reviewer wording describes the approved CLI-flag widening.',
      }],
    };
    let state: RemediationCaseStoreState = {
      version: 'v2',
      feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
      cases: [],
      suppressions: [],
      prdWideningCases: [decidedCase],
    };
    const store = {
      mutate: async (operation: (current: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<PrdWideningCoordinatorResult>>) => {
        const mutation = await operation(state);
        if (mutation.nextState !== undefined) state = mutation.nextState;
        return { ok: true as const, value: mutation.value };
      },
    };
    const rebuildContext = (): PrdWideningContext => {
      const cases = state.version === 'v2' ? state.prdWideningCases : [];
      const snapshot = { version: 'v1' as const, currentSources: [source], cases, decisions: [] };
      return { ...snapshot, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
    };
    let judgeCalls = 0;
    const judge = async () => {
      judgeCalls += 1;
      return {
        version: 'v1' as const,
        results: [{
          sourceId: source.id,
          kind: 'same-case' as const,
          caseId: decidedCase.id,
          reason: 'The reworded review still describes the approved CLI-flag widening.',
        }],
      };
    };

    await expect(coordinatePrdWidening({
      store,
      context: rebuildContext(),
      judge,
      now: '2026-09-09T00:00:00.000Z',
    })).resolves.toMatchObject({ kind: 'published', reused: false });
    expect(judgeCalls).toBe(1);
    expect(state.version).toBe('v2');
    if (state.version !== 'v2') throw new Error('expected v2 state');
    expect(state.prdWideningCases).toEqual([{
      ...decidedCase,
      currentSources: [{ sourceId: source.id, snapshot: rewordedEvidence, recordedAt: '2026-09-09T00:00:00.000Z' }],
      relationships: [{
        currentSourceId: source.id,
        kind: 'same-case',
        caseId: decidedCase.id,
        reason: 'The reworded review still describes the approved CLI-flag widening.',
      }],
    }]);
  });

  it('creates a store-valid independent case for a different result', async () => {
    // The coordinator binds the digest to the complete snapshot before it
    // enters the mutation.  This local store runs that production callback
    // against exactly that empty v2 state.
    const crypto = await import('node:crypto');
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      version: context.version,
      currentSources: context.currentSources,
      cases: [],
      decisions: [],
    })).digest('hex');
    let next: any;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          const mutation = await operation({ version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' }, cases: [], suppressions: [], prdWideningCases: [] });
          next = mutation.nextState;
          return { ok: true, value: mutation.value };
        },
      },
      context: { ...context, digest },
      rawResult: { version: 'v1', results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'Independent behavior.' }] },
      now: '2026-09-09T00:00:00.000Z',
      createId: () => 'independent-case',
    });

    expect(result).toMatchObject({ kind: 'published', reused: false });
    expect(next.prdWideningCases).toMatchObject([{
      id: 'prd-widening-independent-case',
      originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'A new public behavior.' }],
      relationships: [{ kind: 'different', currentSourceId: 'prd-audit:NC.1' }],
    }]);
  });

  it('rejects a relation when an operator reversal changes the sampled decision revision during judgment', async () => {
    const snapshot = {
      reportDigest: 'report-a',
      sourceDigest: 'source-a',
      codeDigest: 'code-a',
      feature: 'acme/repo#feature',
      decisionRevision: 4,
      contractVersion: 'prd-widening-v1',
    };
    let samples = 0;
    let published = 0;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          published += 1;
          const mutation = await operation({
            version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
            cases: [], suppressions: [], prdWideningCases: [],
          });
          return { ok: true, value: mutation.value };
        },
      },
      context: { ...context, digest: createHash('sha256').update(JSON.stringify({ version: context.version, currentSources: context.currentSources, cases: [], decisions: [] })).digest('hex') },
      judge: async () => ({
        version: 'v1',
        results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'A distinct widening.' }],
      }),
      freshness: {
        sample: async () => (++samples === 1 ? snapshot : { ...snapshot, decisionRevision: 5 }),
      },
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result).toEqual({ kind: 'failed', reason: 'stale-context' });
    // The first mutation is a non-writing replay probe.  Staleness must stop
    // the publication transition and leave the newer authority untouched.
    expect(published).toBe(2);
  });

  it.each([
    ['reportDigest', 'report-b'],
    ['sourceDigest', 'source-b'],
    ['codeDigest', 'code-b'],
    ['feature', 'acme/repo#other-feature'],
    ['contractVersion', 'prd-widening-v2'],
  ] as const)('rejects a relation when %s drifts after the judge returns', async (field, changed) => {
    const snapshot = {
      reportDigest: 'report-a', sourceDigest: 'source-a', codeDigest: 'code-a',
      feature: 'acme/repo#feature', decisionRevision: 4, contractVersion: 'prd-widening-v1',
    };
    let samples = 0;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          const mutation = await operation({
            version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
            cases: [], suppressions: [], prdWideningCases: [],
          });
          return { ok: true as const, value: mutation.value };
        },
      },
      context: { ...context, digest: createHash('sha256').update(JSON.stringify({ version: context.version, currentSources: context.currentSources, cases: [], decisions: [] })).digest('hex') },
      judge: async () => ({ version: 'v1', results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'Independent.' }] }),
      freshness: { sample: async () => ++samples === 1 ? snapshot : { ...snapshot, [field]: changed } },
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result).toEqual({ kind: 'failed', reason: 'stale-context' });
  });

  it.each([
    ['timeout', 'timeout'],
    ['unavailable', 'unavailable'],
    ['invalid', 'invalid'],
    ['exhausted', undefined],
  ] as const)('reports %s as a bounded mechanical failure without publishing', async (providerFailure, lastMechanicalFailure) => {
    let writes = 0;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          const mutation = await operation({
            version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
            cases: [], suppressions: [], prdWideningCases: [],
          });
          if (mutation.nextState) writes += 1;
          return { ok: true, value: mutation.value };
        },
      },
      context: { ...context, digest: createHash('sha256').update(JSON.stringify({ version: context.version, currentSources: context.currentSources, cases: [], decisions: [] })).digest('hex') },
      judge: async () => { throw new Error(providerFailure); },
      mechanicalFailure: {
        // Exhaustion is decided before the provider boundary, so it is never
        // a classifier result. Keep the injected adapter contract closed.
        classify: () => providerFailure === 'exhausted' ? 'invalid' : providerFailure,
        remainingAttempts: providerFailure === 'exhausted' ? 0 : 1,
      },
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result).toEqual({
      kind: 'failed', reason: 'attempts-exhausted',
      ...(lastMechanicalFailure === undefined ? {} : { lastMechanicalFailure }),
    });
    expect(writes).toBe(0);
  });

  it('consumes mechanical failures before accepting a later validated result', async () => {
    let calls = 0;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          const mutation = await operation({ version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' }, cases: [], suppressions: [], prdWideningCases: [] });
          return { ok: true as const, value: mutation.value };
        },
      },
      context: { ...context, digest: createHash('sha256').update(JSON.stringify({ version: context.version, currentSources: context.currentSources, cases: [], decisions: [] })).digest('hex') },
      judge: async () => {
        calls += 1;
        if (calls === 1) throw new Error('timeout');
        if (calls === 2) return { version: 'v1', results: [] };
        return { version: 'v1', results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'Independent widening.' }] };
      },
      mechanicalFailure: { remainingAttempts: 3, classify: (error) => /timeout/.test(String(error)) ? 'timeout' : 'invalid' },
      now: '2026-09-10T00:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'published', reused: false });
    expect(calls).toBe(3);
  });

  it('takes the decision read after the case transition and never calls the judge under either lease', async () => {
    const order: string[] = [];
    let caseLeaseHeld = false;
    let decisionLeaseHeld = false;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          order.push('case-acquire');
          caseLeaseHeld = true;
          try {
            const mutation = await operation({
              version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
              cases: [], suppressions: [], prdWideningCases: [],
            });
            return { ok: true as const, value: mutation.value };
          } finally {
            caseLeaseHeld = false;
            order.push('case-release');
          }
        },
      },
      decisionStore: {
        read: async () => {
          order.push('decision-acquire');
          decisionLeaseHeld = true;
          decisionLeaseHeld = false;
          order.push('decision-release');
          return { kind: 'absent' };
        },
      },
      context: { ...context, digest: createHash('sha256').update(JSON.stringify({ version: context.version, currentSources: context.currentSources, cases: [], decisions: [] })).digest('hex') },
      judge: async () => {
        expect(caseLeaseHeld).toBe(false);
        expect(decisionLeaseHeld).toBe(false);
        order.push('judge');
        return { version: 'v1', results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'Independent.' }] };
      },
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'published' });
    expect(order).toEqual([
      'case-acquire', 'case-release',
      'decision-acquire', 'decision-release',
      'judge',
      'case-acquire', 'decision-acquire', 'decision-release', 'case-release',
    ]);
  });

  it('leaves decision authority intact when publication is interrupted after judgment', async () => {
    const authority = {
      version: 2 as const,
      feature: { version: 1 as const, repository: 'acme/repo', feature: 'feature' },
      decisions: [{
        id: 'decision-refusal', criterion: 'NC.9', authority: 'refuse' as const,
        rationale: 'This earlier widening remains refused.', operator: 'operator', revision: 3,
        originalSource: { id: 'prd-audit:NC.9', snapshot: 'Earlier evidence.' },
        originalCaseId: 'prior-case', offerEntryId: 'prior-offer',
      }],
    };
    const snapshot = {
      version: context.version,
      currentSources: context.currentSources,
      cases: [],
      decisions: authority.decisions,
    };
    let publicationAttempts = 0;
    let storeCalls = 0;
    const result = await coordinatePrdWidening({
      store: {
        mutate: async (operation) => {
          const mutation = await operation({
            version: 'v2', feature: { version: 'v1', repository: 'acme/repo', feature: 'feature' },
            cases: [], suppressions: [], prdWideningCases: [],
          });
          storeCalls += 1;
          // The initial replay probe is a read-only, healthy operation. The
          // interruption happens only at the later publication boundary.
          if (storeCalls === 1) return { ok: true as const, value: mutation.value };
          if (mutation.nextState !== undefined) publicationAttempts += 1;
          // Simulate an interruption after the case-store callback has
          // prepared its replacement but before that replacement is durable.
          return { ok: false as const, reason: 'atomic-replace-failed' as const };
        },
      },
      decisionStore: { read: async () => ({ kind: 'valid' as const, state: authority }) },
      context: { ...context, decisions: authority.decisions, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') },
      judge: async () => ({
        version: 'v1',
        results: [{ sourceId: 'prd-audit:NC.1', kind: 'different', reason: 'Independent widening.' }],
      }),
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result).toEqual({ kind: 'failed', reason: 'store-failed' });
    expect(publicationAttempts).toBe(1);
    expect(authority.decisions).toEqual([expect.objectContaining({
      id: 'decision-refusal', authority: 'refuse', revision: 3,
    })]);
  });
});
