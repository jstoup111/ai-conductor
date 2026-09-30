# Architecture: Pi per-step model selection via wrapped providers (#1885)

**Last updated:** 2026-09-29
**Scope:** Pi-dispatched steps run on an operator-chosen `provider/id` model at a `--thinking` level
mapped from the harness `effort`. Selection, tier promotion, retry escalation, and the availability
fallback ladder use the existing string-based model machinery. Config validation and a boot-time
`pi --list-models` probe reject unknown selections. The model table widens to N catalog-derived
provider column pairs.

## Current state (grounding)

- `execution/pi-provider.ts:129` spawns `pi -p --no-session --mode json` and passes no `--model`,
  `--provider`, or `--thinking`; `InvokeOptions.model`/`effort` are received and ignored.
- `execution/provider-catalog.ts:65-77`: `PI_MODEL_POLICY` sets every `stepModels` entry to `''`.
  It has a single `''` rung for `modelEscalationOrder` and `modelFallbackLadder`, and copies
  Claude's `effortOrder`. The pi descriptor declares `capabilities: {}`. `PROVIDER_CAPABILITY_OWNERS`
  has no #1885 entry.
- `engine/config.ts:737-738` only checks that a step `model` is a string. There is no
  provider-aware model validation and no configurable escalation order.
- `engine/resolved-config.ts:252-296` resolves the per-step model, and `FALLBACK_MODEL='sonnet'`
  (:95) is the last resort. For a Pi step that fallback is a meaningless Claude alias.
- `engine/escalation.ts:62-110` bumps effort, then the model, through the policy's orders.
- `src/conductor/src/tools/generate-model-table.ts:316-346,395` hardcodes two provider column pairs
  (`Claude model | Claude effort | Codex model | Codex effort`), spliced into ARCHITECTURE.md.
- `index.ts:505-532` runs boot discovery and `validateProviderInstallation` on
  provider-dispatching commands only. This spec adds the model probe at this seam.
- Events `provider_attempt`, `step_completed`, and `step_retry` already carry optional
  `model`/`effort`/`provider` (`types/events.ts:279,726,886`).

## System Context (L1)

```mermaid
graph TD
    Operator["Operator<br/>edits .ai-conductor/config.yml"]
    Harness["ai-conductor harness<br/>daemon + conduct engine"]
    Pi["Pi CLI (pi.dev)"]
    Upstreams["Underlying LLM providers<br/>anthropic, openai, google, ..."]

    Operator -->|"steps.X.model: provider/id<br/>steps.X.effort<br/>pi escalation + fallback ladder"| Harness
    Harness -->|"CHANGED: pi -p --model provider/id --thinking level"| Pi
    Harness -->|"NEW at boot: pi --list-models"| Pi
    Pi --> Upstreams
```

## Containers (L2)

```mermaid
graph LR
    subgraph engine["conduct engine (Node process)"]
        Config["Config loader + validator"]
        Boot["Boot discovery<br/>index.ts provider-dispatching path"]
        Resolver["Resolved config<br/>per-step model + effort"]
        Runtime["Provider runtime<br/>escalation + fallback ladder"]
    end
    PiProc["pi subprocess"]
    Events[".pipeline/events.jsonl<br/>existing event spine"]
    Table["ARCHITECTURE.md model table<br/>bin/generate-model-table"]

    Config --> Resolver
    Boot -->|"model probe"| PiProc
    Resolver --> Runtime
    Runtime -->|"spawn with model + thinking"| PiProc
    Runtime -->|"provider_attempt, step_retry,<br/>step_completed carry provider/id"| Events
    Table -->|"reads catalog policies"| Config
```

## Components (L3)

```mermaid
graph TD
    subgraph catalog["execution/provider-catalog.ts"]
        Desc["pi descriptor<br/>unchanged capabilities"]
        Policy["PI_MODEL_POLICY<br/>CHANGED: no built-in models,<br/>config-required marker"]
        Desc --> Policy
    end

    PiModel["NEW parsePiModelId + parsePiModelListing<br/>in pi-provider.ts, exposed as descriptor fields"]
    Sel["NEW engine/provider-model-config.ts<br/>collectProviderModelSelections"]
    Validator --> Sel
    Probe --> Sel
    Adapter["execution/pi-provider.ts<br/>CHANGED argv: --model, --thinking"]
    Validator["engine/config.ts validator<br/>CHANGED: Pi id syntax, pi configured requires<br/>llm_providers.pi model + escalation + ladder,<br/>NEW llm_providers.«id» ladder + escalation keys"]
    Probe["NEW engine/provider-model-probe.ts<br/>descriptor modelCatalog, injectable runner"]
    BootVal["engine/provider-selection.ts<br/>NEW unknown-Pi-model boot error"]
    Resolved["engine/resolved-config.ts<br/>CHANGED: no Claude alias fallback for Pi"]
    Esc["engine/escalation.ts + model-availability.ts<br/>walk configured Pi rungs"]
    Gen["tools/generate-model-table.ts<br/>CHANGED: N catalog provider column pairs"]

    Adapter --> PiModel
    Validator --> PiModel
    Validator --> Desc
    Probe --> BootVal
    BootVal --> PiModel
    Resolved --> Policy
    Esc --> Resolved
    Gen --> Policy
```

## Sequence: Pi step dispatch with escalation and fallback

```mermaid
sequenceDiagram
    participant S as Step runner
    participant R as Resolved config
    participant E as Escalation + ladder
    participant A as Pi adapter
    participant P as pi CLI
    participant EV as Event spine

    S->>R: resolve model + effort for step on pi
    R-->>S: anthropic/«id», effort high
    S->>E: attempt n
    E-->>S: model + effort for attempt n
    S->>A: invoke(model, effort)
    A->>P: pi -p --model anthropic/«id» --thinking high
    alt model unavailable
        P-->>A: model-unavailable stderr
        A-->>E: modelUnavailable
        E->>EV: provider_attempt with next rung, logged
        E->>A: invoke(next provider/id rung)
    else success
        P-->>A: JSONL result
        A-->>S: output
        S->>EV: step_completed with provider pi, model, effort
    end
```

## Sequence: Boot-time Pi model validation

```mermaid
sequenceDiagram
    participant B as conduct boot
    participant V as Config validator
    participant D as Provider discovery
    participant Q as Pi model probe
    participant P as pi CLI

    B->>V: load config
    V-->>B: provider/model syntax ok, or specific error
    B->>D: discover installed providers
    D-->>B: pi installed
    B->>Q: probe configured Pi model ids
    Q->>P: pi --list-models
    P-->>Q: available provider/id list
    alt every configured Pi model listed
        Q-->>B: ok, boot continues
    else a configured model missing
        Q-->>B: error naming model, config path, step
    end
```

## Legend

- **NEW**: component or call added by this spec. **CHANGED**: existing component whose behavior
  changes. Everything else is unchanged context.
- `provider/id` is Pi's canonical underlying-provider model id (for example
  `anthropic/claude-opus-4-5`). Thinking is never encoded as a `:suffix`; it is always derived
  from `effort`.
- «id» marks a variable part of a label.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-29 | Initial generation | DECIDE for #1885 (Pi per-step model selection) |
| 2026-09-29 | Plan update: named probe, selection enumerator, parser seams | /plan for #1885 |
| 2026-09-29 | Conflict check: llm_providers.pi model, escalation and ladder required; top ladder exempts Pi only | Operator decisions |
| 2026-09-29 | Dropped modelSelection flag; static check is syntax-only; added llm_providers block | Architecture review decisions |
