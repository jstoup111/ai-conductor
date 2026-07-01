# Architecture Review: Daemon Owner-Gating

**Date:** 2026-06-30
**Mode:** Lightweight (Medium tier — Feasibility + Alignment)
**Stories reviewed:** `.docs/stories/daemon-owner-gate.md` (FR-1 … FR-14)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|-------|------------|
| Stack compatibility | Fits the current stack — a filter in `discoverBacklog`, a resolver over config + `gh` (already used by intake), a stamp read from the committed tree, and git-history lookup (already used to read base-branch artifacts). No new runtime deps. |
| Prerequisites | Config surface must carry `specOwner`/`ownerIdentity` + cutover; engineer `land` must write the owner onto the intake marker. Both are additive. |
| Integration surface | Three surfaces: engineer authoring (stamp), daemon discovery (gate), daemon config. Bounded; no external API beyond the existing `gh`. |
| Data implications | No schema/DB. Per-spec committed marker gains one field. |
| Performance risk | Owner resolved **once per pass**; per-spec cost is a stamp read + (only for un-owned) one git-history lookup. Negligible against existing per-spec tree reads. |
| Worktree isolation | No new ports/services/DBs. Config is per-daemon. No shared-state contention. |

## Alignment

- **Composes additively** with `discoverBacklog`: the gate runs **after** existing content filters
  and never bypasses them or the processed-set idempotency (stories FR-5/FR-6/FR-7/FR-8/FR-9). ✔
- **Vocabulary boundary** vs. `daemon-lock.ts`'s `owner` (lock holder) is resolved by ADR
  `adr-2026-06-30-owner-gate-identity-resolution` — distinct naming, lock code untouched. ✔
- **Provenance** reuses the engineer intake marker rather than a competing artifact
  (`adr-2026-06-30-owner-provenance-recording`); must coordinate the field with phase-9.3b. ⚠ (condition)
- **Forward-compat seam**: `IdentityResolver` + `ProvenanceReader` interfaces keep an EKS
  platform-provided identity and signed provenance substitutable without changing gate behavior —
  satisfies the PRD's deployment-context / forward-compat NFRs. ✔
- **State modeling**: the gate outcome is an exhaustive set of cases (match / other / un-owned±cutover
  / gate-inactive) with no catch-all default — matches the "invalid states unrepresentable" intent. ✔

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|------|------|------------|--------|------------|
| Misconfigured headless daemon fails **open** and builds others' specs | Security | Medium | **High** | Warn-once "gate inactive" line; document explicit-owner config for EKS; revisit fail-closed once platform identity lands (ADR-1). |
| Owner-field schema drift between this feature and phase-9.3b intake | Integration | Medium | Medium | Coordinate the marker field before implementation (condition 1). |
| `owner` naming conflated with the lock's `owner` | Knowledge | Low | Medium | Naming boundary enforced in review (condition 2). |
| Base-branch history rewrite shifts grandfather merge-times | Data | Low | Low | `main` history rewrites already out-of-bounds; documented in ADR-3. |

## ADRs Created (all APPROVED)

- `adr-2026-06-30-owner-gate-identity-resolution` — IdentityResolver seam, config→gh→unresolved,
  fail-open posture, owner-vs-lock vocabulary boundary.
- `adr-2026-06-30-owner-provenance-recording` — ProvenanceReader seam; extend the engineer intake
  marker to carry the owner; coordinate with phase-9.3b.
- `adr-2026-06-30-grandfather-cutover-merge-time` — derive activation time from git first-appearance;
  deterministic boundary + indeterminate→skip.

## Conditions (APPROVED WITH CONDITIONS)

1. **Coordinate the owner field on the intake marker with phase-9.3b** before the provenance write
   lands, so the two features share one schema (ADR-2). Tracked to `/finish`.
2. **Enforce the naming boundary** — no bare `owner` for the operator concept anywhere near the lock
   code (ADR-1). Checked at code review.
3. **Fail-open is provisional** — re-evaluate fail-closed when an EKS platform identity is
   introduced (ADR-1 follow-up). Non-blocking now.
