// Test: owner-gate decision (gate.ts)
//
// Covers the pure decision matrix (FR-5..FR-9, ADR-3):
//   - stamped & matches → build; stamped & different → other-owner skip
//   - un-owned pre-cutover → grandfathered build; on/after → post-cutover skip
//   - exact boundary (== cutover) → skip; indeterminate merge time → stable skip
//   - a matching stamp builds regardless of merge time (cutover never consulted)

import { describe, it, expect } from 'vitest';
import { decideSpecGate } from '../../../src/engine/owner-gate/gate.js';
import type { OwnerStamp } from '../../../src/engine/owner-gate/provenance.js';

const CUTOVER = '2026-06-01T00:00:00Z';
const owner = { id: 'alice' };
const stamped = (id: string): OwnerStamp => ({ present: true, id });
const unowned: OwnerStamp = { present: false };

describe('decideSpecGate — stamped specs (FR-5/6/7)', () => {
  it('builds a spec whose stamp matches the daemon owner', () => {
    expect(
      decideSpecGate({ daemonOwner: owner, stamp: stamped('alice'), mergeTime: null, cutover: CUTOVER }),
    ).toEqual({ build: true });
  });

  it('skips a spec stamped with a different owner, naming the other owner', () => {
    expect(
      decideSpecGate({ daemonOwner: owner, stamp: stamped('bob'), mergeTime: null, cutover: CUTOVER }),
    ).toEqual({ build: false, reason: 'other-owner', other: 'bob' });
  });

  it('builds a matching stamp regardless of merge time (cutover not consulted)', () => {
    expect(
      decideSpecGate({
        daemonOwner: owner,
        stamp: stamped('alice'),
        mergeTime: '2030-01-01T00:00:00Z',
        cutover: CUTOVER,
      }),
    ).toEqual({ build: true });
  });
});

describe('decideSpecGate — un-owned specs & grandfather cutover (FR-8/9)', () => {
  it('grandfather-builds an un-owned spec merged strictly before the cutover', () => {
    expect(
      decideSpecGate({
        daemonOwner: owner,
        stamp: unowned,
        mergeTime: '2026-05-31T23:59:59Z',
        cutover: CUTOVER,
      }),
    ).toEqual({ build: true, reason: 'grandfathered' });
  });

  it('skips an un-owned spec merged after the cutover', () => {
    expect(
      decideSpecGate({
        daemonOwner: owner,
        stamp: unowned,
        mergeTime: '2026-06-02T00:00:00Z',
        cutover: CUTOVER,
      }),
    ).toEqual({ build: false, reason: 'unowned-post-cutover' });
  });

  it('treats the exact cutover instant as on/after (skip)', () => {
    expect(
      decideSpecGate({ daemonOwner: owner, stamp: unowned, mergeTime: CUTOVER, cutover: CUTOVER }),
    ).toEqual({ build: false, reason: 'unowned-post-cutover' });
  });

  it('skips (stably) when the merge time is indeterminate', () => {
    const input = { daemonOwner: owner, stamp: unowned, mergeTime: null, cutover: CUTOVER };
    const first = decideSpecGate(input);
    expect(first).toEqual({ build: false, reason: 'unowned-indeterminate' });
    expect(decideSpecGate(input)).toEqual(first); // no run-to-run flip
  });
});
