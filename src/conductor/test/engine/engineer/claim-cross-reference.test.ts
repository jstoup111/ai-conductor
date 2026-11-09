// Covers: task:10
import { describe, expect, it, vi } from 'vitest';
import { createDeliveryGuardedQueue } from '../../../src/engine/engineer/intake/delivery-guard.js';

describe('claim cross-reference guard', () => {
  it('Covers: Task 10 records an in-flight draft spec run and does not serve a duplicate issue', async () => {
    const envelope = { id: '1', source: 'github-issues', sourceRef: 'acme/demo#12', text: 'idea', status: 'pending' as const, receivedAt: '2026-11-08T00:00:00Z' };
    let candidate: any = envelope; const calls: any[] = [];
    const queue: any = { claim: async () => { const value = candidate; candidate = null; return value; }, ack: async (value: any) => calls.push(['ack', value]), release: async () => {} };
    const ledger: any = { get: async () => undefined, record: async (value: any) => calls.push(['record', value]), transition: async (...value: any[]) => calls.push(['transition', value]), reopen: async () => {}, forget: async () => {} };
    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh: async () => ({ stdout: '' }), findCrossReferencedDraft: async () => ({ branch: 'spec/demo', url: 'https://github.com/acme/demo/pull/8' }) });
    expect(await guarded.claim()).toBeNull();
    expect(calls).toContainEqual(['record', { source: 'github-issues', sourceRef: 'acme/demo#12' }]);
    expect(calls).toContainEqual(['transition', ['github-issues', 'acme/demo#12', 'deciding', { branch: 'spec/demo', draftPrUrl: 'https://github.com/acme/demo/pull/8' }]]);
  });

  it('Covers: Task 10 leaves a pending candidate pending when cross-reference lookup fails and serves a no-match candidate unchanged', async () => {
    const envelope = { id: '1', source: 'github-issues', sourceRef: 'acme/demo#12', text: 'idea', status: 'pending' as const, receivedAt: '2026-11-08T00:00:00Z' };
    const pendingCalls: unknown[] = [];
    let pendingCandidate: typeof envelope | null = envelope;
    const pendingQueue: any = { claim: vi.fn(async () => { const value = pendingCandidate; pendingCandidate = null; return value; }), ack: async () => pendingCalls.push('ack'), release: async (value: unknown) => pendingCalls.push(['release', value]) };
    const pendingLedger: any = { get: async () => ({ source: envelope.source, sourceRef: envelope.sourceRef, status: 'pending' }), record: async () => pendingCalls.push('record'), transition: async () => pendingCalls.push('transition'), reopen: async () => {}, forget: async () => {} };
    const failed = createDeliveryGuardedQueue(pendingQueue, pendingLedger, { gh: async () => ({ stdout: 'OPEN' }), findCrossReferencedDraft: async () => { throw new Error('GitHub unavailable'); } });
    expect(await failed.claim()).toBeNull();
    expect(pendingCalls).not.toContain('record');
    expect(pendingCalls).not.toContain('transition');
    expect(pendingCalls).not.toContain('ack');

    const noMatchQueue: any = { claim: async () => envelope, ack: async () => {}, release: async () => {} };
    const noMatchLedger: any = { get: async () => ({ status: 'pending' }), record: async () => { throw new Error('must not record'); }, transition: async () => { throw new Error('must not transition'); }, reopen: async () => {}, forget: async () => {} };
    const unchanged = createDeliveryGuardedQueue(noMatchQueue, noMatchLedger, { gh: async () => ({ stdout: 'OPEN' }), findCrossReferencedDraft: async () => undefined });
    await expect(unchanged.claim()).resolves.toEqual(envelope);
  });
});
