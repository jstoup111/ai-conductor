**Status:** Accepted

> **Amended 2026-09-10 by operator:** Preserve ADR-014's single production
> metrics listener. `OtelVisualizer` remains spans-only in production and this
> feature must remove its dead duplicate metric work. The fallback reason from
> an unavailable preferred-provider attempt must survive later candidate
> observations and be exported when the successful fallback span closes.

# Stories: export-the-telemetry-dimensions-the-engine-already

Technical track, Tier M. Governing decisions: adr-014-otel-observability-exporter D10 (label placement contract) and D11 (dimensions ride existing events). Source: jstoup111/ai-conductor#1940. Spec owner is out of scope by operator decision.

## Story 1: Effort and tier ride the step close events

**Requirement:** adr-014 D11

As a telemetry consumer, I want a step's resolved reasoning effort and the run's complexity tier to be present on the step close event so that downstream projections can export them without re-reading config.

### Acceptance Criteria

#### Happy Path
- Given a step whose invocation resolved `effort: high` and a run whose `complexity_tier` is `M`, when the step completes, then the emitted `step_completed` event carries `effort: 'high'` and `tier: 'M'`
- Given a step whose invocation resolved `effort: low`, when the step fails, then the emitted `step_failed` event carries `effort: 'low'` and the run's tier

#### Negative Paths
- Given a step whose runner did not resolve an effort (no policy value), when the step completes, then `step_completed` carries no `effort` key at all rather than a placeholder string
- Given a run whose state has no `complexity_tier` yet, when a step completes, then `step_completed` carries no `tier` key rather than a defaulted tier
- Given a pre-existing `events.jsonl` line for `step_completed` with neither `effort` nor `tier`, when the event persister and the metrics listener replay it, then both accept the record and neither throws or drops it

### Done When
- [ ] `step_completed` and `step_failed` in the `ConductorEvent` union declare optional `effort` and `tier` fields with the existing `EffortLevel` and `ComplexityTier` types
- [ ] The `step_completed` emit site populates `effort` from the step result and `tier` from run state, omitting each key when its source is undefined
- [ ] A unit test asserts the emitted payload for a resolved effort/tier and asserts key absence for an unresolved one

## Story 2: Step duration and retry series are sliceable by model, effort, provider, and tier

**Requirement:** adr-014 D10

As an operator charting latency, I want `conductor.step.duration` and `conductor.step.retries` to carry `model`, `effort`, `provider`, and `tier` labels so that the effect of a model or effort change on step time is chartable.

### Acceptance Criteria

#### Happy Path
- Given a completed `build` step dispatched on `claude` with model `opus`, effort `high`, tier `M`, when the metrics listener records its duration, then the histogram data point carries attributes `step=build`, `model=opus`, `effort=high`, `provider=claude`, `tier=M` alongside the existing identity attributes
- Given a failed dispatch is followed by `step_retry`, when the retries counter is incremented, then the retry event and data point carry the failed attempt's resolved `model`, `effort`, and actual `provider`, plus the run's `tier`

#### Negative Paths
- Given a completed step whose event carries no `model`, when its duration is recorded, then the data point has no `model` attribute and no `unknown` value is emitted
- Given a completed step whose event carries no `actualProvider` and no matched `provider_attempt`, when its duration is recorded, then the data point has no `provider` attribute
- Given a `step_retry` that arrives before any `step_started` for its step, when the retries counter is incremented, then the point carries `step` and identity only and the listener does not throw

### Done When
- [ ] `MetricsRecorder` duration and retry recording accept a dimension set (`model`, `effort`, `provider`, `tier`) and merge only the defined members into the data-point attributes
- [ ] `step_retry` declares optional `model`, `effort`, `provider`, and `tier` fields and its emit site populates them from the failed attempt's result plus current run state; the metrics listener projects the retry directly from that event without relying on later observations
- [ ] A unit test asserts the exact attribute set on a duration point and a retries point for a fully resolved step, and asserts absence of each attribute when its source is undefined
- [ ] No attribute outside adr-014 D10's list appears on `conductor.step.duration` or `conductor.step.retries`

## Story 3: Dispatch counter distinguishes provider fallback

**Requirement:** adr-014 D10, D11

As an operator, I want `conductor.step.dispatches` to carry `provider` and `fallback` so that the rate at which dispatches fall back from the preferred provider is countable.

### Acceptance Criteria

#### Happy Path
- Given a step with preferred provider `codex` whose `provider_attempt` came from `claude`, when the attempt event is emitted and the dispatch is counted, then the event carries `preferredProvider=codex` and the data point carries `provider=claude` and `fallback=true` in addition to the existing `step` and `metering` attributes
- Given a step whose preferred and actual provider are both `claude`, when the dispatch is counted, then the data point carries `provider=claude` and `fallback=false`

#### Negative Paths
- Given a `provider_attempt` lifecycle row (`invoked: false`, `provider: 'provider-lifecycle'`), when the metrics listener receives it, then no dispatch is counted and `provider-lifecycle` never appears as a label value
- Given a step with no preferred provider recorded (routing inactive), when the dispatch is counted, then the data point carries `provider` but no `fallback` attribute
- Given a successful `provider_attempt` followed by the matching `step_completed` for the same step and provider, when both are observed, then exactly one dispatch is counted, not two

### Done When
- [ ] The `MetricsListener` `provider_attempt` handler records a dispatch through the existing dispatch-selection tracker instead of being a no-op
- [ ] `MetricsRecorder` dispatch recording carries `provider` and, when a preferred provider is known, `fallback`
- [ ] `provider_attempt` declares optional `preferredProvider`, populated at the attempt emit site, so `fallback` is projected at dispatch time without waiting for `step_completed`
- [ ] A unit test covers fallback true, fallback false, fallback omitted, lifecycle-row suppression, and single counting across attempt plus completion

## Story 4: Step spans carry the dispatch dimensions and the fallback reason

**Requirement:** adr-014 D10

As an operator inspecting a trace, I want the step span to carry model, effort, provider, preferred provider, tier, fallback, and the fallback reason so that a single slow or failed dispatch is fully attributable from the trace alone.

### Acceptance Criteria

#### Happy Path
- Given a completed step with model `sonnet`, effort `medium`, tier `S`, preferred provider `codex`, actual provider `claude`, when its span closes, then the span carries `conductor.model=sonnet`, `conductor.effort=medium`, `conductor.complexity_tier=S`, `conductor.provider=claude`, `conductor.provider.preferred=codex`, `conductor.fallback=true`
- Given a `provider_attempt` for that step with `fallbackReason: 'codex unavailable'`, when the span closes, then the span carries `conductor.fallback.reason='codex unavailable'`

#### Negative Paths
- Given a `provider_attempt` whose `fallbackReason` is absent, when the span closes, then the span has no `conductor.fallback.reason` attribute
- Given a `provider_attempt` for a step with no open span, when the visualizer receives it, then it is a warn-and-no-op and no span is created or thrown
- Given a step span, when it closes, then `conductor.fallback.reason` and the `TokenUsage` detail appear on no metric data point (span only)

### Done When
- [ ] `SpanManager` sets the D10 span attributes from `step_completed`/`step_failed` fields and from the `provider_attempt` observation on the open step span
- [ ] A unit test using the in-memory span exporter asserts the full attribute set for a fallback dispatch and the absence of `conductor.fallback.reason` when no reason was reported
- [ ] A unit test asserts the metric exporter output contains no `fallback.reason`, `usage.*`, or `cost.source` attribute on any series

## Story 5: Provider-reported usage detail is exported on the span

**Requirement:** adr-014 D10

As an operator, I want reasoning-output volume, turn count, provider-reported duration, and the cost source on the step span so that usage detail the engine already computes is no longer discarded.

### Acceptance Criteria

#### Happy Path
- Given a completed step whose `TokenUsage` has `reasoningOutput: 1200`, `numTurns: 7`, `durationMs: 84000`, `costSource: 'provider'`, when the span closes, then the span carries `conductor.usage.reasoning_output=1200`, `conductor.usage.turns=7`, `conductor.usage.duration_ms=84000`, `conductor.cost.source=provider`
- Given a completed step whose cost came from the rate card, when the span closes, then the span carries `conductor.cost.source=rate-card`

#### Negative Paths
- Given a Codex dispatch whose `TokenUsage` has no `durationMs` and no `costSource`, when the span closes, then neither `conductor.usage.duration_ms` nor `conductor.cost.source` is present and no zero is written
- Given a completed step with no `tokenUsage` at all, when the span closes, then no `conductor.usage.*` or `conductor.cost.source` attribute is present
- Given a `TokenUsage` whose `reasoningOutput` is `NaN`, when the span closes, then `conductor.usage.reasoning_output` is omitted

### Done When
- [ ] `SpanManager` sets the four usage attributes only for finite, present `TokenUsage` members
- [ ] A unit test asserts presence for a full `TokenUsage` and absence for a Codex-shaped one, a missing one, and a non-finite member

## Story 6: Daemon and interactive metric paths export the same dimensions

**Requirement:** architecture review condition C1, adr-014 D11

As an operator running both daemon dispatches and interactive runs, I want the same event sequence to produce identical metric attribute sets from the daemon `MetricsListener` and the interactive visualizer so that dashboards do not depend on which path ran the step.

### Acceptance Criteria

#### Happy Path
- Given one recorded event sequence (`step_started`, `provider_attempt`, `step_completed` with model, effort, tier, providers), when it is replayed through the daemon metrics listener and through the interactive visualizer against two in-memory metric exporters, then the duration, retries, and dispatches data points have identical attribute key/value sets on both paths (identity attributes aside)

#### Negative Paths
- Given the same sequence with `effort` and `tier` removed from `step_completed`, when replayed through both paths, then both omit `effort` and `tier` and neither substitutes a default
- Given a metrics handler that throws while merging attributes, when the event is delivered, then the failure is swallowed as best-effort on both paths and the run continues

### Done When
- [ ] One test replays a fixture event sequence through both projections and asserts attribute-set equality per instrument
- [ ] The interactive visualizer's dispatch recording passes the same dimension set as the listener rather than dropping `model`
