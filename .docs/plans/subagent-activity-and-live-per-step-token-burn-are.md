# Implementation Plan: Live subagent activity and per-step token burn (#1441)

**Date:** 2026-08-19
**Stories:** `.docs/stories/subagent-activity-and-live-per-step-token-burn-are.md`
**Conflict check:** Clean as of 2026-08-19

## Summary

Makes a running step's child activity and token burn observable while it runs: 20 tasks that switch
the autonomous Claude dispatch to a streamed transport, normalize both providers' streams into one
observation shape, emit it as a throttled `ConductorEvent` on the existing spine, and render both
signals on the `daemon status` in-progress row without ever fabricating a count.

## Technical Approach

The keystone is the **terminal-result-line contract**. The autonomous dispatch currently runs
`claude --print --output-format json` and `parseJsonResult` (`src/conductor/src/execution/claude-provider.ts:433`)
parses the whole of stdout as one object. The stream-json form's terminal `{"type":"result", …}`
line was verified on 2026-08-19 to be a superset of that object, so the switch is a change of
*input selection* — `parseJsonResult` keeps its semantics and receives the terminal line instead of
all of stdout. Every other change in this plan is additive on top of a dispatch whose result
contract did not move, which is why Tasks 5–7 land that seam before anything observes it.

Above that seam the work is three independent accumulators over the same stream — a newline record
assembler, a token accumulator, and a child lifecycle tracker — each of which degrades to "no
signal" rather than to a wrong signal. They feed one provider-neutral
`ProviderStreamObservation`, reported through a new best-effort `onProviderStream` callback on
`InvokeOptions` that sits beside the existing `onActivity` and `onSpawn` and carries the same
no-authority posture: a throwing handler, an unparseable line, or a missing field never affects
dispatch.

Emission policy is engine-owned, not adapter-owned, so one cadence governs both providers.
`dispatchProviderWithLifecycleSupervision` (`src/conductor/src/engine/step-runners.ts:1004`) already
constructs `createHeartbeatPulse` and already owns an emitter hook (`this.providerAttempt`), so the
throttle and the emit live there. The cadence copies `adr-2026-07-10-intra-step-build-progress-events`
— emit on material change, plus a slow heartbeat, with a hard minimum interval — and adds the one
exemption conflict-check required: a throttle-exempt flush at the dispatch's close boundary so the
ledger's last record is the final observation.

Reading is unchanged in shape. `readDispatchActivity` (`src/conductor/src/engine/daemon-dashboard.ts:386`)
already walks `.pipeline/events.jsonl` last-wins for `step_started` and `acceptance_red`; it gains
one more variant. `childWorkSuffix()` (`:769`) stops being the constant `' (children: unknown)'` and
becomes a function of the entry — still rendering `unknown` whenever the count is unobserved.

**Local pattern context.** The nearest comparable work in this repository is the intra-step build
progress feature: an engine-side observer, a change-driven emission with a slow heartbeat, a new
union variant with sink declarations, and a `daemon status` surface. The traits worth preserving
are its emission cadence shape, its `.unref()`'d / `finally`-stopped lifecycle discipline, and its
rule that a missing or unparseable input reads as "no change" rather than as a failure. What may
vary: this feature observes a subprocess stream rather than polling files, so there is no interval
timer to `.unref()` on the observation side — only the slow-heartbeat timer. Search hints for
rediscovering an equivalent on the current checkout: `build_progress` in
`src/conductor/src/types/events.ts`, the watcher module reachable from `build-progress` test names
under `src/conductor/test/`, and `createHeartbeatPulse` in `src/conductor/src/engine/step-heartbeat.ts`.

Tier M and the review's five conditions bind this plan: the `adr-2026-07-22` amendment travels in
this diff (already applied at DECIDE), the terminal-line contract is pinned by a fixture (Task 7),
no unknown count is ever rendered as `0` (Task 17), the child-attribution assumption is confirmed by
an opt-in live probe (Task 20), and the throttle lives at the dispatch (Tasks 12–14).

## Prerequisites

- None external. `adr-2026-08-19-live-provider-stream-observation` is APPROVED and the additive
  amendment to `adr-2026-07-22-build-dispatch-json-usage-capture` is already applied in this spec's
  diff.

## Tasks

### Task 1: Define the provider-neutral stream observation contract
**Story:** Story 5 — "a single `provider_stream_progress` event carrying … the observation fields"
**Type:** infrastructure

**Steps:**
1. Write failing test: a type-level and runtime test asserting a `ProviderStreamObservation` with
   `childObservability: 'unsupported'` and no `activeChildren` is valid, and that one with
   `childObservability: 'observed'` may carry `activeChildren`.
2. Verify test fails (RED)
3. Implement: export `ProviderStreamObservation` (`activeChildren?: number`,
   `childObservability: 'observed' | 'unsupported'`, `uncachedInputTokens: number`,
   `outputTokens: number`, `cachedInputTokens?: number`) and add
   `onProviderStream?: (observation: ProviderStreamObservation) => void` to `InvokeOptions`,
   documented with the same best-effort/no-authority language `onActivity` and `onSpawn` carry.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): add provider-neutral stream observation contract"

**Files likely touched:**
- `src/conductor/src/execution/llm-provider.ts` — new type + optional callback on `InvokeOptions`
- `src/conductor/test/execution/provider-stream-observation.test.ts` — new contract test

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/test/execution/provider-stream-observation.test.ts`

**Dependencies:** none

### Task 2: Add the `provider_stream_progress` variant to the event union
**Story:** Story 5 — "a single `provider_stream_progress` event carrying `step`, `provider`, the observation fields and a timestamp"
**Type:** infrastructure

**Steps:**
1. Write failing test: assert a constructed `provider_stream_progress` event carries `step`,
   `provider`, `childObservability`, `uncachedInputTokens`, `outputTokens` and a timestamp, and
   that `activeChildren` and `cachedInputTokens` are optional.
2. Verify test fails (RED)
3. Implement: add the variant to `ConductorEvent`, documenting that it is a live intra-step signal
   and that absence of `activeChildren` means unobserved, never zero.
4. Verify test passes (GREEN)
5. Commit with message: "feat(events): add provider_stream_progress variant"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new union member
- `src/conductor/test/provider-stream-progress-event.test.ts` — shape test

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/test/provider-stream-progress-event.test.ts`

**Dependencies:** Task 1

### Task 3: Declare the variant at every sink
**Story:** Story 5 — "`EVENT_SINKS` declares it as `{ render: false, persist: true, audit: false }`" and its negative path "compilation fails"
**Type:** infrastructure

**Steps:**
1. Write failing test: assert `EVENT_SINKS['provider_stream_progress']` is
   `{ render: false, persist: true, audit: false }`, and a structural test asserting the registry
   remains a total `Record<ConductorEvent['type'], SinkDeclaration>` so an omitted declaration is a
   compile error.
2. Verify test fails (RED)
3. Implement: add the declaration with a comment explaining why `render` is false — a per-interval
   progress line would flood `.daemon/daemon.log`, while `daemon status` reads the ledger directly.
4. Verify test passes (GREEN)
5. Commit with message: "feat(events): declare provider_stream_progress sinks"

**Files likely touched:**
- `src/conductor/src/engine/event-sinks.ts` — new declaration
- `src/conductor/test/event-sink-registry.test.ts` — declaration + totality assertions

**Files:** `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/event-sink-registry.test.ts`

**Dependencies:** Task 2

### Task 4: Prove the rollups are inert to the new records
**Story:** Story 5 negative paths — "the rollup is unaffected", "per-feature cost and token aggregates are unchanged", "no line is written to `.daemon/daemon.log`"; Story 4 negative path 5 — "`step_completed.tokenUsage` is unchanged in meaning and is not double-counted with the live observations"
**Type:** negative-path

**Steps:**
1. Write failing test: build a `.pipeline/events.jsonl` fixture, compute the timing rollup and the
   cost rollup, then insert `provider_stream_progress` records between the existing ones and assert
   both outputs are byte-identical; assert the per-feature token total equals the sum over
   `step_completed.tokenUsage` alone, so a live record never contributes a second time; separately
   assert the daemon renderer produces no line for the new type.
2. Verify test fails (RED)
3. Implement: whatever the assertions expose — expected to be nothing beyond Task 3's `render: false`,
   since `parseLedger` tolerates well-formed unknown records and the cost rollup keys on
   `step_completed`. If a rollup does key on record count or position, fix it here.
4. Verify test passes (GREEN)
5. Commit with message: "test(events): pin rollup inertness to live progress records"

**Files likely touched:**
- `src/conductor/test/provider-stream-progress-rollup-inertness.test.ts` — new
- `src/conductor/src/engine/timing-rollup.ts` — only if an assertion exposes a positional dependency
- `src/conductor/src/engine/cost-rollup.ts` — only if an assertion exposes a positional dependency

**Files:** `src/conductor/test/provider-stream-progress-rollup-inertness.test.ts`, `src/conductor/src/engine/timing-rollup.ts`, `src/conductor/src/engine/cost-rollup.ts`

**Preserves:** per-feature cost and timing rollups report the same totals for a ledger regardless of live-progress records interleaved in it

**Dependencies:** Task 3

### Task 5: Assemble complete NDJSON records from arbitrary stdout chunks
**Story:** Story 7 — "a stdout chunk that splits a record across a chunk boundary … the reassembled record is parsed exactly once and no partial record is parsed"
**Type:** infrastructure

**Steps:**
1. Write failing test: feed a known multi-record stream to the assembler split at every byte offset
   and assert the emitted record sequence is identical to the unsplit case in all cases; assert an
   unterminated trailing fragment is never emitted.
2. Verify test fails (RED)
3. Implement: a small pure assembler holding a string buffer, splitting on `\n`, retaining the
   trailing fragment, and yielding parsed records; unparseable lines are skipped, not thrown.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): add newline record assembler for streamed provider output"

**Files likely touched:**
- `src/conductor/src/execution/provider-stream.ts` — new assembler module
- `src/conductor/test/execution/provider-stream-assembler.test.ts` — new

**Files:** `src/conductor/src/execution/provider-stream.ts`, `src/conductor/test/execution/provider-stream-assembler.test.ts`

**Dependencies:** none

### Task 6: Switch the autonomous Claude dispatch to stream-json and select the terminal result line
**Story:** Story 1 happy paths — the argument vector, and `InvokeResult` sourced from the terminal `type:"result"` line
**Type:** happy-path

**Steps:**
1. Write failing test: assert the autonomous argument vector contains `--print`,
   `--output-format stream-json` and `--verbose`; assert `InvokeResult` parsed from a multi-record
   stream is deep-equal to the one parsed from the equivalent single `--output-format json` object;
   assert the interactive path's arguments are unchanged and that the prompt is still delivered on
   stdin, not as a positional argument.
2. Verify test fails (RED)
3. Implement: change the autonomous `invoke()` argument construction, and route stdout through the
   Task 5 assembler to select the last record whose `type` is `"result"`, handing that record's
   JSON to `parseJsonResult` unchanged.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): stream the autonomous Claude dispatch"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — argument vector + terminal-line selection
- `src/conductor/test/execution/claude-provider.test.ts` — argv assertions
- `src/conductor/test/execution/claude-provider-json-result.test.ts` — equivalence assertions

**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/test/execution/claude-provider.test.ts`, `src/conductor/test/execution/claude-provider-json-result.test.ts`

**Preserves:** an autonomous step receives the same output text, token usage, cost and turn count it received from the single-object result

**Dependencies:** Task 5

### Task 7: Pin the terminal result-line contract with a fixture
**Story:** Story 1 "Done When" — the field-set fixture; architecture-review condition 2
**Type:** infrastructure

**Steps:**
1. Write failing test: load a committed fixture of a real terminal `type:"result"` line and assert
   each of `result`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`,
   `usage.cache_creation_input_tokens`, `total_cost_usd`, `num_turns` and `duration_ms` is present
   and of the expected type, naming the missing field on failure.
2. Verify test fails (RED)
3. Implement: commit the fixture (captured from the CLI, no credentials or prompt content) and the
   assertion helper that names precisely which field disappeared.
4. Verify test passes (GREEN)
5. Commit with message: "test(execution): pin the streamed terminal result-line contract"

**Files likely touched:**
- `src/conductor/test/fixtures/claude-stream-result-line.json` — new fixture
- `src/conductor/test/execution/claude-stream-result-contract.test.ts` — new

**Files:** `src/conductor/test/fixtures/claude-stream-result-line.json`, `src/conductor/test/execution/claude-stream-result-contract.test.ts`

**Dependencies:** Task 6

### Task 8: Handle a stream with no usable terminal result line
**Story:** Story 1 negative paths — no result line, missing `input_tokens`/`output_tokens`, invalid JSON
**Type:** negative-path

**Steps:**
1. Write failing test: three cases — a stream with no `type:"result"` line yields raw stdout
   passthrough and `tokenUsage` undefined; a result line whose `usage` lacks `input_tokens` yields
   `tokenUsage` undefined rather than zero-filled; a malformed terminal line does not throw.
2. Verify test fails (RED)
3. Implement: the fallbacks, reusing `parseJsonResult`'s existing "never fabricate a zero-cost
   tokenUsage" behavior rather than adding a second policy.
4. Verify test passes (GREEN)
5. Commit with message: "fix(execution): degrade cleanly when the streamed result line is absent or partial"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — fallback selection
- `src/conductor/test/execution/claude-provider-json-result.test.ts` — negative cases

**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/test/execution/claude-provider-json-result.test.ts`

**Dependencies:** Task 6

### Task 9: Accumulate uncached and cached tokens from per-message usage
**Story:** Story 4 happy paths 1–2 and negative paths 1–2
**Type:** happy-path

**Steps:**
1. Write failing test: a stream of three assistant messages yields `uncachedInputTokens` equal to
   the sum of their `usage.input_tokens` and `outputTokens` equal to the sum of their
   `usage.output_tokens`; `cache_read_input_tokens` and `cache_creation_input_tokens` land in
   `cachedInputTokens` and are excluded from `uncachedInputTokens`; a message with no `usage`
   object and a message whose `input_tokens` is not a number each leave the totals unchanged.
2. Verify test fails (RED)
3. Implement: a pure accumulator over parsed records, reading only numeric fields.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): accumulate live uncached and cached token totals"

**Files likely touched:**
- `src/conductor/src/execution/provider-stream.ts` — token accumulator
- `src/conductor/test/execution/provider-stream-tokens.test.ts` — new

**Files:** `src/conductor/src/execution/provider-stream.ts`, `src/conductor/test/execution/provider-stream-tokens.test.ts`

**Dependencies:** Task 5

### Task 10: Track child lifecycles across the stream
**Story:** Story 2 happy paths and all four negative paths
**Type:** happy-path

**Steps:**
1. Write failing test: opening a `Task` tool_use with no matching tool_result yields
   `activeChildren: 1`; three opened and one closed yields 2; all closed yields 0 with
   `childObservability: 'observed'`; an unmatched tool_result, a duplicated tool_result, and a
   message whose `parent_tool_use_id` names an unopened child each leave the count unchanged and
   never negative.
2. Verify test fails (RED)
3. Implement: a set of open child ids keyed by tool_use id; open on a `Task` tool_use block, close
   on the matching tool_result, ignore anything unmatched. Repeat here the pattern trait from the
   Technical Approach that a missing or unrecognized input reads as "no change", never as a failure.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): track subagent lifecycles from the provider stream"

**Files likely touched:**
- `src/conductor/src/execution/provider-stream.ts` — child tracker
- `src/conductor/test/execution/provider-stream-children.test.ts` — new

**Files:** `src/conductor/src/execution/provider-stream.ts`, `src/conductor/test/execution/provider-stream-children.test.ts`

**Dependencies:** Task 5

### Task 11: Report observations from the Claude adapter
**Story:** Story 2 happy path; Story 4 happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test: a Claude dispatch given an `onProviderStream` handler and a scripted stream
   receives observations carrying `childObservability: 'observed'`, the running child count, and
   the running token totals.
2. Verify test fails (RED)
3. Implement: wire the assembler, accumulator and tracker into the existing
   `subprocess.stdout.on('data')` handler beside the `onActivity` call, and invoke
   `onProviderStream` with the composed observation.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): report live stream observations from the Claude adapter"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — stdout handler wiring
- `src/conductor/test/execution/claude-provider-stream-observation.test.ts` — new

**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/test/execution/claude-provider-stream-observation.test.ts`

**Dependencies:** Task 9, Task 10

### Task 12: Report token observations from the Codex adapter as child-unsupported
**Story:** Story 3 happy paths 1–2; Story 4 happy path 3
**Type:** happy-path

**Steps:**
1. Write failing test: a Codex dispatch given an `onProviderStream` handler and a scripted
   `exec --json` JSONL receives observations whose `childObservability` is `'unsupported'`, whose
   `activeChildren` is absent, and whose token totals come from the stream's usage records.
2. Verify test fails (RED)
3. Implement: reuse the existing Codex JSONL usage read in the adapter's stdout handler and compose
   the observation; do not synthesize a child count.
4. Verify test passes (GREEN)
5. Commit with message: "feat(execution): report live token observations from the Codex adapter"

**Files likely touched:**
- `src/conductor/src/execution/codex-provider.ts` — stdout handler wiring
- `src/conductor/test/execution/codex-provider-stream-observation.test.ts` — new

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider-stream-observation.test.ts`

**Dependencies:** Task 1

### Task 13: Throttle observations at the dispatch with a configured minimum interval
**Story:** Story 6 happy paths 1 and 4; negative paths 1, 4 and 5; Story 4 negative path 4 — "a dispatch that is retried after a provider failure … its totals start from the new attempt"
**Type:** infrastructure

**Steps:**
1. Write failing test: one thousand synthetic observations inside one interval produce at most one
   emission; the same policy and interval apply to a Claude and a Codex dispatch; an absent config
   block yields the documented default; a zero or negative configured interval is rejected in favor
   of the default rather than emitting per record; a dispatch retried after a provider failure
   starts its accumulators and its throttle from the new attempt rather than continuing the failed
   attempt's totals.
2. Verify test fails (RED)
3. Implement: a throttle in `step-runners.ts` beside `createHeartbeatPulse`, reading an optional
   config block following the existing `build_progress` optional-block pattern.
4. Verify test passes (GREEN)
5. Commit with message: "feat(engine): throttle live provider stream observations at the dispatch"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — throttle construction and wiring
- `src/conductor/test/provider-stream-throttle.test.ts` — new

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/provider-stream-throttle.test.ts`

**Dependencies:** Task 11, Task 12

### Task 14: Emit on material change, plus a slow heartbeat
**Story:** Story 6 happy paths 2 and 3
**Type:** happy-path

**Steps:**
1. Write failing test: a change in active child count produces an emission at the next admissible
   moment rather than waiting for the slow heartbeat; an unchanged observation over a long step
   still produces an emission once the slow cadence elapses.
2. Verify test fails (RED)
3. Implement: track the last emitted observation, compare for material change, and add the slow
   heartbeat cadence. Repeat here the Technical Approach trait that this cadence is copied from
   the intra-step build progress precedent rather than newly invented.
4. Verify test passes (GREEN)
5. Commit with message: "feat(engine): emit live observations on change with a slow heartbeat"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — change detection + heartbeat cadence
- `src/conductor/test/provider-stream-throttle.test.ts` — cadence assertions

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/provider-stream-throttle.test.ts`

**Dependencies:** Task 13

### Task 15: Flush the final observation at the dispatch close boundary
**Story:** Story 6 happy path 5, negative paths 2 and 3; Story 2 negative path 3 — the conflict-check resolution
**Type:** negative-path

**Steps:**
1. Write failing test: a dispatch ending mid-interval emits exactly one throttle-exempt flush
   carrying the final observation, and the ledger's last record for that step is that flush; a
   dispatch that opened a child and ended without its tool_result has a last record reporting that
   child active, not `0`; a dispatch that produced no observation flushes nothing rather than an
   empty or zero-filled event; a throwing flush leaves `InvokeResult` and the step's completion
   verdict unchanged; no emission and no live timer survives the flush.
2. Verify test fails (RED)
3. Implement: a close-boundary flush in the dispatch's `finally`, exempt from the minimum interval,
   guarded so it emits only when at least one observation was seen and so its own failure is
   swallowed.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): flush the final stream observation at the dispatch close boundary"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — close-boundary flush
- `src/conductor/test/provider-stream-throttle.test.ts` — flush assertions

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/provider-stream-throttle.test.ts`

**Dependencies:** Task 14

### Task 16: Emit `provider_stream_progress` onto the spine
**Story:** Story 5 happy paths 1–2
**Type:** happy-path

**Steps:**
1. Write failing test: an admitted emission produces exactly one `provider_stream_progress` event
   on the emitter carrying `step`, `provider`, the observation fields and a timestamp, and the
   record appears in the worktree's `.pipeline/events.jsonl` with no other file written anywhere
   under the worktree.
2. Verify test fails (RED)
3. Implement: emit through the same hook `providerAttempt` uses, so persistence rides the existing
   `EventPersister` path.
4. Verify test passes (GREEN)
5. Commit with message: "feat(engine): emit provider_stream_progress onto the event spine"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — emission
- `src/conductor/test/provider-stream-progress-emission.test.ts` — new

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/provider-stream-progress-emission.test.ts`

**Dependencies:** Task 15

### Task 17: Read the live progress record on the dashboard
**Story:** Story 3 negative path 3 — "no `provider_stream_progress` event exists … the rest of the row still renders"
**Type:** infrastructure

**Steps:**
1. Write failing test: `readDispatchActivity` returns the latest `provider_stream_progress` for the
   step in flight, ignores records naming a different step, ignores records preceding the current
   `step_started`, and returns no live progress when the ledger is missing or unreadable without
   failing the scan.
2. Verify test fails (RED)
3. Implement: extend the existing last-wins loop with the new variant, following the same
   `step_started` reset the acceptance-RED read already uses.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): read live provider stream progress from the ledger"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — `readDispatchActivity` + `InProgressEntry`
- `src/conductor/test/ui/dashboard-text.test.ts` — reader assertions

**Files:** `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/test/ui/dashboard-text.test.ts`

**Preserves:** a worktree with a missing or malformed `.pipeline/events.jsonl` is skipped from enrichment rather than failing the dashboard scan

**Dependencies:** Task 16

### Task 18: Render the child count, and render `unknown` whenever it is unobserved
**Story:** Story 3 happy paths 2–4 and all three negative paths; architecture-review condition 3
**Type:** happy-path

**Steps:**
1. Write failing test: a Codex in-progress row renders `unknown` and contains no numeric child
   count; a row with `observed` and `activeChildren: 0` and a row with `observed` and no
   `activeChildren` render as two visibly different strings; an unrecognized `childObservability`
   value renders `unknown` without throwing; a step with no progress record renders `unknown`.
2. Verify test fails (RED)
3. Implement: change `childWorkSuffix()` from a constant to a function of the entry, and remove the
   `#1441` deferral comment now that the count exists.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): render live child counts, unknown when unobserved"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — `childWorkSuffix`
- `src/conductor/test/ui/dashboard-text.test.ts` — rendering assertions
- `src/conductor/test/ui/dashboard-snapshot.test.ts` — snapshot update

**Files:** `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/test/ui/dashboard-text.test.ts`, `src/conductor/test/ui/dashboard-snapshot.test.ts`

**Preserves:** an in-progress row whose child count cannot be determined still says so explicitly rather than rendering a number

**Dependencies:** Task 17

### Task 19: Render live token burn, explicitly unavailable when no observation exists
**Story:** Story 4 happy path 4 and negative path 3
**Type:** happy-path

**Steps:**
1. Write failing test: a row with a live progress record shows the current uncached input and
   output totals; a row for a step that has produced no observation renders an explicit unavailable
   token suffix rather than `0 in / 0 out`.
2. Verify test fails (RED)
3. Implement: a token-burn suffix composed into the in-progress line beside the existing heartbeat,
   elapsed, last-test-outcome and child suffixes.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): render live per-step token burn"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — token-burn suffix + line composition
- `src/conductor/test/ui/dashboard-text.test.ts` — rendering assertions
- `src/conductor/test/ui/dashboard-snapshot.test.ts` — snapshot update

**Files:** `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/test/ui/dashboard-text.test.ts`, `src/conductor/test/ui/dashboard-snapshot.test.ts`

**Dependencies:** Task 18

### Task 20: Prove observation never gains authority over the dispatch
**Story:** Story 7 — all happy paths and all five negative paths
**Type:** negative-path

**Steps:**
1. Write failing test: an `onProviderStream` handler that throws on every record leaves
   `InvokeResult` and the step's completion verdict unchanged; a stream with no parseable record at
   all behaves exactly as the pre-change dispatch does and reports children as `unknown`;
   `.pipeline/step-heartbeat` write behavior is unchanged by the new observer; a subprocess killed
   mid-stream discards the buffered partial record without parsing it and raises nothing from the
   observer; the engine-observed provider interval is unchanged by the observer's presence.
2. Verify test fails (RED)
3. Implement: whatever the assertions expose — expected to be try/catch hardening at the observer
   call site and explicit buffer discard on unwind.
4. Verify test passes (GREEN)
5. Commit with message: "fix(execution): keep stream observation strictly best-effort"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — observer call-site hardening
- `src/conductor/src/execution/provider-stream.ts` — buffer discard on unwind
- `src/conductor/test/acceptance/live-stream-observation-has-no-authority.acceptance.test.ts` — new

**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/provider-stream.ts`, `src/conductor/test/acceptance/live-stream-observation-has-no-authority.acceptance.test.ts`

**Preserves:** the `.pipeline/step-heartbeat` liveness signal and the engine-observed provider elapsed-time partition behave exactly as they did before the observer existed

**Dependencies:** Task 11

### Task 21: Confirm the subagent-attribution assumption with an opt-in live probe
**Story:** Story 2 "Done When" — the recorded live probe; architecture-review condition 4
**Type:** infrastructure

**Steps:**
1. Write failing test: an opt-in smoke test that dispatches a real Claude session which spawns one
   subagent, captures the stream, and asserts the records this feature depends on are present —
   a `Task` tool_use block, its matching tool_result, and at least one message with a non-null
   `parent_tool_use_id`.
2. Verify test fails (RED)
3. Implement: register the smoke leg under the existing opt-in smoke tier so the default suite and
   CI exclude it, and record the observed outcome. If the assumption does not hold, the honest
   outcome is `childObservability: 'unsupported'` on Claude too — do not fabricate a count.
4. Verify test passes (GREEN)
5. Commit with message: "test(smoke): confirm subagent stream attribution with an opt-in live probe"

**Files likely touched:**
- `src/conductor/test/smoke/claude-subagent-stream.smoke.test.ts` — new opt-in smoke leg

**Files:** `src/conductor/test/smoke/claude-subagent-stream.smoke.test.ts`

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 (contract) ──┬─▶ Task 2 (union) ─▶ Task 3 (sinks) ─▶ Task 4 (rollup inertness)
                    └─▶ Task 12 (codex observations) ──────────────┐
                                                                   │
Task 5 (assembler) ─┬─▶ Task 6 (stream switch) ─┬─▶ Task 7 (fixture)
                    │                            └─▶ Task 8 (absent result line)
                    ├─▶ Task 9 (token accumulator) ──┐
                    └─▶ Task 10 (child tracker) ─────┼─▶ Task 11 (claude observations)
                                    │                │            │
                                    │                └────────────┤
                                    └─▶ Task 21 (live probe)      │
                                                                  ▼
                                        Task 13 (throttle) ◀──────┴─ Task 12
                                                │
                                                ▼
                                        Task 14 (change + heartbeat)
                                                │
                                                ▼
                                        Task 15 (close-boundary flush)
                                                │
                                                ▼
                                        Task 16 (emit onto spine)
                                                │
                                                ▼
                                        Task 17 (dashboard reader)
                                                │
                                                ▼
                                        Task 18 (child rendering)
                                                │
                                                ▼
                                        Task 19 (token-burn rendering)

Task 11 ─▶ Task 20 (no-authority proof)
```

Acyclic. Tasks 1–4 and 5–8 are two independent front chains; the plan converges at Task 13.

## Integration Points

- **After Task 6:** the autonomous dispatch is streamed and every existing step still receives its
  unchanged result — the highest-risk seam is provable in isolation, before anything observes it.
- **After Task 11:** a Claude dispatch reports live observations end to end through the adapter,
  with no engine-side consumer yet.
- **After Task 16:** both providers' observations reach `.pipeline/events.jsonl` — the full write
  path is exercisable without any rendering.
- **After Task 19:** `daemon status` shows both signals on a live in-progress row — the feature is
  observable end to end.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
### Task rem-tautology-event-1: src/conductor/test/provider-stream-progress-event.test.ts:3-37 — replace the literal-to-literal assertions with unsupported and observed provider_stream_progress values passed without casts through the runtime ConductorEventEmitter-to-EventPersister path, then read their optional child/token fields from .pipeline/events.jsonl
**Verify-only:** yes
Rationale: the tautology rubric this remediation task was appended for is disabled repository-wide by 33dae839c (PR #1771, operator decision 2026-08-21); no rubric drives this work, so no commit can carry its trailer.
### Task rem-tautology-observation-unsupported-1: src/conductor/test/execution/provider-stream-observation.test.ts:5-18 and src/conductor/test/execution/codex-provider-stream-observation.test.ts — remove the unsupported literal-readback case and strengthen the CodexProvider.invoke assertion to prove its runtime observation has childObservability unsupported and no own activeChildren property
**Verify-only:** yes
Rationale: the tautology rubric this remediation task was appended for is disabled repository-wide by 33dae839c (PR #1771, operator decision 2026-08-21); no rubric drives this work, so no commit can carry its trailer.
### Task rem-tautology-observation-observed-1: src/conductor/test/execution/provider-stream-observation.test.ts:20-31 and src/conductor/test/execution/claude-provider-stream-observation.test.ts — remove the observed literal-readback case and strengthen the ClaudeProvider.invoke assertion so its runtime observation proves the observed child count plus cached, uncached, and output token fields
**Verify-only:** yes
Rationale: the tautology rubric this remediation task was appended for is disabled repository-wide by 33dae839c (PR #1771, operator decision 2026-08-21); no rubric drives this work, so no commit can carry its trailer.
### Task rem-tautology-terminal-result-1: src/conductor/test/execution/claude-stream-result-contract.test.ts:15-29 — feed claude-stream-result-line.json through ClaudeProvider.invoke's streamed terminal-result path and assert derived output and tokenUsage fields including cache read, cache creation, cost, turns, and duration so removing a consumed parser field fails
**Verify-only:** yes
Rationale: the tautology rubric this remediation task was appended for is disabled repository-wide by 33dae839c (PR #1771, operator decision 2026-08-21); no rubric drives this work, so no commit can carry its trailer.
### Task rem-rootcause-heartbeat-1: src/conductor/src/engine/step-runners.ts:146-180 and src/conductor/test/provider-stream-throttle.test.ts — add a dispatch-owned unref'd slow-heartbeat timer that re-emits the latest observation without another provider record, and prove with fake timers that quiet-stream heartbeat emission occurs and the timer stops at dispatch close
### Task rem-rootcause-close-flush-1: src/conductor/src/engine/step-runners.ts:1098-1109 — wrap supervisor.supervise and its result handling in try/finally and call providerStreamThrottle.flush() in finally so success, halt, and thrown exits close observation lifecycle without changing the provider result
### Task rem-completeness-close-flush-1: src/conductor/test/provider-stream-throttle.test.ts — add dispatch-lifecycle coverage proving a mid-interval final observation emits exactly once on close, an open child remains active, no observation emits nothing, flush failure cannot alter InvokeResult, and no heartbeat timer survives
### Task rem-completeness-spine-persistence-1: src/conductor/test/provider-stream-progress-emission.test.ts:1 — add the planned dispatch-level test that drives onProviderStream through dispatchProviderWithLifecycleSupervision, asserts exactly one provider_stream_progress event with step, actual provider, observation fields, and timestamp, then verifies the same record in .pipeline/events.jsonl and no parallel telemetry file
### Task rem-rootcause-config-1: src/conductor/src/types/config.ts:414, src/conductor/src/engine/config.ts:341 and :985, and src/conductor/src/engine/step-runners.ts:134 — define provider_stream.min_interval_ms on HarnessConfig, admit and validate/default the optional block through the real config path, and remove ProviderStreamIntervalConfig plus the local cast
### Task rem-rootcause-config-2: src/conductor/test/provider-stream-throttle.test.ts:49 and docs/reference/configuration.md:112 — prove valid provider_stream configuration loads, absent and non-positive intervals use Task 13's documented default, unknown keys fail closed, and document min_interval_ms with its default and validation behavior
### Task rem-rootcause-fallback-1: src/conductor/src/engine/step-runners.ts:1070-1129 — bind each provider candidate invocation to a fresh provider-stream throttle, heartbeat, and close flush, and emit provider_stream_progress with that invoked candidate's actual provider identity so failed-candidate observation state cannot leak into fallback
### Task rem-rootcause-fallback-2: src/conductor/test/provider-stream-progress-emission.test.ts:13 — drive a preferred-provider failure followed by a successful fallback and assert each persisted progress record names its invoked provider while the fallback receives no child or token state from the failed candidate
### Task rem-rootcause-observer-1: src/conductor/src/execution/codex-provider.ts:309-329 — independently guard stdout and stderr onActivity calls and stdout onProviderStream calls inside their asynchronous data listeners so any observer exception is swallowed and cannot alter provider execution
### Task rem-rootcause-observer-2: src/conductor/test/acceptance/live-stream-observation-has-no-authority.acceptance.test.ts — make Codex onActivity and onProviderStream throw during streamed output and assert InvokeResult and the step completion verdict remain identical to the non-throwing path
### Task rem-completeness-probe-1: src/conductor/test/smoke/claude-subagent-stream.smoke.test.ts:41 — run the registered opt-in real-Claude probe and add a dated source-controlled outcome beside the smoke leg stating whether a Task tool_use, its matching tool_result, and at least one non-null parent_tool_use_id were observed; if attribution is absent, record Claude child observability as unsupported rather than fabricating a count
### Task rem-completeness-retry-1: src/conductor/test/provider-stream-throttle.test.ts:37 — drive the real step-runner candidate path through a first provider attempt that emits progress then fails and a second attempt that succeeds, asserting the retry starts with fresh token totals and throttle timing and emits no terminal state inherited from the failed attempt
### Task rem-root-cause-agent-1: src/conductor/src/execution/provider-stream.ts:25,44 — recognize the live-probed Agent tool_use lifecycle alongside Task, opening the child by tool_use id and closing it only on the matching tool_result so activeChildren is authoritative for the current Claude stream contract
### Task rem-root-cause-agent-2: src/conductor/test/execution/provider-stream-children.test.ts:1 — add regression coverage for Agent tool_use and matching tool_result records, asserting childObservability remains observed and activeChildren transitions from 1 to 0 without breaking the existing Task lifecycle cases
### Task rem-completeness-agent-1: src/conductor/test/smoke/claude-subagent-stream.smoke.test.ts:11-85 — assert the emitted child tool name is exactly the recorded Agent contract, retain assertions for its matching tool_result and non-null parent_tool_use_id, and keep the dated outcome synchronized with those executable assertions
### Task rem-completeness-agent-2: src/conductor/test/execution/claude-provider-stream-observation.test.ts:1 — drive an Agent tool_use through ClaudeProvider.invoke and assert the emitted observation reports childObservability observed with activeChildren 1 until the matching tool_result returns it to 0, preventing an authoritative zero during live child work
### Task rem-scope-task-contract-1: src/conductor/src/execution/provider-stream.ts:23-52 and src/conductor/src/execution/claude-provider.ts:567-587 — remove Agent as an authoritative child-lifecycle signal, retain Task-only lifecycle tracking, and report Claude childObservability unsupported with no activeChildren while preserving live token accumulation
### Task rem-scope-task-contract-2: src/conductor/test/execution/provider-stream-children.test.ts:1-75 and src/conductor/test/execution/claude-provider-stream-observation.test.ts:8-63 — prove Agent records do not open or close Task-tracked children and replace Agent-observed Claude lifecycle assertions with childObservability unsupported, no activeChildren, and unchanged token observations
### Task rem-scope-task-contract-3: src/conductor/test/smoke/claude-subagent-stream.smoke.test.ts:11-85 — retain the recorded Task-absent and Agent-observed live-probe evidence, and assert that this falsified Task attribution yields unsupported Claude child observability rather than an Agent-derived count
### Task rem-completeness-daemon-guide-1: docs/guides/running-the-daemon.md:343,360,364-365 — update the IN-PROGRESS examples and explanation to show numeric children only when observed, children unknown otherwise, current input/output token totals when observed, and tokens unavailable when no live observation exists
