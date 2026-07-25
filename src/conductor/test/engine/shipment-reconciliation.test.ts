import { describe, expect, it } from 'vitest';

import { planShipmentReconciliation } from '../../src/engine/shipment-reconciliation.js';

describe('planShipmentReconciliation', () => {
  it('leaves an aligned merged shipment write-free', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/916',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'aligned', writes: [] });
  });

  it('plans one deterministic record-only repair for missing evidence', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({
      kind: 'repair',
      identity: '916/durable-shipped-records',
      writes: [{
        path: '.docs/shipped/durable-shipped-records.md',
        content: `---\nslug: durable-shipped-records\nspec_hash: ${'a'.repeat(64)}\npr: https://github.com/acme/conductor/pull/916\nshipped: 2026-07-25\n---\n`,
      }],
    });
  });

  it('plans the same record-only repair for invalid evidence', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-hash-mismatch',
        expected: 'a'.repeat(64),
        observed: 'b'.repeat(64),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toMatchObject({
      kind: 'repair',
      identity: '916/durable-shipped-records',
      writes: [{ path: '.docs/shipped/durable-shipped-records.md' }],
    });
  });

  it('keeps ambiguous associations write-free', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: {
        kind: 'not-applicable',
        classification: 'multi-match',
        diagnostic: 'shipment association is multi-match',
      },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'unresolved', reason: 'multi-match', writes: [] });
  });

  it('uses the same repair identity for repeated missing-record plans', () => {
    const input = {
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation' as const, slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal' as const,
        code: 'shipped-record-missing' as const,
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    };

    expect([
      planShipmentReconciliation(input).kind === 'repair'
        ? planShipmentReconciliation(input).identity
        : null,
      planShipmentReconciliation(input).kind === 'repair'
        ? planShipmentReconciliation(input).identity
        : null,
    ]).toEqual(['916/durable-shipped-records', '916/durable-shipped-records']);
  });

  it('leaves an accurate record bytes untouched when it is already aligned', () => {
    const recordBytes = Buffer.from(`---\nslug: durable-shipped-records\nspec_hash: ${'a'.repeat(64)}\npr: https://github.com/acme/conductor/pull/916\nshipped: 2026-07-25\n---\n`);
    const before = Buffer.from(recordBytes);

    const result = planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/916',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2099-01-01' },
    });

    expect({ result, recordBytes }).toEqual({
      result: { kind: 'aligned', writes: [] },
      recordBytes: before,
    });
  });

  it('keeps an unproven valid verdict write-free when its PR identity disagrees', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/917',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'unresolved', reason: 'evidence-identity-mismatch', writes: [] });
  });

  it('keeps unavailable evidence write-free instead of fabricating a repair', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipment-evidence-git-unavailable',
        expected: 'candidate-tree/head reachability',
        observed: 'git transport unavailable',
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({
      kind: 'unresolved',
      reason: 'shipment-evidence-git-unavailable',
      writes: [],
    });
  });
});
