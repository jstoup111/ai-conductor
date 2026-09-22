# Track: Skip judged-gate re-dispatch after a kickback that leaves the code stamp valid

Track: technical

Scope boundary: all four stamped judged gates (`manual_test`, `prd_audit`, `architecture_review_as_built`, `build_review`) re-entered as `stale` after a kickback; excludes the rebase path (#2555) and `navigateBack` semantics.

Engine wiring defect against adr-2026-07-22 D2: the completion predicates already preserve a still-valid PASS, but the step loop only consults them pre-dispatch for `done` tree-attesting steps, so `stale` gates always pay for a fresh judge session.
