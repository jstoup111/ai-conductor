// Test: owner-gate decision (gate.ts)
//
// Covers the pure decision matrix (FR-5..FR-9, ADR-3; un-owned branches updated
// by #721 "Stamp Owner at authoring time; default-and-loudly-log an un-owned
// arrival — never silently skip"):
//   - stamped & matches → build; stamped & different → other-owner skip
//   - un-owned pre-cutover → grandfathered build
//   - un-owned on/after cutover, or indeterminate merge time → DEFAULT-BUILD,
//     reason `unowned-defaulted` (never a silent skip)
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-3, FR-4 (Story 3 & Story 4 — owner-stamped-at-authoring, #721,
// ADR "Stamp Owner at authoring time; default-and-loudly-log an un-owned
// arrival — never silently skip", Layer B)
//
// RED: the un-owned skip branches PREVIOUSLY pinned right above this block
// (`unowned-post-cutover` merged after/at the cutover, and an indeterminate
// merge time) must become a DEFAULT-BUILD attributed to the daemon's own
// resolved owner (new `GateReason` `unowned-defaulted`) — never
// `{ build: false }` — so an un-owned arrival is never a silent dead spec.
// The old skip-only assertions for those two branches are REMOVED (not left
// alongside these) since they assert the mutually-exclusive prior decision
// for the identical input — this IS the behavior change the ADR mandates, not
// an additive case. `other-owner` and stamped-and-matching are explicitly
// UNCHANGED (Story 4, the load-bearing negative path): pinned in the
// "stamped specs" describe block above and reinforced below, byte-identical
// to `main`.
// ─────────────────────────────────────────────────────────────────────────────

describe('decideSpecGate — un-owned arrival defaults to build, never silently dies (Story 3, FR-3)', () => {
  it('an un-owned spec merged on/after the cutover default-builds, attributed to the daemon owner', () => {
    expect(
      decideSpecGate({
        daemonOwner: owner,
        stamp: unowned,
        mergeTime: '2026-06-02T00:00:00Z',
        cutover: CUTOVER,
      }),
    ).toEqual({ build: true, reason: 'unowned-defaulted' });
  });

  it('an un-owned spec merged exactly at the cutover instant also default-builds (on/after boundary)', () => {
    expect(
      decideSpecGate({ daemonOwner: owner, stamp: unowned, mergeTime: CUTOVER, cutover: CUTOVER }),
    ).toEqual({ build: true, reason: 'unowned-defaulted' });
  });

  it('an un-owned spec with an indeterminate merge time also default-builds (stably — same input, same decision)', () => {
    const input = { daemonOwner: owner, stamp: unowned, mergeTime: null, cutover: CUTOVER };
    const first = decideSpecGate(input);
    expect(first).toEqual({ build: true, reason: 'unowned-defaulted' });
    expect(decideSpecGate(input)).toEqual(first); // no run-to-run flip
  });

  it('an un-owned spec merged strictly BEFORE the cutover is still `grandfathered`, not `unowned-defaulted` (unchanged)', () => {
    expect(
      decideSpecGate({
        daemonOwner: owner,
        stamp: unowned,
        mergeTime: '2026-05-31T23:59:59Z',
        cutover: CUTOVER,
      }),
    ).toEqual({ build: true, reason: 'grandfathered' });
  });
});

describe('decideSpecGate — explicit cross-operator ownership still skips, byte-identical to main (Story 4, FR-4, load-bearing negative path)', () => {
  it('a spec stamped with a DIFFERENT owner is never defaulted-and-built — still { build: false, reason: other-owner }', () => {
    expect(
      decideSpecGate({ daemonOwner: owner, stamp: stamped('bob'), mergeTime: null, cutover: CUTOVER }),
    ).toEqual({ build: false, reason: 'other-owner', other: 'bob' });
  });

  it('a matching stamp still builds regardless of merge time — the cutover (and the un-owned default) is never consulted for stamped specs', () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Task 5 (FR-4, verify-only): decideSpecGate is a pure decision function whose
// GateDecision return type has no "throw" / "halt" arm — a missing `Owner:`
// marker is ALWAYS resolved to a plain returned decision, never an exception.
// This pins that no new HALT/rejection was introduced anywhere in the un-owned
// path across the full input space (present/absent stamp x every mergeTime x
// cutover combination exercised elsewhere in this file).
// ─────────────────────────────────────────────────────────────────────────────
describe('decideSpecGate — never throws for un-owned input (no new HALT, Task 5)', () => {
  it('returns a plain decision (never throws) for every un-owned/merge-time/cutover combination', () => {
    const mergeTimes = [null, '2020-01-01T00:00:00Z', CUTOVER, '2030-01-01T00:00:00Z', 'not-a-date'];
    const cutovers = [null, CUTOVER, 'not-a-date'];
    for (const mergeTime of mergeTimes) {
      for (const cutover of cutovers) {
        let decision: ReturnType<typeof decideSpecGate> | undefined;
        expect(() => {
          decision = decideSpecGate({ daemonOwner: owner, stamp: unowned, mergeTime, cutover });
        }).not.toThrow();
        expect(decision?.build).toBe(true);
      }
    }
  });

  it('returns a plain decision (never throws) for a stamped-but-mismatched owner too', () => {
    expect(() => {
      decideSpecGate({ daemonOwner: owner, stamp: stamped('mallory'), mergeTime: null, cutover: CUTOVER });
    }).not.toThrow();
  });
});
