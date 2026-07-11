# Complexity: manual-test-fail-routing

Tier: M

## Signals
- MODELS: 0 (one new pipeline marker file, no data model)
- INTEGRATIONS: 0 (internal engine + one skill doc)
- AUTH: 0
- STATE_MACHINES: 1 (the FAIL-observed → fix-evidence → PASS gate transition is a small
  but real state machine layered on the tail loop's kickback budget)
- STORIES: ~7

## Rationale
Touches the engine's core gate loop across three coordinated surfaces — step topology
(`steps.ts` enforcement flip), the daemon failure-routing block in `conductor.ts` (new
manual_test remediation route beside prd_audit/finish/as-built), and the completion gate in
`artifacts.ts` (fix-evidence + latest-attempt parsing) — plus the manual-test skill contract.
Wrong behavior here false-ships features or dead-locks the tail, and the incident class it
fixes escaped precisely because coverage was thin, so Medium-tier rigor (conflict-check,
lightweight architecture review, acceptance specs, pipeline build) applies. Operator
confirmed M on 2026-07-06.
