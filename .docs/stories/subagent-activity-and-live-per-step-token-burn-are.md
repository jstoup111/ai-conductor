**Status:** Accepted

# Stories: Live subagent activity and per-step token burn (#1441)

Technical track — no PRD. Acceptance criteria are derived from the technical intent in
`.docs/track/subagent-activity-and-live-per-step-token-burn-are.md` and the approved
`adr-2026-08-19-live-provider-stream-observation`.

## Story 1: The autonomous Claude dispatch streams without changing what a step receives

**Requirement:** ADR decision 1 (amendment scope), review condition 2

As the conductor, I want the autonomous Claude dispatch to run in streaming mode while producing
exactly the result a step received before, so that observability is gained without any step's
output, usage, or completion behavior changing.

### Acceptance Criteria

#### Happy Path
- Given an autonomous step dispatch, when the provider is invoked, then the spawned command
  carries `--print`, `--output-format stream-json` and `--verbose`, and the prompt is still
  delivered on stdin rather than as a positional argument.
- Given a stream whose terminal line is `{"type":"result", …}`, when the dispatch completes, then
  `InvokeResult.output` equals that line's `result` field and `InvokeResult.tokenUsage` carries
  `input`, `output`, `cacheRead`, `cacheCreation`, `costUsd`, `numTurns` and `durationMs` read
  from the same line's `usage` / `total_cost_usd` / `num_turns` / `duration_ms`.
- Given a stream containing many intermediate records before the terminal result line, when the
  dispatch completes, then only the terminal `type:"result"` line contributes to `InvokeResult`.

#### Negative Paths
- Given a stream with no `type:"result"` line at all, when the dispatch completes, then
  `InvokeResult.output` falls back to the raw stdout passthrough and `tokenUsage` is left
  undefined — a zero-cost `tokenUsage` is never fabricated.
- Given a terminal result line whose `usage` object is missing `input_tokens` or `output_tokens`,
  when the dispatch completes, then `tokenUsage` is undefined rather than partially populated with
  zeros.
- Given a terminal result line that is not valid JSON, when the dispatch completes, then the
  dispatch does not throw and the raw stdout is passed through as output.
- Given a prompt large enough to exceed the single-argument length limit, when the dispatch runs,
  then it still succeeds because the prompt is on stdin — the streaming switch does not
  reintroduce an argv-length failure.
- Given the interactive dispatch path, when it is invoked, then its arguments are unchanged and it
  does not stream JSON.

### Done When
- [ ] A fixture pinning the terminal `type:"result"` line's field set exists and fails the suite if
      any of `result`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`,
      `usage.cache_creation_input_tokens`, `total_cost_usd`, `num_turns`, `duration_ms` disappears.
- [ ] A test asserts the built argument vector contains `--output-format stream-json` and
      `--verbose` for autonomous dispatch and does not for the interactive path.
- [ ] A test asserts `InvokeResult` parsed from a multi-record stream is byte-identical to the one
      parsed from the equivalent single `--output-format json` object.

## Story 2: A running Claude step reports how many child units of work are active

**Requirement:** Issue desired outcome 1; ADR decision 2

As an operator watching an unattended step, I want the status to report how many child units of
work are currently active, so that I can tell real parallel work from a stalled coordinator.

### Acceptance Criteria

#### Happy Path
- Given a Claude dispatch whose stream contains a `Task` tool_use block with no matching
  tool_result yet, when an observation is produced, then `activeChildren` counts that child and
  `childObservability` is `observed`.
- Given three children opened and one closed by its matching tool_result, when an observation is
  produced, then `activeChildren` is 2.
- Given every opened child has a matching tool_result, when an observation is produced, then
  `activeChildren` is 0 and `childObservability` is still `observed`.

#### Negative Paths
- Given a tool_result whose id matches no open child, when it is processed, then the count is left
  unchanged and never goes negative.
- Given the same child's tool_result appears twice, when both are processed, then the child is
  closed once and the count does not go negative.
- Given a `Task` block that is opened and the stream then ends without its tool_result, when the
  dispatch completes, then the throttle-exempt close-boundary flush emits that final state — the
  child is still reported active rather than silently closed — and the dispatch completes normally.
- Given a message whose `parent_tool_use_id` names a child that was never opened, when it is
  processed, then no child is invented and the count is unchanged.

### Done When
- [ ] `activeChildren` is asserted across a recorded stream fixture containing nested `Task`
      dispatch and completion, at three points: after open, after partial close, after full close.
- [ ] A test asserts the count never goes negative under a duplicate or unmatched tool_result.
- [ ] A test asserts the last record in `events.jsonl` for a dispatch that ends with an unclosed
      child reports that child as active, not `0`.
- [ ] A live probe run is recorded confirming that a real subagent dispatch produces the
      `parent_tool_use_id` / `Task` tool_use records this story depends on (review condition 4).

## Story 3: An unknown child count is stated as unknown, never rendered as zero

**Requirement:** Issue desired outcome 4; ADR decision 3; review condition 3

As an operator, I want a count I cannot have to be shown as unknown, so that I never read a
fabricated `0` as "no children are running".

### Acceptance Criteria

#### Happy Path
- Given a Codex dispatch, when an observation is produced, then `childObservability` is
  `unsupported` and `activeChildren` is absent.
- Given a Codex dispatch, when the status row is rendered, then it reports children as `unknown`
  and never as a number.
- Given a step whose first observation has not yet arrived, when the status row is rendered, then
  it reports children as `unknown`.
- Given a Claude dispatch with `childObservability: observed` and `activeChildren: 0`, when the
  status row is rendered, then it reports zero active children as a real count, distinctly from
  `unknown`.

#### Negative Paths
- Given an event whose `childObservability` is `observed` but whose `activeChildren` is absent,
  when the row is rendered, then it reports `unknown` rather than defaulting to `0`.
- Given a persisted event with an unrecognized `childObservability` value, when the row is
  rendered, then it reports `unknown` rather than throwing or coercing.
- Given no `provider_stream_progress` event exists for the step in flight, when the row is
  rendered, then it reports `unknown` and the rest of the row still renders.

### Done When
- [ ] A test asserts the rendered row for a Codex in-progress entry contains `unknown` and contains
      no numeric child count.
- [ ] A test asserts `observed` + `activeChildren: 0` and `observed` + absent `activeChildren`
      render as two visibly different strings.
- [ ] No production code path produces `activeChildren: 0` as a stand-in for an unobserved count.

## Story 4: Live uncached token burn is visible while a step runs

**Requirement:** Issue desired outcome 3; ADR decision 4

As an operator, I want to see how many uncached input and output tokens the running step has
consumed so far, so that I can judge whether an unattended session is worth letting continue.

### Acceptance Criteria

#### Happy Path
- Given a Claude stream with three assistant messages, when an observation is produced, then
  `uncachedInputTokens` is the sum of their `usage.input_tokens` and `outputTokens` is the sum of
  their `usage.output_tokens`.
- Given assistant messages carrying `cache_read_input_tokens` and `cache_creation_input_tokens`,
  when an observation is produced, then those are accumulated into `cachedInputTokens` and are not
  added to `uncachedInputTokens`.
- Given a Codex dispatch, when its JSONL reports usage, then `uncachedInputTokens` and
  `outputTokens` are populated from it and `childObservability` is `unsupported`.
- Given a step that has produced at least one observation, when the status row is rendered, then it
  shows the current uncached input and output token totals.

#### Negative Paths
- Given an assistant message with no `usage` object, when it is processed, then the running totals
  are unchanged rather than incremented by zero-filled fields.
- Given a `usage` object whose `input_tokens` is not a number, when it is processed, then that
  message contributes nothing and the accumulation continues.
- Given a step that has produced no observation yet, when the row is rendered, then the token
  suffix reports unavailable rather than `0 in / 0 out`.
- Given a dispatch that is retried after a provider failure, when the new attempt streams, then its
  totals start from the new attempt rather than continuing the failed attempt's accumulation.
- Given the terminal result line's aggregate `usage`, when the step completes, then
  `step_completed.tokenUsage` is unchanged in meaning and is not double-counted with the live
  observations.

### Done When
- [ ] A test asserts a cached-heavy stream yields a `uncachedInputTokens` strictly smaller than the
      naive sum of all input-bearing fields.
- [ ] A test asserts the same uncached-input semantics hold for the live signal and for
      `feature_usage_total.inputTokens`.
- [ ] A test asserts an observation-free step renders an explicit unavailable token suffix.

## Story 5: The live signal rides the existing spine and is declared at every sink

**Requirement:** ADR decision 5; event-spine skill; `adr-2026-07-26-event-sink-registry-exhaustiveness`

As a maintainer, I want the live signal to be one `ConductorEvent` on the existing ledger, so that
every consumer that reads the spine can see it and no second channel is created.

### Acceptance Criteria

#### Happy Path
- Given a running step producing observations, when the throttle admits an emission, then a single
  `provider_stream_progress` event carrying `step`, `provider`, the observation fields and a
  timestamp is emitted onto `ConductorEventEmitter`.
- Given that event is emitted, when the persister runs, then the record appears in the worktree's
  `.pipeline/events.jsonl` and nowhere else — no sidecar file and no new ledger is created.
- Given the new variant, when the project compiles, then `EVENT_SINKS` declares it as
  `{ render: false, persist: true, audit: false }`.

#### Negative Paths
- Given the new variant is added to the union without a sink declaration, when the project
  compiles, then compilation fails — the omission cannot ship silently.
- Given a `.pipeline/events.jsonl` containing the new records, when the timing rollup parses the
  ledger, then the rollup is unaffected and does not report the ledger as degraded.
- Given a `.pipeline/events.jsonl` containing the new records, when the cost rollup runs, then
  per-feature cost and token aggregates are unchanged — the live records are not counted a second
  time.
- Given the daemon log is being rendered, when these events are emitted, then no line is written to
  `.daemon/daemon.log` for them.

### Done When
- [ ] `provider_stream_progress` appears in `ConductorEvent`, in `EVENT_SINKS`, and in the emitted
      `.pipeline/events.jsonl` of a run, with no other file written.
- [ ] A test asserts cost-rollup and timing-rollup outputs are byte-identical with and without the
      new records present in the ledger.
- [ ] A test asserts no daemon-log line is produced for the new event type.

## Story 6: Emission is throttled so a long step does not flood the ledger

**Requirement:** ADR decision 6; review condition 5; `adr-2026-07-10-intra-step-build-progress-events`

As a maintainer, I want emission driven by material change with a slow heartbeat and a hard minimum
interval, so that a fast-streaming step produces a readable ledger rather than a per-message log.

### Acceptance Criteria

#### Happy Path
- Given observations arriving faster than the minimum interval, when the throttle runs, then at
  most one event is emitted per interval.
- Given the active child count changes, when the next observation arrives, then an event is
  emitted at the next admissible moment rather than waiting for the slow heartbeat.
- Given a long step whose observation values do not change, when the slow heartbeat cadence
  elapses, then an event is still emitted so the surface does not go stale.
- Given both a Claude and a Codex dispatch, when each is throttled, then the same policy and the
  same configured interval apply to both.
- Given a dispatch that produced at least one observation, when it closes, then the ledger's last
  record for that step is the flush carrying the final observation, so the operator's final view is
  never up to one interval stale.

#### Negative Paths
- Given a burst of one thousand stream records within one interval, when the throttle runs, then
  the number of emitted events for that interval does not exceed one.
- Given a dispatch that produced no observation at all, when it closes, then the close-boundary
  flush emits nothing rather than an empty or zero-filled event.
- Given the close-boundary flush itself throws, when the dispatch unwinds, then the dispatch result
  and the step's completion verdict are unchanged.
- Given the dispatch ends mid-interval, when it completes, then exactly one throttle-exempt flush
  event carrying the final observation is emitted at the close boundary, and after it no further
  events are emitted for that step and no timer outlives the dispatch.
- Given a configured interval that is absent from config, when the throttle initializes, then a
  documented default applies rather than an unthrottled emission.
- Given a configured interval that is zero or negative, when the throttle initializes, then it is
  rejected in favor of the default rather than emitting per record.

### Done When
- [ ] A test drives one thousand synthetic observations through the throttle and asserts the
      emission count matches the interval policy, not the observation count.
- [ ] A test asserts a material change is emitted promptly while an unchanged value waits for the
      slow heartbeat.
- [ ] A test asserts exactly one throttle-exempt flush is emitted at the close boundary, that it
      carries the final observation, and that no emission and no live timer survives it.

## Story 7: Stream observation never gains authority over the dispatch

**Requirement:** ADR decision 7; issue impact statement

As the conductor, I want observation to be strictly best-effort, so that a malformed stream, a
throwing observer, or an absent field degrades the signal and never the step.

### Acceptance Criteria

#### Happy Path
- Given a stdout chunk that splits a record across a chunk boundary, when the next chunk arrives,
  then the reassembled record is parsed exactly once and no partial record is parsed.
- Given a stream containing lines the adapter does not recognize, when they arrive, then they are
  skipped and the surrounding records are still processed.
- Given the observation callback throws, when the next record arrives, then the dispatch continues
  and the step completes normally.

#### Negative Paths
- Given the observation callback throws on every record, when the dispatch completes, then
  `InvokeResult` is unaffected and the step's completion verdict is unchanged.
- Given a stream that emits no parseable record at all, when the dispatch completes, then the step
  behaves exactly as it does today: result from the terminal line if present, raw passthrough
  otherwise, and children reported as `unknown`.
- Given the heartbeat pulse and the stream observer are both wired, when records arrive, then the
  heartbeat continues to be written on the same cadence it uses today and is not replaced by the
  new signal.
- Given a provider subprocess that is killed mid-stream, when the dispatch unwinds, then the
  buffered partial record is discarded without being parsed and no error is raised from the
  observer.
- Given the observation path is exercised, when the engine-observed provider interval is computed,
  then the elapsed-time partition is unchanged — the observer introduces no second timing source.

### Done When
- [ ] A test feeds a fixture stream split at arbitrary byte offsets and asserts the parsed record
      sequence is identical to the unsplit case.
- [ ] A test asserts a throwing `onProviderStream` handler leaves `InvokeResult` and step
      completion unchanged.
- [ ] A test asserts `.pipeline/step-heartbeat` write behavior is unchanged by the new observer.
