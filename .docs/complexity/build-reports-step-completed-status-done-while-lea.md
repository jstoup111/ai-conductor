# Complexity: BUILD reports done while leaving its work uncommitted (#1270)

**Issue:** jstoup111/ai-conductor#1270 — "BUILD reports step_completed status:done while leaving its work uncommitted"
**Plan stem:** `build-reports-step-completed-status-done-while-lea`
**Relates to:** #1249 (retained stale `wiring_check` pass across a BUILD repair — adjacent, NOT
this spec's scope), #1269 (daemon parks on unsatisfied prerequisites instead of re-running them),
#1227 (pipeline commits files outside the active plan before scope review — bounds the
auto-commit option), `adr-2026-07-23-trailer-union-build-step-routing` and
`adr-2026-07-23-commit-movement-liveness-floor` (the two ADRs this one extends),
`adr-2026-07-25-content-addressed-full-suite-proof` (owns `test-suite-evidence.json`).

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | Minimal. One new optional injected probe on the existing `CompletionContext` (same shape as the established `ctx.wiringProbe` seam, `artifacts.ts:1710-1726`), and one additive optional field on the existing `FullSuitePassEvidence` / `FullSuiteFailEvidence` shapes (`full-suite-evidence.ts:28-71`). No new store, no new sidecar, no new step, no new gate. |
| Integrations | Four existing seams: the `build` completion predicate (`artifacts.ts:1747-1938`), the single shared context builder that feeds every evaluation (`conductor.ts:1191-1364` `completionCtx`), the budget-exhaustion success-seam escape (`conductor.ts:5640-5680`), and the suite-evidence writer (`full-suite-verifier.ts:649,799`). All pre-existing; no new wiring topology. |
| Auth / secrets | None. |
| State machines | None new. The existing build retry loop (`conductor.ts:4323-5030`) absorbs the new completion miss unchanged — the miss becomes `lastError`, feeds `buildRetryHint` (`conductor.ts:8038-8102`), and re-dispatches. `stepSatisfied` (`state.ts:140-143`) is untouched. |
| Story count | 8 (incl. five negative paths). Above the S ceiling of 5. |

## Rationale

**Medium.** The behavioral change is one conjunct in one predicate, but it sits on the single
most consequential routing decision in the engine and must be reconciled explicitly against
three live invariants that prior ADRs deliberately established:

1. `build_review` is the **sole completion authority** (#773, `adr-2026-07-21-completeness-as-build-review-rubric`). This spec must add a *routing* pre-filter without re-animating a predicate-level completion authority — the same line the trailer-union ADR walked.
2. **Commit movement is the liveness authority** (`adr-2026-07-23-commit-movement-liveness-floor`). Adding a blocking condition satisfied *only* by committing interacts directly with the stall breaker and, decisively, with that ADR's budget-exhaustion escape at `conductor.ts:5640-5680` — a second, gate-bypassing door to `status:done` that a predicate-only fix would leave wide open. Discovering and closing that door is the single largest correctness risk in this change.
3. The `build` predicate is evaluated on **four** distinct paths, not one — post-dispatch (`conductor.ts:4985`), the stall-handler recheck (`:5566`), a disk recompute (`:2035`), and the post-rebase closure check (`:7651`). `rebase.ts:590` runs `--autostash`, which can legitimately leave a reapplied-stash dirty tree, so an unscoped conjunct regresses the rebase closure path.

Those three reconciliations — not the code volume — are what put this above S. It introduces no
new mechanism, subsystem, or gate reader, and breaks no schema or CLI contract, which keeps it
out of L. Architecture + conflict-check artifacts are required at M and are included; the ADR
records the fail-direction, the untracked-file widening, and the scope boundary against #1249.

Not Large: additive, injection-shaped, reusing existing primitives (`worktreeStatus`,
`git status --porcelain`) that already ship in the engine; no migration, no config key, no
breaking surface.
