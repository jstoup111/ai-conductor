# ADR: The autonomous provider dispatch is observed as a live stream, not only at its result

**Date:** 2026-08-19
**Status:** APPROVED
**Deciders:** Operator (approach A confirmed at DECIDE for #1441)
**Amends:** `adr-2026-07-22-build-dispatch-json-usage-capture` (its `stream-json` rejection only;
its usage-capture decision stands)

## Context

Issue #1441 asks for two live signals during a running step: how many child units of work are
active, and how many uncached input/output tokens the step has burned so far. Both are the
explicitly-deferred remainder of #1246, whose own complexity artifact names "subagent child-count
and cached/uncached token plumbing — the parts that would have required provider-stream parsing"
as out of scope and deferred here.

Verified directly against the current tree, 2026-08-19:

- The autonomous dispatch runs `claude --print --output-format json` with the prompt on stdin
  (`claude-provider.ts:581`). Stdout is one buffered result object, parsed by `parseJsonResult`.
- The provider layer configures subagents but never observes them. The only two matches for
  subagent/sidechain across `claude-provider.ts` and `llm-provider.ts` are comments about
  *cascading* model and effort **into** children (`claude-provider.ts:749-750`,
  `llm-provider.ts:226`). The engine sees one subprocess.
- `InvokeOptions.onActivity` fires on raw stdout/stderr `data` chunks with no payload
  (`claude-provider.ts:540-541`); it drives `.pipeline/step-heartbeat` liveness only.
- The only live per-step surface is the heartbeat-age suffix, and `childWorkSuffix()`
  (`daemon-dashboard.ts:769`) hardcodes `' (children: unknown)'` with a comment citing this issue.
- The only token-bearing telemetry is `step_completed.tokenUsage` (per dispatch, at completion)
  and `feature_usage_total` (once, when `finish` completes, `events.ts:264-273`).
- Codex already dispatches as JSONL (`codex exec --json`, `codex-provider.ts:820`) and
  `parseCodexJsonl` already reads `turn.completed.usage`.

**The blocking prior decision.** `adr-2026-07-22-build-dispatch-json-usage-capture` (APPROVED)
chose `--output-format json` and stated: *"Reject `stream-json`: with `--print` it additionally
requires `--verbose` and NDJSON/partial-message parsing, for no benefit — the build path already
awaits full completion (buffered) and does not stream to a live user."* That rejection is sound on
its own premise and is exactly the premise #1441 overturns: there is now a live consumer (the
operator reading `daemon status` during an unattended step), so the benefit clause no longer holds.

**Evidence that the switch is cheap.** Probed against the installed Claude Code CLI on 2026-08-19:

    claude -p "say ok" --output-format stream-json --verbose

emits NDJSON whose terminal line is `{"type":"result", …}` with keys including `result`,
`usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`,
`total_cost_usd`, `num_turns`, `duration_ms` — a **superset** of the single object
`--output-format json` produces and `parseJsonResult` reads today. Intermediate `assistant`
messages carry their own `message.usage` and a top-level `parent_tool_use_id` (null on the main
chain, set on a subagent's messages). The ADR's stated cost — "NDJSON/partial-message parsing" —
is therefore real but bounded: line buffering plus terminal-line selection, with the
`InvokeResult` contract unchanged by construction.

## Options Considered

### Option A: Stream the autonomous dispatch and observe it in the adapter — CHOSEN
Switch autonomous `invoke()` to `--print --output-format stream-json --verbose`; the adapter
assembles NDJSON records from stdout chunks, tracks child `Task` tool_use lifecycles, accumulates
uncached usage, and reports a provider-neutral observation through a new best-effort
`InvokeOptions` callback. The step dispatch — which already owns the heartbeat pulse and the
lifecycle-event hook — throttles those observations and emits a `ConductorEvent`.

- **Pros:** both signals come from one stream; the terminal result line preserves the existing
  parse contract; the observation rides the existing spine to the existing reader path; the same
  callback shape lets Codex contribute tokens from its own JSONL with no second mechanism.
- **Cons:** changes the output format of every autonomous dispatch (the highest-blast-radius seam
  in the engine); adds partial-line buffering; requires amending an APPROVED ADR.

### Option B: Live tokens only, children permanently unknown
Same format switch, emit only token burn; leave `childWorkSuffix()` a constant.
- **Pros:** no child-lifecycle state machine.
- **Cons:** delivers one of three remaining outcomes and permanently forecloses the issue's
  headline ask, for a saving that is a few lines of the same parser.

### Option C: Tail the provider's own session transcript out of band
Leave the dispatch untouched; watch Claude Code's per-session JSONL under the provider home.
- **Pros:** `adr-2026-07-22` needs no amendment.
- **Cons:** a watcher over provider-private, unversioned files — a parallel channel under
  `.agents/skills/event-spine/SKILL.md` unless everything is re-emitted as events anyway;
  `adr-2026-08-09-worktree-local-provider-scratch` puts throwaway provider homes in the worktree
  under lease-owned paths, so discovery is fragile; and Codex has no analogue, so the
  provider-parity scope boundary cannot be met.

## Decision

**Option A**, with these contracts:

1. **The `stream-json` rejection in `adr-2026-07-22-build-dispatch-json-usage-capture` is
   amended, not its usage-capture decision.** That ADR's substantive choices — prompt on stdin,
   text output sourced from `.result`, usage from `.usage.*`, cost from `.total_cost_usd`, per
   invocation — all stand unchanged. Only the "for no benefit" rejection clause is overturned, and
   only because #1441 supplies the live consumer it presumed absent. `parseJsonResult` keeps its
   semantics; its input becomes the terminal `type:"result"` line rather than the whole of stdout.
   An amendment note is added beside the original assertion in that ADR, additively.

2. **One provider-neutral observation contract.** `InvokeOptions` gains
   `onProviderStream?: (observation: ProviderStreamObservation) => void`, carrying:

   ```
   activeChildren?: number
   childObservability: 'observed' | 'unsupported'
   uncachedInputTokens: number
   outputTokens: number
   cachedInputTokens?: number
   ```

   Each adapter normalizes its own native stream into this shape. Claude reports
   `childObservability: 'observed'` with a real `activeChildren`; Codex reports `'unsupported'`
   and omits `activeChildren`, because Codex has no subagent concept — this is a designed
   asymmetry, recorded, not an omission to be filled later.

3. **Unknown is carried, never coerced.** `activeChildren` is absent when unobserved and
   `childObservability` says why. Nothing renders `0` for an unknown count. This follows
   `adr-2026-07-27-cost-unmetered-is-a-first-class-state`'s rule for absent cost, applied to an
   absent count: absence is a state, not a zero.

4. **Tokens are reported uncached-first.** `usage.input_tokens` on each assistant message is the
   fresh billed input and is what `uncachedInputTokens` accumulates; `cache_read_input_tokens` and
   `cache_creation_input_tokens` are reported separately as `cachedInputTokens` and are never
   summed into it. This matches `TokenUsage`'s existing `input` / `cacheRead` split and
   `feature_usage_total.inputTokens`, whose doc comment already reads "Fresh (non-cached) input
   tokens", so the live number and the end-of-feature number mean the same thing.

5. **One new `ConductorEvent` variant, `provider_stream_progress`**, carrying the observation plus
   `step`, `provider`, and the emitting timestamp. It is declared in `EVENT_SINKS`
   (`adr-2026-07-26-event-sink-registry-exhaustiveness` makes this compile-time mandatory) as
   `{ render: false, persist: true, audit: false }` — persisted so `daemon status` can read it,
   not rendered, because a per-interval progress line would flood `.daemon/daemon.log`.

6. **Emission is change-driven with a slow heartbeat, throttled at the dispatch.** Following
   `adr-2026-07-10-intra-step-build-progress-events`, the event is emitted when the observation
   materially changes (child count moves, or token burn crosses a delta threshold) and otherwise
   at a much slower periodic cadence, with a hard minimum interval. The throttle lives in
   `step-runners.ts` beside `createHeartbeatPulse`, so the adapters stay pure normalizers and one
   policy governs both providers.

   > **Amended 2026-08-19 by #1441 (conflict-check):** the throttle carries one exemption. At the
   > dispatch's close boundary a single best-effort **flush** emission carries the final
   > observation, regardless of the minimum interval, and nothing is emitted for that step
   > afterwards. Without it the last persisted record can predate the last stream record, so a
   > dispatch that ends with an unclosed child leaves the operator's final view reading `0 active`
   > while a child was live — the exact misread this feature exists to prevent. The flush emits
   > nothing when the dispatch produced no observation, and a throwing flush leaves the dispatch
   > result and the step's completion verdict unchanged (decision 7 still governs). No timer
   > outlives the dispatch.

7. **Observation never gains authority.** `onProviderStream` inherits the posture `onActivity` and
   `onSpawn` already carry: best-effort, no timeout/kill/retry/lifecycle authority, a throwing
   handler must never affect dispatch, and an unparseable stream line is skipped rather than
   failing the step. A stream the adapter cannot understand degrades to today's behavior — the
   terminal result line — not to a failed dispatch.

8. **Scope is autonomous `invoke()` only.** `invokeInteractive` inherits stdio so a human is
   already watching; its format is unchanged.

## Consequences

### Positive
- An operator can distinguish "three children working" from "children finished, coordinator
  waiting on a named completion condition" — the latter already computed by #1246's
  `activityState` + `completionCondition`, now conjoined with a real count.
- Live cost visibility during long unattended steps, in the same uncached-input units the
  end-of-feature total uses, so the two are comparable rather than merely adjacent.
- The dead `parseTokenUsage` line-scanner (`claude-provider.ts:403`), written for a stream-json
  shape the engine never produced, either becomes live or is deleted rather than left as a trap.
- Codex gains live token reporting from a stream it already parses, with no second mechanism.

### Negative
- Every autonomous dispatch's stdout format changes. A regression here breaks all steps, not one.
  Mitigated by the verified superset property and by pinning the terminal-line contract in tests,
  but the blast radius is real and is why this feature sits at the top of tier M.
- `events.jsonl` grows by one record per emission interval per running step. Bounded by the
  change-driven + slow-heartbeat policy, but non-zero.
- A third CLI-schema dependency is added to the two `adr-2026-07-22` already carries
  (`.result`, `.usage`): the per-message `usage` and `parent_tool_use_id` fields. If Claude Code
  changes them, children and live burn degrade to `unknown` — the terminal result line, and
  therefore step completion, is unaffected.
- The Claude/Codex asymmetry in `childObservability` is permanent until Codex grows a subagent
  concept, and operators will see `unknown` on Codex rows forever.

### Follow-up Actions
- [ ] Add the amendment note to `adr-2026-07-22-build-dispatch-json-usage-capture`.
- [ ] Stories + plan for: the observation contract, the Claude NDJSON assembler and child tracker,
      the Codex token extractor, the event variant and its sink declaration, the dispatch-side
      throttle, and the `daemon status` rendering.
- [ ] Pin the terminal `type:"result"` line contract with a fixture so a CLI schema change fails
      loudly at the parse boundary rather than silently zeroing usage.
