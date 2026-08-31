**Status:** Accepted

# Stories: exported-telemetry-carries-no-cost-signal-so-spend

Source-Ref: jstoup111/ai-conductor#1936. Technical track, Tier S. Scope: step-level cost
telemetry in `MetricsRecorder` only — feature-level metrics, span attributes, and
provider/effort dimensions are out of scope (#1934, #1940).

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
