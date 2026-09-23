# Track: Finish fence rejects a fresh PASS for a gate the last rebase preserved

Track: technical

Scope boundary: Minimal — `rebaseOperationPublicationBlocker` accepts a preserved gate whose verdict is a fresh satisfied re-judgement (satisfied, no kickback, `checkedAt` newer than the applied rebase record) in place of the replay-bound stamp; unsatisfied or stale-unstamped verdicts still block. Plus one additive optional `appliedAt` stamp on the rebase operation record so the comparison survives later rebase-verdict rewrites, with fallback to the rebase verdict `checkedAt` for legacy records. No recovery CLI, no writer-side retirement of `transition.preserved`.

Engine fence logic only; no user-facing product behaviour, so no PRD.
