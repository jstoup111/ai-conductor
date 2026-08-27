**Status:** Accepted

# Stories: exported-telemetry-carries-no-cost-signal-so-spend

Source-Ref: jstoup111/ai-conductor#1936. Technical track, Tier S. Scope: step-level cost
telemetry in `MetricsRecorder` only — feature-level metrics, span attributes, and
provider/effort dimensions are out of scope (#1934, #1940).

## Story 1: Step cost is exported as its own USD counter

As an operator, I want the engine's computed dispatch cost exported as a `conductor.step.cost`
counter so that I can chart spend per step and per model without re-deriving prices from token
counts and the rate card.

### Acceptance Criteria

#### Happy Path
- Given a step closes with `tokenUsage.costUsd` a finite number and `costSource: 'provider'`, when `MetricsRecorder.onStepClose` runs, then `conductor.step.cost` records that exact `costUsd` value with attributes `{ step, source: 'provider' }` (plus `model` when a model was provided)
- Given a step closes with `costUsd` finite and `costSource: 'rate-card'`, when metrics are recorded, then the cost data point carries `source: 'rate-card'` so rate-card estimates are separable from provider-reported actuals
- Given a step closes with `costUsd: 0` reported by the provider, when metrics are recorded, then a cost data point with value 0 IS recorded (a genuine zero-cost observation, distinct from absence)

#### Negative Paths
- Given a step closes with `tokenUsage` present but `costUsd` absent, when metrics are recorded, then NO `conductor.step.cost` data point is produced (no zero-fill, no NaN) while token data points record as before
- Given a step closes with `costUsd: NaN` or `costUsd: Infinity`, when metrics are recorded, then NO cost data point is produced
- Given a step closes with `costUsd` finite but `costSource` absent, when metrics are recorded, then the cost data point is still recorded and the `source` attribute is omitted rather than invented

### Done When
- [ ] `conductor.step.cost` Counter (unit `usd`) is created in the `MetricsRecorder` constructor and recorded in `onStepClose`
- [ ] Unit tests assert: finite cost recorded with step/model/source attributes; zero recorded; absent/NaN/Infinity produce no data point; absent `costSource` omits the attribute
- [ ] Existing token/duration/retry recording behavior is unchanged by the new instrument (existing MetricsRecorder tests still pass)

## Story 2: Dispatch metering classification is positively visible

As an operator, I want a `conductor.step.dispatches` counter tagged with the engine's metering
classification so that a dispatch with no cost series is distinguishable as unmetered rather than
ambiguous absent data.

### Acceptance Criteria

#### Happy Path
- Given a step closes with `costUsd` finite, when `onStepClose` runs, then `conductor.step.dispatches` adds 1 with attributes `{ step, metering: 'fully-metered' }`
- Given a step closes with `tokenUsage` present but no finite `costUsd`, when `onStepClose` runs, then `conductor.step.dispatches` adds 1 with `metering: 'cost-unmetered'`
- Given a step closes with no `tokenUsage` at all, when `onStepClose` runs, then `conductor.step.dispatches` adds 1 with `metering: 'unmetered'`

#### Negative Paths
- Given a step closes with no `tokenUsage`, when `onStepClose` runs, then the `unmetered` dispatch data point is recorded even though no token and no cost data points exist for that close — the classification does not depend on the cost path having run
- Given the classification is computed, when the dispatch counter records, then the `metering` attribute value comes from `classifyMetering` in `engine/metering.ts` rather than a re-implemented predicate, so the two can never disagree

### Done When
- [ ] `conductor.step.dispatches` Counter is created in the `MetricsRecorder` constructor and adds exactly 1 per `onStepClose` call with a `metering` attribute
- [ ] `MetricsRecorder` imports and calls `classifyMetering` for the attribute value (no duplicate classification logic)
- [ ] Unit tests cover all three classifications, including the no-tokenUsage close producing only duration + dispatch data points
