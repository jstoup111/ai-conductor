**Status:** Accepted

# Stories: Exported cost equals the feature's own ledger, on any backend

**Source:** jstoup111/ai-conductor#2095 (absorbs jstoup111/ai-conductor#2086; technical track —
criteria derived from the technical intent + adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
and adr-014-otel-observability-exporter as amended 2026-08-30)

## Story 1: Whole-feature cost export tracks the feature's ledger at every step close

As an operator reading a cost dashboard, I want the exported whole-feature cost to equal the
feature's own event-ledger total at every step close so that the number I act on is the number the
finish line and shipped record will report, however many daemon lifetimes the feature spanned.

### Acceptance Criteria

#### Happy Path
- Given a feature whose event ledger holds three fully-metered dispatches costing $1.20, $0.80, and $2.00, when the third step closes, then the exported `conductor.feature.cost` gauge for that feature carries the value 4.00 (within 0.0001) with attributes `project`, `feature`, and `cost_complete=true`
- Given a feature whose first engine run halted after dispatches totalling $2.10 and whose second run is a fresh process on the same worktree, when the second run's first step closes after a $1.40 dispatch, then the exported whole-feature cost is 3.50, not 1.40
- Given a feature with several consecutive step closes, when the exported values are read in order, then each value is greater than or equal to the previous one
- Given a feature that reaches `finish`, when the finish-time usage total is emitted, then the `conductor.feature.cost` value equals the `cost_usd` the shipped record renders from the same ledger (within 0.0001) and the existing finish-line log text is unchanged
- Given the current export identity contract, when any cost point is exported, then it carries `project` and `feature` attributes and no run identifier on any label

#### Negative Paths
- Given a worktree with no `.pipeline/events.jsonl`, when a step closes, then no `conductor.feature.cost` data point is exported (no zero is recorded) and the step's own verdict and the run's progress are unchanged
- Given an event ledger with one malformed line, when a step closes, then no `conductor.feature.cost` data point is exported for that close and the step completes normally with no thrown error surfaced to the run
- Given a feature whose ledger holds one fully-metered dispatch and one dispatch that reported no usage at all, when a step closes, then the exported value equals the metered dispatch's cost and carries `cost_complete=false`
- Given a feature whose worktree was recreated from its branch so the ledger holds only dispatches after recreation, when a step closes, then the exported value equals that shorter ledger's total (the same figure the finish line and shipped record will report), not a higher earlier value
- Given a step that fails rather than completes, when the failure is recorded, then the whole-feature cost export for that close still reflects every dispatch the ledger holds, including the failed step's provider attempts

### Done When
- [ ] A test proves the exported `conductor.feature.cost` value after each step close equals the ledger rollup total and is non-decreasing across closes
- [ ] A test proves a second visualizer/run started over the same worktree ledger exports the cumulative total including the first run's dispatches
- [ ] A test proves a missing or malformed ledger yields no cost data point and no run failure
- [ ] A test proves the finish-time total and the step-close total are the same gauge value for the same ledger

## Story 2: Per-step, per-model, per-source cost is exact and provider-agnostic

As an operator asking where spend goes, I want a cumulative cost series per step, model, and cost
source that is exact against the ledger so that per-step, per-model, and per-project views agree with
the feature total and with each other.

### Acceptance Criteria

#### Happy Path
- Given a feature whose ledger holds `build` dispatches of $1.00 and $0.50 on model `m1` and a `build_review` dispatch of $2.00 on model `m2`, when the latest step closes, then `conductor.feature.step.cost` carries one point per bucket: 1.50 for {step=build, model=m1} and 2.00 for {step=build_review, model=m2}, each also carrying `project`, `feature`, and `source`
- Given any exported set of `conductor.feature.step.cost` points for a feature at one step close, when their values are summed, then the sum equals that close's `conductor.feature.cost` value (within 0.0001)
- Given one dispatch whose cost was reported by the provider and one whose cost came from a rate card, when the step closes, then the two contribute to separate buckets distinguished by `source=provider` and `source=rate-card`, and both are included in the whole-feature total
- Given dispatches served by different providers (for example a provider that reports cost natively and one priced from a rate card), when the step closes, then every dispatch contributes through the same rollup with no provider-specific exception, and the bucket values match a by-hand sum of the ledger
- Given a bucket that received no new dispatches since the previous step close, when the next step closes, then that bucket's point is exported again unchanged (cumulative, not per-interval)
- Given any dispatch close, when the visualizer's metric instruments are enumerated, then the only cost-carrying instruments are the two feature gauges; no per-process cost counter is exported

#### Negative Paths
- Given a dispatch whose usage carried tokens but no finite cost, when the step closes, then no bucket point is created for that dispatch, its tokens are still counted, and the whole-feature point carries `cost_complete=false`
- Given a dispatch whose reported cost is `NaN` or infinite, when the step closes, then it is treated exactly like a cost-unmetered dispatch: no bucket value changes and `cost_complete=false`
- Given a dispatch whose model is unknown, when the step closes, then its cost is still counted in a bucket keyed by step and source with the `model` attribute omitted, and the whole-feature total includes it
- Given a feature whose ledger contains a dispatch for a step name that never produced a span, when the step closes, then the bucket for that step is still exported (bucketing depends on the ledger, not on open spans)
- Given a feature with dispatches across two engine process lifetimes, when the second run's first step closes, then every bucket value includes the first run's dispatches for that bucket

### Done When
- [ ] A test proves `conductor.feature.step.cost` buckets match a by-hand rollup of a ledger holding at least two steps, two models, and both cost sources
- [ ] A test proves the bucket sum equals the whole-feature gauge at the same close
- [ ] A test proves cost-unmetered, non-finite, and unmetered dispatches create no bucket and set `cost_complete=false`
- [ ] A test proves no `conductor.step.cost` data point is produced for any dispatch

## Story 3: A finished run stops exporting metrics

As an operator, I want a run's metric exports to end when the run ends so that a later run of the
same feature is the only writer of that feature's series and no stale value is ever re-exported.

### Acceptance Criteria

#### Happy Path
- Given a visualizer that recorded metrics during a run, when `stop()` resolves, then one final export carrying the latest recorded values has completed before `stop()` resolves
- Given a stopped visualizer, when more than one export interval elapses, then no further metric export occurs from that visualizer
- Given a run whose spans finished before `stop()`, when `stop()` resolves, then those finished spans remain readable from the span exporter (existing behavior preserved)
- Given two sequential runs of the same feature inside one long-lived process, when the first run has stopped and the second is exporting, then every exported value for that feature after the first stop originates from the second run

#### Negative Paths
- Given the metric endpoint does not respond, when `stop()` is called, then `stop()` resolves within the configured export timeout, does not throw, and the run's outcome is unaffected
- Given `stop()` already in progress, when `stop()` is called again or a termination signal arrives, then the second call returns the same in-flight promise and no second shutdown is attempted
- Given a visualizer whose start failed and never created providers, when `stop()` is called, then it resolves immediately without error
- Given a run that recorded no metrics at all, when `stop()` is called, then shutdown completes without exporting any data point

### Done When
- [ ] A test with fake timers proves zero metric exports occur after `stop()` resolves, across at least two export intervals
- [ ] A test proves finished spans are still readable after `stop()`
- [ ] A test proves `stop()` resolves without throwing when the metric exporter rejects or hangs
- [ ] A test proves two sequential visualizers for one feature in one process never interleave exports after the first stops

## Story 4: A failed telemetry export is visible to the operator

As an operator, I want an export failure to appear in the daemon log so that a cost figure that
could not be delivered is known to be missing rather than assumed present.

### Acceptance Criteria

#### Happy Path
- Given a daemon-dispatched feature whose metric export fails, when the failure is detected, then the feature's daemon log carries one line naming the `otel` renderer and the failure message
- Given an interactive run whose export fails, when the failure is detected, then the terminal renderer surfaces the same renderer error line (existing behavior preserved)
- Given a renderer error rendered in the daemon log, when the event is also persisted, then the persisted ledger entry and the log line carry the same renderer name and message

#### Negative Paths
- Given repeated export failures within one run, when they are detected, then the daemon log carries exactly one such line for that run (bounded, not one per export)
- Given an export failure, when it is rendered, then the run continues, the step's verdict is unchanged, and the run's terminal outcome is not altered by the failure
- Given a renderer error from a renderer other than `otel`, when it is rendered, then the line names that renderer, so an operator can tell which surface failed

### Done When
- [ ] A test proves a metric export failure produces exactly one daemon-log line naming `otel` and the message
- [ ] A test proves the run outcome and step verdicts are unchanged when export fails
- [ ] The event-sink registry declares the renderer error as rendered, and the registry's exhaustiveness test passes
