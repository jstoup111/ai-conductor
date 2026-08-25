# Components: Unified provider dispatch path

**Last updated:** 2026-08-24
**Scope:** Proposed collapse of `LLMProvider.invoke()` and `LLMProvider.invokeInteractive()` into
one dispatch path parameterized by whether the run renders live. Covers both built-in adapters,
the `streamingProviderRuntimes` wrapper that today swaps one method for the other, and the plugin
contract that `plugin-loader.ts` enforces on third-party `llm_provider` implementations. The
reporting of totals is out of scope (deferred to #1863).

## Diagram

```mermaid
graph TD
    subgraph Callers["Dispatch callers"]
        AUTO["step-runners: autonomous steps - AUTONOMOUS_STEPS"]
        STREAM["step-runners: streaming steps - streamingProviderRuntimes wrapper"]
        REPL["Recovery menu interactive fix - REPL, operator-typed"]
        ATTR["attribution-lane delegator"]
        PLUG["Third-party llm_provider plugins - plugin-loader validated"]
    end

    subgraph Today["Today - two divergent methods on one interface"]
        INV["invoke - requests machine envelope, jsonOutput true"]
        INT["invokeInteractive - plain text, jsonOutput false, no onProviderStream"]
    end

    subgraph Proposed["Proposed - one dispatch path, one render decision"]
        DISPATCH["Single dispatch entry - invoke, takes an optional stream consumer"]
        ARGS["Shared argument construction - envelope flags always requested off the REPL path"]
        CLASSIFY["Shared classifyCompletion - parser always fed"]
        RENDER["Live visibility via the stream consumer - observation only, no authority"]
    end

    subgraph Result["Downstream, unchanged"]
        USAGE["TokenUsage on InvokeResult"]
        EVENT["provider_attempt event on the spine"]
        ROLL["cost-rollup - tokens and cost"]
    end

    AUTO --> INV
    STREAM --> INT
    REPL --> INT
    ATTR --> INT
    PLUG -.->|contract requires both members today| INT

    AUTO ==> DISPATCH
    STREAM ==> DISPATCH
    REPL ==> DISPATCH
    ATTR ==> DISPATCH
    PLUG ==>|contract requires invoke alone| DISPATCH

    DISPATCH --> ARGS
    ARGS --> CLASSIFY
    DISPATCH --> RENDER
    CLASSIFY --> USAGE
    USAGE --> EVENT
    EVENT --> ROLL

    INT -.->|usage discarded here today| ROLL
```

## Sequence: one streaming dispatch, today versus proposed

```mermaid
sequenceDiagram
    participant SR as step-runners
    participant W as streamingProviderRuntimes wrapper
    participant P as Provider adapter
    participant CLI as Provider CLI
    participant EV as Event spine

    Note over SR,EV: Today - the streaming path never asks for the envelope
    SR->>W: invoke(options)
    W->>P: invokeInteractive(options)
    P->>CLI: run with plain print flags, no envelope requested
    CLI-->>P: plain text on stdout
    P->>P: classifyCompletion(result, jsonOutput = false)
    Note right of P: tokenUsage is set to undefined here
    P-->>SR: InvokeResult without tokenUsage
    SR->>EV: provider_attempt - no usage recorded

    Note over SR,EV: Proposed - one path, envelope always requested off the REPL path
    SR->>P: invoke(options with stream consumer)
    P->>CLI: run with envelope flags for this provider
    CLI-->>P: machine envelope on stdout
    P->>P: stream consumer per chunk - operator sees live progress
    P->>P: classifyCompletion(result) - parser always fed
    P-->>SR: InvokeResult with tokenUsage
    SR->>EV: provider_attempt - usage recorded
```

## Legend

- **Solid arrows** — the call path taken today.
- **Double arrows (`==>`)** — the proposed call path.
- **Dotted arrows** — a contract or data relationship rather than a call: the plugin contract
  edge, and the point where usage is discarded today.
- **`streamingProviderRuntimes` wrapper** — the object in `step-runners.ts` whose only purpose is
  to make `invoke` route through `invokeInteractive`. Under the proposal it has nothing left to
  swap; whether it is deleted or retained for its other delegation duties is a design question the
  architecture review owns.
- **Plugin contract edge** — `plugin-loader.ts` today hard-fails an `llm_provider` plugin that does
  not implement `invokeInteractive`. The approved decision removes that member from `LLMProvider`
  and from the loader's required set, so the contract becomes `invoke` alone. This is strictly more
  permissive: no plugin that loads today stops loading, and a class with an extra method still
  satisfies `implements`. See `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`.
- **The stream consumer** — live observation is carried by an optional consumer object on
  `InvokeOptions`, deliberately not a boolean. It is the named extension point for future
  burn-based context control; its authority stays none, per
  `adr-2026-08-19-live-provider-stream-observation`.
- The REPL path is deliberately kept on plain text: an operator-facing conversational session
  rendered as a machine envelope is unusable, so it is the one caller that does not request one.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-24 | Initial generation | DECIDE for jstoup111/ai-conductor#1857 — streaming dispatches record no token usage or cost |
| 2026-08-24 | Plan-update pass | Reflects the approved decisions: `invokeInteractive` is removed rather than deprecated, and live observation is a stream-consumer seam rather than a render mode |
