// Covers: task:10
import { describe, expect, it } from 'vitest';
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
});
