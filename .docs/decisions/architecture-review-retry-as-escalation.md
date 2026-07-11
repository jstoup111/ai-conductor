# Architecture Review: retry-as-escalation (Medium — lightweight)

**Verdict: APPROVED for implementation.** One ADR
(`adr-2026-07-05-retry-as-escalation-ladder.md`) captures the load-bearing
decisions. No blocking feasibility concerns; the change attaches to existing seams.

## Feasibility check against the code map

- **Injection seam exists.** The retry loop resolves `(model, effort)` once, but the
  dispatch (`StepRunner.run`) already exposes an effort-override path and reads the
  model per call — so per-attempt overrides are threadable without restructuring the
  loop. ✅
- **Availability composition is free.** `StepRunner` already routes the chosen model
  through `ModelAvailability.effectiveModel`, so a deliberately-bumped model is
  automatically downgraded if that tier is dead. Escalation need not call #186's API
  directly. ✅
- **Ordering constants are net-new.** No effort-order or model-*tier* order exists
  today (only the flat availability *downgrade* ladder). These must be added; keep
  them separate from the availability ladder to avoid conflating downgrade-on-dead
  with upgrade-on-retry. ✅ (low risk)
- **Event + retro path exists.** `step_retry` is already persisted and read by
  `aggregateRetryHotspots`; adding optional escalation fields is backward-compatible. ✅
- **Config seam exists.** `StepConfig` + `knownStepKeys` allow-list + per-field
  validation is the established place for `escalate`; mirrors the `disable` boolean. ✅

## Risks flagged (addressed in the ADR / plan)

1. **Budget-floor vs. ladder reachability.** Cutting escalating deep steps to 2 would
   make the attempt-3 model rung unreachable. Floor at **3**. (ADR §Decision 4.)
2. **Non-consuming retry paths.** Escalation must derive from `attempt` so rate-limit /
   auth retries (which `attempt--`) don't spuriously escalate. (ADR §Decision 7.)
3. **HALT invariant.** The ladder must not add `continue`/`attempt--` past the budget;
   the last rung's failure must still reach the exhausted-retries HALT. (ADR §Decision 8.)
4. **Docs drift gate (test 5a).** Ladder prose must live outside the generated
   model-table markers in HARNESS.md, or be sourced from `model-table-metadata.ts` and
   regenerated. (Plan task.)
5. **Default-on behavior change.** `escalate` defaults true, so existing configs begin
   escalating. Warrants a CHANGELOG `## Migration` note documenting opt-out. (Plan task.)
