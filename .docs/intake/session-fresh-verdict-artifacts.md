# Intake: Step completion checks consume a stale verdict artifact across retries (#649)

Source: jstoup111/ai-conductor#649
Owner: jstoup111
Size (filed): S
Labels: bug, priority: critical

See the GitHub issue for the full WHAT/impact/desired-outcomes/non-goals. Spec re-scopes to a
deterministic per-attempt freshness floor for the three SHIP-tail verdict artifacts consumed by
STEP_COMPLETION_CHECKS (`architecture_review_as_built`, `prd_audit`, `build_review`). The issue's
stated premise that `sessionStartedAt` "is already in CompletionContext" and only needs a guard added
is corrected: the guard exists and uses `sessionStartedAt`, but that floor is the conductor-run start,
shared by all retries — hence the loop. See
`.docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md`.
