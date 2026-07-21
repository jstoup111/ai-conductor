# Architecture Review: Post-rebase delta-aware gate invalidation (#655)

**Date:** 2026-07-20
**Mode:** Lightweight (Medium tier — Feasibility + Alignment)
**Track:** technical
**Input reviewed:** explore output (`.pipeline/explore-notes.md`), sequence diagram
(`.docs/architecture/sequences/2026-07-20-post-rebase-delta-aware-invalidation.md`), issue #655
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript in the existing conductor engine; no new deps, services, or infra. |
| Prerequisites | None. `preTree` and `mergeBase` are already resolved in `performRebase` (`rebase.ts:422-423`); `changedCodePaths` already computed. |
| Integration surface | `rebase.ts` (`applyRebaseVerdicts`, `classifyClean`/`RebaseOutcome`), `conductor.ts` (`advanceTail` rebase branch), `types/events.ts` (2 new events), one new pure module for the gate→surface map + delta partitioner. Contained to one subsystem. |
| Data implications | None — no schema, no persistence beyond the existing verdict files + event log. |
| Performance risk | Adds one `git diff --name-only mergeBase..preTree` per rebase (cheap, name-only) and set intersections over a handful of paths. Negligible against the 20–30 min it saves. |
| Worktree isolation | Operates within the feature worktree's own git state; no shared resources, ports, or DBs. Safe under parallel worktrees. |

**Delta captures main-side changes — VERIFIED.** `classifyClean` diffs `preTree..HEAD`
(`rebase.ts:435/505`), a tree-to-tree diff in which the feature's own commits cancel, so main-side
churn + conflict resolutions surface in `changedCodePaths`; docs/CHANGELOG already excluded
(`rebase.ts:164`). The raw material for a sound delta already exists (~92% confidence).

## Alignment

- **Deterministic-where-possible principle (CLAUDE.md):** the design pushes the decision into a
  pure, git-derived function with a declarative surface map — no prompt discipline, no LLM judgement
  in the invalidation decision. Aligns exactly.
- **ADR-2026-07-08 (build pre-verify):** consistent extension. That ADR narrowed the *mechanical*
  `build` gate via re-verification; this ADR handles the *judged* gates (no mechanical predicate) by
  a delta∩surface=∅ preservation test. `build` is explicitly left on its existing pre-verify path —
  no overlap, no regression. The ADR-2026-07-08 invariant "rebased tree ≠ approved tree → re-verify"
  is preserved via fail-closed (any gate whose surface the delta cannot be proven to miss re-runs).
- **`wiring_check` unconditional invalidation (Task 11):** subsumed correctly — `wiring_check`'s
  surface is the whole runtime tree, so it re-runs on any runtime delta (today's behavior) and is
  preserved only on a test/docs-only delta, which cannot change reachability. No weakening.
- **State management:** preservation is expressed as leaving the gate `done` and delta-gating the
  `markDownstreamStale` sweep — it reuses the existing gate-state enum and verdict files; introduces
  no new implicit state or boolean flags. The two new events mirror the existing
  `rebase_gate_reverified` shape.
- **Non-goal boundaries respected:** does not touch verdict-freshness (#649/#652) or retry
  classification (#646/#653) — governs only the invalidation *set*.

## Domain Integrity

Handled per-cycle by the TDD domain reviewer (lightweight tier). One design-time note: the delta
partition (`D_test` / `D_featureSrc` / `D_foreignSrc`) and the gate→surface map should be modeled as
explicit named types over path sets, not raw string arrays passed positionally, so the soundness
invariant is legible at the call site. Deferred to `/plan` + TDD.

## Wiring Surface (design-time)

Carried in the ADR's "Wiring Surface" section: (1) two new events emitted from `applyRebaseVerdicts`
+ the delta-gated sweep, consumed by the existing event bus / kickback-log surface (same path as
`rebase_gate_reverified`, `conductor.ts:5762`); (2) a new pure `classifyGateInvalidation(D, F,
ranManualTest)` module called from `rebase.ts:780` and the `advanceTail` rebase branch
(`conductor.ts:5291`); (3) `F` computed in `performRebase` and threaded onto `RebaseOutcome.changed`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Surface map under-declares a gate's real input → stale verdict preserved against a changed tree | Correctness | Medium | High | Soundness invariant (conservative superset); `manual_test`/`wiring_check` scoped to whole runtime tree; fail-closed on uncomputable delta; assert preserve/re-run in tests per gate. |
| Feature-scoping `prd_audit`/`arch_review` to `F` misses a foreign dependency change that alters an FR | Correctness | Low | Medium | ADR assumption logged (~85%); may widen to declared dependency paths; headline #642 case sound regardless; fail-closed backstop. |
| Delta-gated downstream sweep incorrectly restores a gate that a non-rebase kickback wanted stale | Correctness | Low | Medium | Gate the delta-aware sweep strictly to `kickback.from === 'rebase'` (mirrors ADR-2026-07-08's "kickbacks with from ≠ rebase never pass through" invariant); cover in tests. |

No High-likelihood risks; the one High-impact risk is mitigated by the soundness invariant + fail-closed.

## ADRs Created

- `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` — **APPROVED**. Amends
  `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` (extends delta-awareness to the
  judged tail; build pre-verify unchanged).

## Verdict

**APPROVED.** The design is feasible within the existing engine, aligns with the deterministic-first
principle and the prior post-rebase ADRs, and is correctness-safe under its soundness invariant +
fail-closed fallback. Proceed to `/stories`.
