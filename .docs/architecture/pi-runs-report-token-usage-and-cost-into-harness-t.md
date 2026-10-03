# Architecture: Pi runs report token usage and cost into harness telemetry (#1889)

**Last updated:** 2026-10-02
**Scope:** A completed Pi dispatch writes truthful token usage and a cost to the existing
`provider_attempt` event. Usage comes from Pi's per-turn assistant messages. Cost comes from Pi's
own figure when it reports one, falls back to the committed rate card for the model that ran, and
otherwise stays tokens-only. A run with no usage is recorded as unmetered and never zero-filled.
The model the cost was attributed to is recorded beside it. No new channel is introduced.

## Current state (grounding)

- `src/conductor/src/execution/pi-provider.ts:153-165` reads usage from a top-level `event.usage`
  on `message_update` / `message_end` lines. Pi 0.84.3 emits no such field: the
  `pi-agent-core` event union is `{ type: "message_end"; message: AgentMessage }`, and usage lives
  on `AssistantMessage.usage` (`pi-ai/dist/types.d.ts:265-286, 307-327`). The repository fixture
  `src/conductor/test/fixtures/pi/terminal-assistant.jsonl` is hand-authored in the non-existent
  shape.
- `pi-provider.ts:171-173` zero-fills `{ input: 0, output: 0 }` whenever an assistant turn was seen
  and no usage parsed. Every live Pi dispatch therefore records fabricated zero usage as
  `cost-unmetered`.
- Pi's `Usage` carries fresh-only `input` (Pi subtracts cached volume, e.g.
  `openai-responses-shared.js:444-445`), `output`, `cacheRead`, `cacheWrite`, optional
  `reasoning` (a subset of `output`), and `cost.total`, which Pi computes from its model registry
  (`pi-ai/dist/models.js:527`, tiered and 1h-cache aware). Each assistant message is one LLM call,
  so its usage is per-turn and a step total is the sum across turns.
- `AssistantMessage` carries `provider` and `model` (and optional `responseModel`): the model that
  actually ran.
- `execution/rate-card.ts:152` `applyRateCard(usage, model, card)` prices token-only usage and sets
  `costSource: 'rate-card'`; it leaves provider-reported cost untouched and fails closed on an
  unknown model. Only `codex-provider.ts:372,544` calls it today. The card is keyed by bare model
  id (`.ai-conductor/rate-card.json`).
- `engine/metering.ts` classifies `fully-metered` / `cost-unmetered` / `unmetered` from
  `TokenUsage` alone. `engine/cost-rollup.ts:78-142` is provider-agnostic and buckets cost by
  `step`, `event.model`, and `costSource`. `engine/otel/span-manager.ts:370` exports
  `costSource`.
- The pi descriptor declares `capabilities: {}` (`execution/provider-catalog.ts`), so Pi is outside
  `COST_SELF_REPORTING_PROVIDERS` (`engine/provider-model-policy.ts:68`).

## Containers (L2)

```mermaid
graph LR
    subgraph engine["conduct engine (Node process)"]
        Adapter["PiProvider adapter<br/>CHANGED: usage + cost parsing"]
        Card["Rate card loader<br/>existing, now also used by Pi"]
        Runtime["Provider runtime<br/>emits provider_attempt"]
    end
    PiProc["pi subprocess<br/>pi -p --no-session --mode json"]
    CardFile[".ai-conductor/rate-card.json<br/>committed durable state"]
    Events[".pipeline/events.jsonl<br/>existing event spine"]
    Consumers["metering, cost rollup at ship,<br/>OTel spans, feature usage line"]

    Runtime -->|"invoke"| Adapter
    Adapter -->|"spawn"| PiProc
    PiProc -->|"JSONL: message_end with message.usage,<br/>message.provider, message.model"| Adapter
    Adapter -->|"fallback lookup"| Card
    Card --> CardFile
    Adapter -->|"TokenUsage or none"| Runtime
    Runtime -->|"provider_attempt.tokenUsage"| Events
    Events --> Consumers
```

## Components (L3)

```mermaid
graph TD
    subgraph pi["execution/pi-provider.ts"]
        Parse["parsePiJsonl<br/>CHANGED: sum message.usage per assistant turn,<br/>capture Pi cost.total and the model that ran,<br/>no zero-fill"]
        Price["NEW Pi cost resolution<br/>Pi cost if positive, else rate card, else none"]
        Invoke["PiProvider.invoke<br/>CHANGED: attaches resolved TokenUsage"]
        Parse --> Price --> Invoke
    end
    RateCard["execution/rate-card.ts<br/>applyRateCard + loadRateCard, unchanged"]
    Usage["execution/llm-provider.ts TokenUsage<br/>CHANGED: optional attributed-model field"]
    Metering["engine/metering.ts<br/>unchanged"]
    Rollup["engine/cost-rollup.ts<br/>unchanged inputs"]
    Fixture["test/fixtures/pi/*.jsonl<br/>CHANGED: real Pi 0.84.3 event shape"]

    Price -->|"bare model id"| RateCard
    Invoke --> Usage
    Usage --> Metering
    Usage --> Rollup
    Fixture -.->|"drives"| Parse
```

## Sequence: one Pi step's usage and cost

```mermaid
sequenceDiagram
    participant R as Provider runtime
    participant A as PiProvider
    participant P as pi subprocess
    participant C as Rate card
    participant E as Event spine

    R->>A: invoke(model provider/id, cwd)
    A->>P: pi -p --no-session --mode json
    P-->>A: message_end per assistant turn with message.usage
    A->>A: sum fresh input, output, cacheRead, cacheWrite, cost.total
    alt no assistant usage arrived, or the run failed
        A-->>R: tokenUsage absent
        R->>E: provider_attempt without tokenUsage (unmetered)
    else Pi reported a positive cost
        A-->>R: tokenUsage with costUsd, costSource provider, attributed model
        R->>E: provider_attempt (fully-metered)
    else Pi cost is zero or missing
        A->>C: applyRateCard(usage, model that ran)
        alt card prices the model
            C-->>A: costUsd, costSource rate-card
            A-->>R: tokenUsage with rate-card cost and attributed model
            R->>E: provider_attempt (fully-metered)
        else model not on the card
            C-->>A: usage unchanged
            A-->>R: tokenUsage without cost, attributed model
            R->>E: provider_attempt (cost-unmetered)
        end
    end
```

## Legend

- **CHANGED** marks an existing component whose behavior this spec alters; **NEW** marks a component
  added by this spec. Unmarked components are consumed unchanged.
- "Model that ran" is Pi's `message.provider` + `message.model` from the assistant messages, not the
  harness-requested model. When they differ, the cost is attributed to the model that ran.
- `costSource: 'provider'` is reused for Pi's own figure. A distinct label for Pi-computed estimates
  is out of scope (track scope boundary).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | #1889 DECIDE, approach B |
