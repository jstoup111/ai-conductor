# Components: Measured feature active duration always reaches OTEL

**Last updated:** 2026-10-26
**Scope:** The path from a provider attempt to the `conductor.feature.duration.active` data point:
provider adapters → attempt metadata → per-feature `.pipeline/events.jsonl` → timing rollup →
`feature_shipped` → `MetricsListener` → `MetricsRecorder`. Plus the remediation-closure judgement
dispatch's native-schema scratch input. No new component, event variant, or ledger.

## Diagram

```mermaid
graph TD
    subgraph Adapters["src/conductor/src/execution/"]
        AD["claude / codex / pi provider invoke()<br/>pre-spawn returns (git guard, native-schema setup)<br/>stamp executionDisposition: not-started (NEW)"]
    end

    subgraph Exec["src/conductor/src/engine/"]
        SR["step-runners.ts<br/>remediation-closure judgement dispatch<br/>passes nativeSchemaScratch (NEW)"]
        PE["provider-execution.ts<br/>buildProviderAttemptMetadata<br/>invoked = not skipped AND not not-started (CHANGED)"]
        LEDGER[".pipeline/events.jsonl<br/>provider_attempt, step_* (exist)"]
        TR["timing-rollup.ts<br/>retired built-in step identity resolves (CHANGED)<br/>partial reason (exists)"]
        DR["daemon-runner.ts emitShipped<br/>feature_shipped.active: state, activeMs,<br/>reason class (NEW field;<br/>ledger-unreadable derived here)"]
    end

    subgraph otel["src/conductor/src/engine/otel/"]
        ML["MetricsListener feature_shipped<br/>passes activeMs whenever present (CHANGED)"]
        MR["MetricsRecorder.onFeatureDuration"]
    end

    subgraph Backend["Metric backend"]
        HIST["conductor.feature.duration.active<br/>tier (exists) + state, reason (NEW on this instrument)"]
        MISS["conductor.feature.duration.active.missing<br/>counter: tier, state, reason (NEW)"]
    end

    SR --> PE
    AD --> PE
    PE --> LEDGER
    LEDGER --> TR
    TR --> DR
    DR --> ML
    ML --> MR
    MR -->|activeMs present| HIST
    MR -->|no activeMs| MISS
```

## Legend

- **NEW / CHANGED** mark what this spec adds or alters; everything else exists on main.
- `state` is `exact`, `partial`, or `unavailable`. `reason` is a closed class set: `empty-active-union`, `active-evidence-incomplete`,
  `open-executions` (execution keys never become labels), `provider-outside-active-union`,
  `provider-evidence-incomplete`, `ledger-unreadable`. It is absent when the state is `exact`. Both reuse label names already in ADR-014's closed vocabulary.
- `activeMs` is present only when the active union is complete: state `exact`, or `partial`
  solely because the provider partition is incomplete. Every other `partial` and `unavailable`
  rollup carries no `activeMs` and increments the missing counter instead.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-26 | Initial generation | Spec: feature active duration is dropped from OTEL whenever the timing rollup is partial |
| 2026-10-26 | ledger-unreadable derived at the feature_shipped emit site | Conflict check: shipped-record Time block stays unchanged |
