# Architecture Review: Live subagent activity and per-step token burn (#1441)

**Date:** 2026-08-19
**Tier:** M (top of band) — lightweight mode: §2 Feasibility and §4 Alignment run in full
**Track:** technical (`.docs/track/subagent-activity-and-live-per-step-token-burn-are.md`)
**Input reviewed:** the explore output and technical intent (no PRD — technical track); the
architecture diagrams at `.docs/architecture/subagent-activity-and-live-per-step-token-burn-are.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| **Stack compatibility** | Compatible. No new dependency. The Claude CLI already supports `--output-format stream-json --verbose`; Codex already emits JSONL via `exec --json` and `parseCodexJsonl` already reads `turn.completed.usage`. |
| **Prerequisites** | None external. The one internal prerequisite is the amendment to `adr-2026-07-22-build-dispatch-json-usage-capture`, which must land in the same diff. |
| **Integration surface** | Six modules: both provider adapters, the shared `llm-provider.ts` options contract, `step-runners.ts`, the `ConductorEvent` union plus its compile-time sink registry, and `daemon-dashboard.ts`. Crosses the execution/engine boundary but along an existing seam (`InvokeOptions`), not a new one. |
| **Data implications** | None. No schema, no migration, no persistence store. `.pipeline/events.jsonl` gains records of a new declared type; `parseLedger` in `timing-rollup.ts` tolerates unknown well-formed records and only fails on malformed lines, so the new variant is inert for the timing and cost rollups. |
| **Performance risk** | Real and bounded. Unthrottled emission would write one ledger record per streamed message. Mitigated by decision 6 of the ADR (change-driven emission plus a slow heartbeat with a hard minimum interval), matching the established `build_progress` policy. Per-chunk parsing cost is a newline split and a `JSON.parse` per complete record on a stream the process already receives. |
| **Worktree isolation** | Unaffected. No new port, service, database, or shared file. Both signals are per-worktree, written to the worktree's own `.pipeline/events.jsonl` exactly as `step_started` and `acceptance_red` already are. |

**Load-bearing claim, verified (confidence 100%, basis: direct probe of the installed CLI on
2026-08-19).** The terminal line of `--output-format stream-json --verbose` is
`{"type":"result", …}` and carries `result`, `usage.{input_tokens, output_tokens,
cache_read_input_tokens, cache_creation_input_tokens}`, `total_cost_usd`, `num_turns` and
`duration_ms` — a superset of the object `--output-format json` produces. This is what makes the
format switch a change of input selection rather than a rewrite of `parseJsonResult`, and the
whole feasibility case rests on it. It is pinned by a fixture as a condition below.

**Assumption surfaced (confidence ~85%, basis: inferred from the CLI's documented message
schema plus the observed `parent_tool_use_id: null` on main-chain messages).** Subagent messages
are attributable by a non-null `parent_tool_use_id`, and a child's span is bounded by a `Task`
tool_use block and its matching tool_result. The probe confirmed the field exists and is null on
the main chain; it did not exercise a run that actually spawns a subagent. **Impact if wrong:**
`activeChildren` would be miscounted or unavailable — it would not affect dispatch, completion, or
token accounting, and the design already carries `childObservability` so the honest degradation is
`unknown`. **How to confirm:** a live probe that dispatches a `Task` and inspects the emitted
records; this is a build-time verification task, not a DECIDE blocker, because every wrong-answer
branch lands on a value the schema already models.

## Alignment

**Approved decisions consulted.** A repo-wide pass over all 294 titled ADRs in `.docs/decisions/`
was run rather than a keyword narrowing. Nine bear on this design:

- **`adr-2026-07-22-build-dispatch-json-usage-capture` — conflict, resolved by amendment.** It
  explicitly rejected `stream-json` "for no benefit". That premise is what this feature overturns.
  Its usage-capture decisions are untouched; only the rejection clause is amended, additively,
  beside the original assertion.
- **`adr-2026-07-10-intra-step-build-progress-events` — governing precedent, reused.** It
  established intra-step `ConductorEvent`s with change-driven emission plus a slow heartbeat, and
  established that new event kinds must be declared in every sink. This feature copies that policy
  rather than inventing an emission cadence.
- **`adr-2026-07-26-event-sink-registry-exhaustiveness` — binding.** `EVENT_SINKS` is
  `Record<ConductorEvent['type'], SinkDeclaration>`, so the new variant cannot compile without a
  declaration. Chosen: `{ render: false, persist: true, audit: false }`.
- **`adr-2026-07-27-cost-unmetered-is-a-first-class-state` — binding, and generalized here.** Its
  rule is that absent cost is a state, never zero. This design applies the same rule to an absent
  child count (`childObservability: 'unsupported'`) and to absent token observation (fields absent,
  not zeroed).
- **`adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`** — token aggregates are
  already split from cost aggregates; the live signal reports tokens and does not introduce a
  second live cost number.
- **`adr-2026-07-29-engine-observed-provider-time-partition`** — `invoke()` is wrapped in
  `observeInterval`. The stream observer sits inside the observed interval and adds no second
  timing source, so the elapsed-time partition is unaffected.
- **`adr-2026-07-30-provider-preparation-lifecycle-supervision`** — the new callback is threaded
  through `supervisor.supervise((lease) => run({…, onActivity: pulse, spawnPermit: lease.spawnPermit}))`
  exactly as `onActivity` is, so it inherits the fenced attempt identity and grants no lifecycle
  authority.
- **`adr-2026-07-25-provider-neutral-safety-authority`** — engine-owned authority with
  provider-local guards. Honored: adapters normalize, the engine decides cadence and emits.
- **`adr-2026-08-09-worktree-local-provider-scratch`** — the reason rejected Option C is fragile;
  cited in the ADR rather than rediscovered later.

**Pattern consistency.** Every new element extends an existing seam: an optional best-effort
callback on `InvokeOptions` beside `onActivity` and `onSpawn`; a throttle beside
`createHeartbeatPulse`; an emission beside `providerAttempt`; a union variant with a sink
declaration; a reader beside `readDispatchActivity`; a suffix beside `heartbeatSuffix` and
`activityStateSuffix`. No new structural pattern is introduced beyond the one the ADR records.

**Event-spine verdict** (per `.agents/skills/event-spine/SKILL.md`):

```
Event spine
  Channel?    yes    — a live observer of provider child activity and token burn
  Concern:    occurrence — a child opened/closed; a message consumed tokens
  Verdict:    extend the union
  Exception:  none   — the writer is the conductor's own process, so A does not
                       apply; one writer per ledger, so B does not apply; this is
                       an occurrence, not durable state, so C does not apply
```

No sidecar file, no counter stamped into an existing artifact, no second reader path.

**State management.** `childObservability` is a closed two-valued discriminant rather than a
nullable number carrying an implicit meaning, so "Codex cannot observe children" and "no
observation yet" and "zero children running" are three distinct representable states and no
invalid combination (`activeChildren: 0` meaning "unknown") can be constructed.

**Security boundaries.** No new endpoint, no new input from an untrusted source. The stream is the
provider subprocess's own stdout, already read. Records are parsed defensively and an unparseable
line is skipped, so a malformed stream cannot crash a dispatch.

**Production DI defaults.** No new stateful store, in-memory or otherwise.

**Diagram accuracy.** The two diagrams authored for this feature match this review and render
clean under `conduct-ts render-diagrams --check`.

## Wiring Surface

| New production surface | Where it will be called from |
|---|---|
| `InvokeOptions.onProviderStream` | Supplied by `step-runners.ts` `dispatchProviderWithLifecycleSupervision`, in the same `run({…})` call that already supplies `onActivity: pulse` and `spawnPermit`. |
| Claude NDJSON assembler + child lifecycle tracker | Invoked from `ClaudeProvider.runClaude`'s `subprocess.stdout.on('data')` handler — the handler that already calls `onActivity`. |
| Codex live token extractor | Invoked from `CodexProvider`'s existing stdout `data` handler (`codex-provider.ts:276`), reusing `parseCodexJsonl`'s usage read. |
| `provider_stream_progress` `ConductorEvent` | Emitted by `step-runners.ts` through the same emitter hook `providerAttempt` uses; persisted by `EventPersister` into the worktree's `.pipeline/events.jsonl`. |
| `EVENT_SINKS` declaration | Consumed by the existing sink dispatch; compile-time mandatory, so it cannot be omitted. |
| Live-progress reader | `readDispatchActivity` in `daemon-dashboard.ts`, which already walks `events.jsonl` for `step_started` and `acceptance_red`. |
| `childWorkSuffix` / new token-burn suffix | Composed into the IN-PROGRESS row at `daemon-dashboard.ts:915`, beside `heartbeatSuffix`, `elapsedStepTimeSuffix` and `activityStateSuffix`. |
| Emission cadence config block | Read by `step-runners.ts` from `HarnessConfig`, following the optional-block pattern of `build_progress`. |

**Early overlap scan (advisory).** `conduct-ts overlap-scan` over the eight paths above returns 307
overlaps, every one of them on `src/conductor/src/execution/claude-provider.ts` and none on the
other six files. That uniformity across essentially every unmerged spec branch is base drift, not
contention — spec branches carry `.docs/` only and are simply behind main on that file. The scan is
therefore uninformative here rather than alarming; no real collision was identified. Advisory only;
it does not affect the verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The output-format switch regresses result parsing, breaking every step | Technical | Low | **High** | Verified superset property; pin the terminal `type:"result"` contract with a fixture; keep `parseJsonResult` semantics byte-identical and change only its input selection |
| Unthrottled emission floods `.pipeline/events.jsonl` and `.daemon/daemon.log` | Performance | Medium | Medium | `render: false` in the sink declaration; change-driven emission plus slow heartbeat with a hard minimum interval, per `adr-2026-07-10` |
| A record split across two stdout chunks is parsed as garbage | Technical | **High** | Low | Buffer and emit only complete newline-terminated records; skip unparseable lines; observation never affects dispatch |
| Claude Code changes its per-message `usage` / `parent_tool_use_id` schema | Integration | Medium | Low | Degrades to `childObservability: 'unsupported'` and absent token fields — never to a failed dispatch, because the terminal result line is a separate contract |
| Child-span attribution assumption is wrong (see Feasibility) | Technical | Low | Low | Every wrong branch lands on `unknown`, a value the schema already models; confirmed by a build-time live probe task |
| Operators read `unknown` on Codex rows as a bug | Knowledge | Medium | Low | `childObservability: 'unsupported'` is rendered distinctly from "not yet observed" so the row says why |

## ADRs Created

- `adr-2026-08-19-live-provider-stream-observation.md` — the autonomous provider dispatch is
  observed as a live stream, not only at its result. Structural: it revises the integration
  pattern at the provider seam (a buffered request/response boundary becomes a streamed one with
  an asynchronous observation callback) and adds a member to the event architecture. Currently
  awaiting operator approval; it must be APPROVED before the spec lands.

**Governing ADRs reused rather than duplicated:** `adr-2026-07-10-intra-step-build-progress-events`
(emission cadence), `adr-2026-07-26-event-sink-registry-exhaustiveness` (sink declaration),
`adr-2026-07-27-cost-unmetered-is-a-first-class-state` (absence is a state, never zero). No new ADR
was written for any of those decisions.

## Conditions

1. **The amendment to `adr-2026-07-22-build-dispatch-json-usage-capture` lands in this diff.**
   Landing the stream-json switch while that ADR's rejection clause stands unamended is a direct
   APPROVED-ADR contradiction and would block at the as-built gate. The note is additive beside
   the original assertion; the original text is preserved.
2. **The terminal `type:"result"` line contract is pinned by a fixture.** The entire feasibility
   case rests on the superset property; it must fail loudly at the parse boundary if the CLI schema
   moves, rather than silently zeroing usage.
3. **No count is ever rendered as `0` when it is unknown.** `childObservability` must be carried on
   the event and consulted at the render site; `childWorkSuffix()` must keep emitting `unknown`
   whenever the count is unobserved, for Codex and for a step whose first observation has not
   arrived.
4. **The child-span attribution assumption is confirmed by a live probe during BUILD**, and the
   result recorded. If it does not hold, the honest outcome is `childObservability: 'unsupported'`
   on Claude too — not a fabricated count.
5. **Emission cadence is throttled at the dispatch, not the adapter**, so one policy governs both
   providers and the adapters stay pure normalizers.
