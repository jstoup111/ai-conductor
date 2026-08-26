# Architecture Review: OVER_SCOPE multi-finding decision block
**Date:** 2026-08-24
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track, Tier M — lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Stack-compatible: TypeScript engine only, no new dependencies, services, or infrastructure.
Integration surface (all verified by direct read / delegated sweep, confidence: verified):
- `src/conductor/src/engine/accepted-widenings.ts` — marker render, cleared-body reader, record
  read/write, `overScopeCriterionIsAccepted`.
- `src/conductor/src/engine/conductor.ts` — `routePrdAuditOverScope` (:653), the lazy harvest
  `routeCurrentPrdAuditOverScope` (:2926, the only production caller of the cleared-body reader),
  and two halt-emission sites (:5930 serial tail, :7711 concurrent SHIP join) that must change
  in lockstep.
- `src/conductor/src/engine/artifacts.ts` — prd_audit completion predicate (:2869) shares
  `overScopeCriterionIsAccepted`; must also consult refusals for halt-text routing while a
  refused criterion continues to block.
- Events: one new spine event for decision recording; `EVENT_SINKS` is total, so it fails
  compilation until declared.
No schema/config/migration surface outside `.pipeline/` state (per-worktree, not a release
surface); the halt-body grammar break is operator-accepted pre-v1.

## Alignment

Full repo-wide ADR sweep run (497 files, delegated, full pass): 43 bearing ADRs; constraints
folded into adr-2026-08-24-over-scope-decision-block-and-durable-refusals (DRAFT, this review).
Key alignment points:
- Halt body composed into `writeHaltMarker` only (adr-2026-07-28 D5); prose + operator lever
  retained beside the fenced block (adr-2026-08-08, adr-2026-08-05).
- Machine clears inert: `pending` default records nothing (adr-2026-08-19 D6 anti-laundering).
- Decisions carry rationale + machine-resolved operator identity (adr-2026-08-09 D2,
  adr-2026-07-01) and project into the verdict/shipped record (adr-2026-08-22 D8,
  adr-2026-08-13 §6).
- Evidentiary defects fail closed with a named event, never silent null (adr-2026-08-24
  evidentiary-defects).
- Naming collision with the commit-trailer `Scope:` widening harvest stated explicitly in the
  ADR (adr-2026-08-09 hook-owned-containment-event-ledger Concern 2).
- **Operator-authorized departures (2026-08-24, recorded in the ADR):** no legacy marker
  reader and no old-record-shape support (departs adr-2026-08-11 retirement contract and the
  adr-2026-07-26 upgrade-in-place pattern); schema overwritten in place under `version: 1`
  rather than bumped. Basis: feature not live for any consumer; in-flight old-form state loss
  accepted.
- Amendments written now (DECIDE-owned, adr-2026-08-04): adr-2026-08-22 decision 4 (fourth
  disposition: durable refusal) and adr-2026-08-13 §4 (second, weaker acceptance channel with
  compensating controls).

Pattern basis (focused local precedent): the fenced-JSON-in-artifact + wholesale-parse shape
follows the recorded-findings block (`recordedPrdAuditFindingsBlock`, conductor.ts) and the
tolerant versioned `.pipeline/` ledger conventions (adr-2026-07-26 cross-dispatch-kickback).
Allowed variation: field names and the decision vocabulary. Rediscovery seeds: symbols
`renderOverScopeAcceptanceCandidate`, `acceptClearedOverScopeHalt`, `ACCEPTED_WIDENINGS_PATH`.

## Wiring Surface

- Decision-block renderer → called from both conductor halt-emission sites (serial tail and
  SHIP-join) via the body passed to `writeHaltMarker`.
- Wholesale cleared-body reader + decision recorder → invoked from
  `routeCurrentPrdAuditOverScope` on the conductor's next prd_audit lap (existing lazy-harvest
  seam; no new entry point).
- Refusal-aware blocking predicate → consumed by `routePrdAuditOverScope` and the prd_audit
  completion predicate in `artifacts.ts` (shared single definition, as today).
- New decision-recorded event → declared in `EVENT_SINKS`, persisted by `EventPersister` to
  `.pipeline/events.jsonl` like every spine event.
- Docs (same PR): `docs/reference/artifacts.md` (`over-scope` in the HALT.class table; decisions
  file inventory), `docs/runbooks/stalled-or-stuck-feature.md` (over-scope clear procedure —
  never `rm -f` the body), `docs/explanation/gates.md`, `skills/daemon-triage/SKILL.md`
  (over-scope row).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Operator hand-edits malformed JSON in the block | Data | Medium | Medium | Fail-closed named refusal + event; re-halt states the defect; nothing recorded |
| Two emission sites drift apart again | Technical | Medium | Medium | Extract one shared render/select helper; both sites call it |
| `over-scope` class unrecognized by daemon triage → treated as mechanical, swept | Integration | Medium | High | Docs/skill row added same PR; `pending` default makes a machine sweep inert anyway |
| Runbook `rm -f HALT` destroys decision body before harvest | Knowledge | Medium | Medium | Runbook gains the over-scope procedure (clear via rename path, not rm) |
| Recording write failure thrown into halt/clear seam | Technical | Low | High | Best-effort write, never throws (adr-2026-07-11 D1); defect surfaced via event |
| prd_audit re-run clobbers recorded decisions | Data | Low | High | Decisions file has one writer (harvest); audit artifacts never rewrite it (adr-2026-08-09 recorded-red amendment read-across) |

## ADRs Created

- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (DRAFT → pending operator
  approval)

Amended (additive notes): `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`,
`adr-2026-08-13-stable-build-review-finding-dispositions`.

## Conditions

1. Both halt-emission sites call one shared selection/render helper (no duplicated logic).
2. The blocking predicate (outside-visible ∧ undecided) is defined once and shared by router,
   completion predicate, and emission.
3. Decision recording emits its spine event and never throws into the halt/clear seam.
4. Docs listed under Wiring Surface land in the same PR.
5. `plan-gap`/`over-scope` documentation gap in `docs/reference/artifacts.md` HALT.class table
   fixed in the same PR (pre-existing, but this feature touches the surface).
