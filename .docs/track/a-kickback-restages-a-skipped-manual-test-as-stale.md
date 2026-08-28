# Track: a-kickback-restages-a-skipped-manual-test-as-stale

Track: technical

Scope boundary: Comprehensive (Approach C) — skip-preserving restage helper routed through all
four explicit restage sites (conductor.ts:5824, :7376, :7524, :10192), skip-awareness in
`--diagnose` (complete-verifier), plus a write-time invariant that surfaces any
`skipped → stale` transition at the point it is introduced. Read-side gate-file
reconciliation (Approach B) is excluded.

Engine state-machine correctness fix; no user-facing product behavior — acceptance criteria live in stories.
