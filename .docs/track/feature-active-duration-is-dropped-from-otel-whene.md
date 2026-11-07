# Track: Feature active duration is dropped from OTEL whenever the timing rollup is partial

Track: technical

Scope boundary: Fix every observed cause of a partial feature timing rollup and send the measured
active duration whenever the rollup has one; never send a guessed value. Included: (1) the OTEL
metrics listener records `conductor.feature.duration.active` whenever `feature_shipped` carries an
`activeMs`, exact or partial, attributed with the timing state and a bounded partial-reason class;
(2) a shipped feature with no measurable active duration is counted, with that bounded reason, so
the gap is visible in the metrics backend instead of silent; (3) `feature_shipped` keeps the
rollup's partial reason instead of dropping it; (4) the timing rollup accepts persisted step events
whose lifecycle-step identity names a retired built-in step (`coverage_binding`), so pre-retirement
ledgers stop reading as active-evidence-incomplete; (5) a provider failure that returns before the
provider process starts (native-schema setup, git guard, readiness) is recorded as not invoked, so
it cannot demand observed intervals that never existed; (6) the remediation-closure judgement
dispatch supplies the native-schema scratch home every other native-schema auxiliary dispatch
supplies, so Codex can run it. Excluded: best-effort or estimated active durations on partial
rollups; changes to the rollup's fail-closed rules for genuinely open or malformed executions;
backfilling metrics for already-shipped features; wall-duration changes; dashboards.

Internal telemetry and engine defect fixes; no user-facing product requirements warrant a PRD.

## Approach decision

Evidence (2026-10-26): 115 of 225 `feature_shipped` events in `.daemon/events.jsonl` are partial,
13 of 13 since 2026-10-24. Replaying the rollup over live worktrees: recent ships are
`provider-evidence-incomplete` with a valid `activeMs` (18 invoked-but-intervalless Codex attempts,
all `remediation-closure-judgement` native-schema setup failures); older ones are
`active-evidence-incomplete`, every trigger a `coverage_binding` step event.

- **A — Fix each cause at its source; record measured time with a bounded reason (selected).**
  Every partial becomes either exact or an explained, counted gap. Est. effort: M, ~1 day.
  Impact: recent ships report exact active time again; remaining gaps are attributable.
- **B — Make the rollup tolerant.** Count invoked-without-intervals as zero provider time and
  unknown step identities as legacy keys. Rejected: it hides real evidence gaps, erodes the
  rollup's deliberate fail-closed design, and leaves Codex remediation-closure judgement broken.
  Est. effort: ~half day. Impact: metric returns with weaker trust.
- **C — Listener-only change.** Rejected by the operator during routing: it recovers
  `provider-evidence-incomplete` ships only and leaves every cause in place.
