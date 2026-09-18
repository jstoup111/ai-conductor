**Status:** Accepted

# Stories: feature-cost-and-shipment-metrics-cannot-be-groupe

Technical track, Tier M. Governing decision: adr-014-otel-observability-exporter D14 (complexity tier on feature-scoped instruments, carried by the feature events), with D10/D11 as precedent. Source: jstoup111/ai-conductor#2528. Scope boundary per the track marker: the feature-scoped instruments only; no listener-side inference, no new instruments, no Grafana edits.

## Story 1: Daemon-emitted feature events carry the feature's tier

**Requirement:** adr-014 D14

As a telemetry consumer, I want the daemon's feature dispatch, halt, and shipped events to state the feature's complexity tier so that feature-level projections can label their data points without a second read.

### Acceptance Criteria

#### Happy Path
- Given a backlog item whose committed complexity marker parsed to `M`, when the daemon begins its dispatch, then the emitted `feature_dispatch_started` carries `tier: 'M'` alongside its existing `slug` and `kind`
- Given that same dispatch halts with a halt class and a halting step, when the daemon ends the dispatch, then the emitted `feature_dispatch_ended` carries `tier: 'M'` alongside `outcome`, `haltClass`, and `step`
- Given that same feature ships, when the daemon emits `feature_shipped`, then the event carries `tier: 'M'` alongside `runStartedAt` and `active`

#### Negative Paths
- Given a backlog item with no parseable complexity marker, when the daemon begins its dispatch, then `feature_dispatch_started` carries no `tier` key at all — not `M`, not `L`, not an empty string
- Given a backlog item with no parseable complexity marker, when the dispatch ends with any outcome, then `feature_dispatch_ended` carries no `tier` key
- Given a backlog item with no parseable complexity marker, when the feature ships, then `feature_shipped` carries no `tier` key even though the site reads `conduct-state.json` for `runStartedAt`
- Given a pre-existing `events.jsonl` line for `feature_dispatch_ended` with no `tier`, when the event persister and the metrics listener replay it, then both accept the record and neither throws or drops it

### Done When
- [ ] `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped` in the `ConductorEvent` union declare an optional `tier` field typed `ComplexityTier`
- [ ] Each of the three daemon emit sites populates `tier` from the backlog item's parsed tier and omits the key when that value is undefined
- [ ] A unit test asserts `tier` on all three emitted payloads for a tiered item and asserts key absence on all three for an untiered item

## Story 2: In-run feature cost events carry the run's tier

**Requirement:** adr-014 D14

As a telemetry consumer, I want the feature usage total and every cost snapshot to state the run's complexity tier so that cumulative cost can be attributed to a tier at the moment it is recorded.

### Acceptance Criteria

#### Happy Path
- Given a run whose state holds `complexity_tier: 'S'`, when the `finish` step closes and the feature usage total is emitted, then `feature_usage_total` carries `tier: 'S'` alongside its existing cost and dispatch counts
- Given a `step_completed` that carries `tier: 'L'`, when its terminal delivery triggers the cost snapshot, then the emitted `feature_cost_snapshot` carries `tier: 'L'` — the same value as the step event that triggered it
- Given a `step_failed` that carries `tier: 'M'`, when its terminal delivery triggers the cost snapshot, then the emitted `feature_cost_snapshot` carries `tier: 'M'`

#### Negative Paths
- Given a run whose state has no `complexity_tier`, when the usage total is emitted at `finish`, then `feature_usage_total` carries no `tier` key rather than the `L` that skip policy would resolve
- Given a `step_completed` with no `tier` key, when its terminal delivery triggers the cost snapshot, then `feature_cost_snapshot` carries no `tier` key
- Given a `step_completed` with `tier: 'M'` whose ledger read fails, when terminal delivery runs, then no snapshot is emitted at all and the step's verdict is unchanged — the tier does not cause a partial snapshot to appear

### Done When
- [ ] `feature_usage_total` and `feature_cost_snapshot` in the `ConductorEvent` union declare an optional `tier` field typed `ComplexityTier`
- [ ] The usage-total emit site populates `tier` from run state and the snapshot builder accepts the triggering step event's tier, each omitting the key when its source is undefined
- [ ] A unit test asserts `tier` on both payloads for resolved sources and asserts key absence for unresolved sources

## Story 3: Feature activity and outcome series are sliceable by tier

**Requirement:** adr-014 D14

As an operator charting throughput and halt rates, I want `conductor.feature.dispatches`, `conductor.feature.halts`, `conductor.run.outcomes`, `conductor.feature.shipped`, and both `conductor.feature.duration` histograms to carry a `tier` label so that S/M/L cohorts can be compared directly.

### Acceptance Criteria

#### Happy Path
- Given a resolved run tier, when the conductor completes or halts, then its existing `feature_complete` or `loop_halt` event carries that raw tier and the listener records one `conductor.run.outcomes` point with the corresponding outcome and tier
- Given that terminal event followed by `feature_dispatch_ended` for the same dispatch, when both are delivered in production order, then the outcome count stays one and retains the terminal event's tier; dispatch-end still records its applicable halt metric
- Given an interactive run with no daemon dispatch-end, when it completes or halts, then its terminal event alone records the tiered outcome
- Given a `feature_dispatch_started` with `tier: 'M'` and `kind: 'fresh'`, when the metrics listener records it, then the `conductor.feature.dispatches` point carries `kind=fresh` and `tier=M` alongside the identity attributes
- Given a `feature_dispatch_ended` with `tier: 'L'`, `outcome: 'halted'`, a halt class, and a step, with no preceding terminal event, when the listener records it, then the `conductor.feature.halts` point carries `haltClass`, `step`, and `tier=L`, and the `conductor.run.outcomes` point carries `outcome=halted` and `tier=L`
- Given a `feature_shipped` with `tier: 'S'`, `runStartedAt`, and an exact active duration, when the listener records it, then the `conductor.feature.shipped` point and both `conductor.feature.duration.wall` and `.active` points carry `tier=S`

#### Negative Paths
- Given unresolved run state (including an early halt), when the terminal event is emitted, then neither that event nor its outcome point contains a tier key; no policy default or listener inference fills it
- Given tierless terminal records from an older ledger, when replayed through the existing event path, then they remain accepted and record tierless outcomes
- Given a `feature_dispatch_started` with no `tier` key, when the listener records it, then the `conductor.feature.dispatches` point has no `tier` attribute and no placeholder value
- Given a `feature_dispatch_ended` with no `tier` key that halted and no preceding terminal event, when the listener records it, then neither the `conductor.feature.halts` point nor the `conductor.run.outcomes` point has a `tier` attribute
- Given a `feature_shipped` with `tier: 'S'` whose `active.state` is `partial`, when the listener records it, then the wall histogram point carries `tier=S` and no active-duration point is recorded at all — the tier does not cause a fabricated active duration

### Done When
- [ ] Both terminal event variants declare optional `tier?: ComplexityTier`; completion reads `state.complexity_tier` and the centralized halt helper reads `haltState.complexity_tier`
- [ ] Conductor-entry regression coverage proves normal complete/halt production order through the listener and exporter, exactly one outcome, interactive terminal-only behavior, dispatch-end fallback, and unresolved/legacy tier absence
- [ ] `MetricsRecorder.onFeatureDispatch`, `onFeatureHalt`, `onRunClose`, `onFeatureShipped`, and `onFeatureDuration` accept an optional tier and merge it into the data-point attributes only when defined
- [ ] The `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped` handlers in the metrics listener pass the event's tier to every recorder call they make
- [ ] A unit test asserts the exact attribute set on each of the six instruments for a tiered event and asserts absence of `tier` for an untiered event

## Story 4: Feature cost series are sliceable by tier and agree with step series

**Requirement:** adr-014 D14

As an operator charting spend, I want `conductor.feature.cost`, `conductor.feature.step.cost`, and `conductor.feature.step.tokens` to carry a `tier` label that matches the step series for the same dispatch so that cost by size can be read directly and the two projections never disagree.

### Acceptance Criteria

#### Happy Path
- Given a `feature_cost_snapshot` with `tier: 'M'`, when the listener records it, then the `conductor.feature.cost` point carries `cost_complete` and `tier=M`, and every `conductor.feature.step.cost` and `conductor.feature.step.tokens` point from the same snapshot carries `tier=M` alongside its existing `step`, `model`, `source`, and `kind` attributes
- Given a `feature_usage_total` with `tier: 'S'`, when the listener records it, then the `conductor.feature.cost` point carries `tier=S`
- Given a `step_completed` with `tier: 'M'` for step `build` that flows through terminal delivery into a snapshot, when both the step duration point and the feature cost point are recorded, then both carry `tier=M`

#### Negative Paths
- Given a `feature_cost_snapshot` with no `tier` key, when the listener records it, then no point from that snapshot has a `tier` attribute
- Given a `feature_usage_total` with no `tier` key, when the listener records it, then the `conductor.feature.cost` point has no `tier` attribute
- Given a `feature_cost_snapshot` with `tier: 'M'` whose `costUsd` is not finite, when the listener records it, then no `conductor.feature.cost` point is recorded — the tier does not cause a non-finite value to be exported

### Done When
- [ ] `MetricsRecorder.onFeatureCostSnapshot` and `onFeatureUsageTotal` read the event's tier and merge it into every data point they record only when defined
- [ ] A unit test asserts `tier` on the cost gauge point and on a per-dimension cost point and a per-dimension tokens point from one snapshot, and asserts absence when the event carries no tier
- [ ] A unit test drives a tiered `step_completed` through terminal delivery and asserts the resulting snapshot point and the step duration point carry the same `tier`

## Story 5: Only feature-scoped instruments gain the tier label

**Requirement:** adr-014 D14

As a dashboard owner relying on the closed label set, I want instruments outside D14's list to keep exactly their current attributes so that existing queries and series identities are unchanged.

### Acceptance Criteria

#### Happy Path
- Given a metrics recorder bound to a feature whose events all carry `tier: 'M'`, when `memory_setup`, `gate_verdict`, `kickback`, and `pipeline_closeout` events are recorded for that feature, then none of the resulting `conductor.memory.setup`, `conductor.gate.verdicts`, `conductor.gate.kickbacks`, or `conductor.pipeline.closeout.duration` points carries a `tier` attribute
- Given the same recorder, when a `daemon_backlog_snapshot` is recorded, then no `conductor.daemon.*` point carries a `tier` attribute

#### Negative Paths
- Given a recorder constructed with an `otel.attributes` map containing the key `tier`, when any feature event is recorded, then the custom `tier` value is not present on the point and the conductor-owned tier (or its absence) is what the point carries
- Given a feature event with `tier: 'M'`, when it is recorded, then the exported attribute set for that point is exactly today's set plus `tier` — no other new key appears

### Done When
- [ ] `tier` is passed to feature methods as an explicit parameter and is never added to the recorder's identity attributes
- [ ] `tier` is treated as a conductor-owned label that an operator-supplied attribute map cannot supply
- [ ] A unit test asserts a non-feature point carries no `tier` while a feature point recorded by the same recorder does, and a test asserts a custom `tier` attribute is dropped
