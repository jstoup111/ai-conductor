# Track: Daemon reconciliation delays first feature dispatch

Track: technical

Scope boundary: Balanced. Move best-effort startup and per-tick maintenance (startup dashboard
reconcile, halt-PR reconciliation, parked reconciliation, provider-scratch sweep, mergeable-label
sweep) off the first-dispatch path into a single-flight background job, including at
concurrency 1. Run provider-backed CI-fix and autoresolve sessions as pool work that occupies a
worker slot instead of executing inline. Remove the duplicate parked reconcile in the startup
dashboard. Add a skip-unchanged input fingerprint for the parked reconciler only. Emit startup,
discovery, and per-reconciler phase durations on the existing event spine. Safety-critical checks
(discovery processed/shipped/parked dedup, `pickEligible` halted/parked checks, the
`guardedDispatch` park re-check, and pause/auth/gh-version gates) stay on the dispatch path.
Latency target, restated by the operator on 2026-10-14 because discovery alone measures
2.2–3.3 s (`pollDurationMs`, `.daemon/events.jsonl`): no reconciliation or maintenance runs
between scan start and the first claim, so the first dispatch begins within the startup origin
refresh plus one discovery plus 1 s. The intake's absolute 2 s figure is not a goal of this
feature; speeding up discovery goes to a follow-up intake. Excluded: incremental cursors for the halt-PR, mergeable, and discovery reconcilers; changing
default daemon concurrency (#568); time-budgeted resumable sweeps.

Internal daemon scheduling and observability with no product requirements; acceptance lives in stories.
