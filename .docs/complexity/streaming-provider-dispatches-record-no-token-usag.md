# Complexity: streaming-provider-dispatches-record-no-token-usag

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — `TokenUsage`, `InvokeOptions`, and `InvokeResult` are unchanged |
| External integrations | Two provider CLIs (`claude`, `codex`); their argument surfaces and machine-output envelopes both move |
| Auth / permission surface | Indirect but real: the codex path's unattended sandbox/approval config is built in `buildArgs` alongside the `--json` flag, and self-host auth handoff rides the same dispatch |
| State machines | None new; the dispatch path is a straight-line classify-after-exit |
| Public contract change | **Yes** — `LLMProvider.invokeInteractive` (`llm-provider.ts:349`) is a published interface member, and `plugin-loader.ts:36-41` HARD-FAILS any `llm_provider` plugin that does not implement it |
| Story count | ~7-9 (unified dispatch contract, per-provider envelope capture, live-render equivalence, REPL preservation, plugin compatibility, plus negative paths) |
| Files touched | Both adapters, `llm-provider.ts`, `plugin-loader.ts`, `step-runners.ts` (3 wrapper/call sites incl. `streamingProviderRuntimes`), `attribution-lane.ts`, and the recovery menu path |
| Test surface | 73 test files reference `invokeInteractive` |
| Migration surface | Likely — a change to the plugin provider contract is a breaking surface under the Release & Update Gates and would carry a `## Migration` block |

## Rationale

The chosen approach (see `.memory/decisions/2026-08-24-streaming-dispatch-usage-capture.md`) is not
the flag patch; it is the collapse of `invoke()` and `invokeInteractive()` into one dispatch path
parameterized by whether the run renders live. That converts a two-line telemetry fix into a change
to a **published provider interface with an external implementor contract**: `plugin-loader.ts`
rejects any third-party `llm_provider` plugin missing `invokeInteractive`, so how the collapse
treats that member — removed, retained as a deprecated delegator, or made optional — is a real
architectural decision with a consumer-migration consequence, not an implementation detail.

Layered on top of that are a behavior change on every streaming dispatch (the provider is asked for
a machine envelope it was not previously asked for), a re-establishment of live operator visibility
through `onProviderStream`, preservation of the REPL and recovery-menu paths in plain text, and a
73-file test surface.

Multi-day, contract-breaking, two external CLIs. → **Large.** All DECIDE steps apply:
`/architecture-diagram`, `/architecture-review`, `/conflict-check`, and `/coherence-check` all run.
