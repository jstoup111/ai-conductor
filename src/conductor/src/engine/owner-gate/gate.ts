// owner-gate/gate.ts — the pure owner-gating decision.
//
// Given the daemon's resolved owner, a spec's owner stamp, its first-appearance
// (merge) time, and the configured grandfather cutover, decide whether the
// daemon should BUILD the spec or SKIP it — and, on skip, WHY (for the distinct
// log lines required by FR-11). This is a pure function: no I/O, no git, no
// clock. The caller resolves the inputs (identity.ts / provenance.ts /
// merge-time.ts) and only invokes this gate for specs that already passed the
// content-eligibility filters.
//
// Decision matrix (FR-5..FR-9, ADR-3):
//   stamped & matches daemon owner        → build
//   stamped & different owner             → skip (other-owner)
//   un-owned, merged strictly BEFORE cutover → build (grandfathered)
//   un-owned, merged ON/AFTER cutover     → build (unowned-defaulted)
//   un-owned, merge time indeterminate    → build (unowned-defaulted)
// A stamped-and-matching spec builds regardless of merge time — the cutover is
// never consulted for stamped specs (ADR-3). Un-owned specs always build: the
// cutover only decides the reason (grandfathered vs. unowned-defaulted), never
// whether to build.

import type { OwnerStamp } from './provenance.js';

/** Inputs to the pure gate. `daemonOwner` is the already-resolved owner id. */
export interface GateInput {
  /** The daemon's resolved owner (the gate is only consulted when resolved). */
  daemonOwner: { id: string };
  /** The spec's committed owner stamp (present/absent). */
  stamp: OwnerStamp;
  /** The spec's first-appearance time (ISO-8601), or null if indeterminate. */
  mergeTime: string | null;
  /** The configured grandfather cutover (ISO-8601), or null if unconfigured. */
  cutover: string | null;
}

/** Reasons a spec is skipped or grandfather-built — surfaced distinctly in logs. */
export type GateReason =
  | 'grandfathered'
  | 'other-owner'
  | 'unowned-post-cutover'
  | 'unowned-indeterminate'
  | 'unowned-defaulted';

/** The gate outcome. On other-owner skips, `other` names the mismatched owner. */
export type GateDecision =
  | { build: true; reason?: 'grandfathered' }
  | { build: false; reason: 'other-owner'; other: string }
  | { build: true; reason: 'unowned-defaulted' };

/**
 * Decide whether to build a content-eligible spec under owner-gating.
 *
 * Stamped specs are decided purely by owner match (the cutover is never
 * consulted). Un-owned specs always build: the grandfather cutover only
 * selects the reason — strictly before cutover → grandfathered; on/after (or
 * an indeterminate merge time) → unowned-defaulted. The boundary is inclusive
 * of the cutover instant (== cutover counts as on/after), and an indeterminate
 * merge time is a stable unowned-defaulted result (same input → same decision).
 */
export function decideSpecGate(input: GateInput): GateDecision {
  const { daemonOwner, stamp, mergeTime, cutover } = input;

  if (stamp.present) {
    return stamp.id === daemonOwner.id
      ? { build: true }
      : { build: false, reason: 'other-owner', other: stamp.id };
  }

  // Un-owned: consult the grandfather cutover.
  const mergeMs = parseTime(mergeTime);
  const cutoverMs = parseTime(cutover);
  if (mergeMs === null || cutoverMs === null) {
    return { build: true, reason: 'unowned-defaulted' };
  }
  return mergeMs < cutoverMs
    ? { build: true, reason: 'grandfathered' }
    : { build: true, reason: 'unowned-defaulted' };
}

/** Parse an ISO-8601 instant to epoch ms, or null if absent/unparseable. */
function parseTime(iso: string | null): number | null {
  if (iso == null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
