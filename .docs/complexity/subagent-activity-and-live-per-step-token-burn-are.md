# Complexity: Subagent activity and live per-step token burn are unobservable (#1441)

Tier: M

## Rationale

Medium, at the top of the band. The feature spans several coupled engine surfaces and changes a
high-blast-radius seam, but it introduces no new subsystem, no external integration, no
persistence store, and no auth or multi-actor state machine.

**Signals pushing above Small:**

- **Both provider adapters change together.** `claude-provider.ts` gains NDJSON stream parsing
  (`--print --output-format stream-json --verbose`) and `codex-provider.ts` gains live token
  extraction from its existing `exec --json` JSONL. `llm-provider.ts`'s `InvokeOptions` grows the
  observation callback the two adapters share, and `step-runners.ts` wires it alongside the
  existing heartbeat pulse.
- **The `ConductorEvent` union grows, so every exhaustive consumer changes with it.**
  `event-persister.ts`'s hand-maintained `ALL_EVENT_TYPES`, the event-sink registry
  exhaustiveness contract (`adr-2026-07-26-event-sink-registry-exhaustiveness`), the TTY and
  daemon render paths, and the OTel visualizer all have to accept the new variants or the signal
  is written by one place and read by none.
- **A stream state machine, not a field read.** Active-child count requires tracking Task
  tool_use lifecycles across the NDJSON stream (open on a `Task` tool_use, close on its matching
  tool_result, attribute messages by `parent_tool_use_id`), plus partial-line buffering — the
  chunk boundaries of a piped stdout do not align with record boundaries.
- **It changes the output format of every autonomous dispatch.** `invoke()` is the single seam
  every step's result flows through; a parsing regression there breaks every build, not one step.
  This is the highest blast-radius signal in the feature and the reason it sits at the top of M
  rather than the middle.
- **It contradicts an approved ADR that must be amended in the same change.**
  `adr-2026-07-22-build-dispatch-json-usage-capture` rejected `stream-json` explicitly; that
  rejection's premise ("for no benefit") is what this feature overturns.
- **Cross-provider asymmetry is a designed outcome, not an omission.** Codex has no subagent
  concept, so its rows must keep reporting children as `unknown` — a distinction the rendering
  has to preserve rather than collapse to zero.

**Signals holding it below Large:**

- No new process, service, or storage layer. Both signals ride the existing spine into the
  existing `.pipeline/events.jsonl`, read by the reader path `readDispatchActivity` already uses.
- The parse contract is preserved by construction: the stream-json terminal `type:"result"` line
  is a verified superset of the `--output-format json` object parsed today, so `parseJsonResult`
  keeps its semantics and only its input selection changes.
- No auth, no multi-actor coordination, no schema migration of a validated gate artifact.
- The "unknown, stated explicitly" outcome is already delivered (`childWorkSuffix()` in
  `daemon-dashboard.ts`); this feature replaces a constant with a real count where one exists.
- End-of-step and end-of-feature token accounting (`step_completed.tokenUsage`,
  `feature_usage_total`) are unchanged — the new signal is additive and live-only.

## Consequences for the BUILD phase

Tier M requires the full non-Small artifact set: architecture diagram, architecture review with
an ADR (which must carry the `adr-2026-07-22` amendment), conflict-check, and the coherence-check
traceability mapping. No PRD — the track is technical
(`.docs/track/subagent-activity-and-live-per-step-token-burn-are.md`). Given the dispatch-seam
blast radius, the architecture review should run nearer the full depth than the lightweight one M
normally allows.
