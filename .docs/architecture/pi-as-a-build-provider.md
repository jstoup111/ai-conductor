# Architecture: Pi as a build provider (#1884)

**Last updated:** 2026-09-24
**Scope:** A single built-in provider catalog that replaces every hardcoded `claude`/`codex` list,
boot-time discovery that registers only installed providers and fails fast on a configured-but-missing
one, plus a third built-in adapter for the Pi CLI (`pi -p --no-session --mode json`).

## Current state (grounding)

Two built-in providers are registered by hand (`engine/plugin-loader.ts:226-228`). About 25
production sites hardcode the pair as literal unions or branches. Among them:

- `engine/config.ts` — `BUILT_IN_MODEL_PROVIDERS`
- `engine/self-host/provider-home.ts:12` — `SelfHostProviderId`
- `execution/child-environment.ts:54` — `REVIEW_PROVIDER_PREFIXES`
- `execution/llm-provider.ts:169,294`
- `engine/step-runners.ts` (lines 651, 693-703, 2723, 2842, 3508)
- `engine/build-review-containment.ts`, `engine/build-review-policy-*.ts`
- `engine/self-host/live-boundary.ts:205,283`
- `engine/smoke-capability.ts:43`
- `engine/conductor.ts:6310`

## System Context (L1)

```mermaid
graph TD
    Operator["Operator<br/>edits .ai-conductor/config.yml"]
    Harness["ai-conductor harness<br/>daemon + conduct engine"]
    Claude["Claude Code CLI"]
    Codex["Codex CLI"]
    Pi["Pi CLI (pi.dev)<br/>@earendil-works/pi-coding-agent"]
    Upstream["LLM APIs<br/>reached by each CLI"]

    Operator -->|"llm_provider: pi / [pi, claude]"| Harness
    Harness -->|"subprocess"| Claude
    Harness -->|"subprocess"| Codex
    Harness -->|"NEW: pi -p --no-session --mode json"| Pi
    Claude --> Upstream
    Codex --> Upstream
    Pi --> Upstream
```

## Containers (L2)

```mermaid
graph LR
    subgraph engine["conduct engine (Node process)"]
        Config["Config loader + validator"]
        Registry["Plugin registry<br/>llm_provider kind"]
        Runtime["Provider runtime<br/>candidate ladder + readiness"]
        Steps["Step runners"]
    end
    PiProc["pi subprocess<br/>one per invocation"]
    Events[".pipeline/events.jsonl<br/>existing event spine"]

    Config --> Registry
    Steps --> Runtime
    Runtime --> Registry
    Runtime -->|"spawn, stdin prompt"| PiProc
    PiProc -->|"JSONL stdout + stderr + exit code"| Runtime
    Runtime --> Events
```

## Components (L3)

```mermaid
graph TD
    subgraph catalog["NEW execution/provider-catalog.ts: single source of truth"]
        Table["BUILT_IN_PROVIDERS descriptor table<br/>id, factory, env prefixes,<br/>home variable, executable env var"]
        Caps["Capability flags per descriptor<br/>readiness, selfHost,<br/>buildReviewContainment, reviewPolicyCatalog"]
        Types["Derived types<br/>BuiltInProviderId = ids of table<br/>ProviderWith«capability»"]
        Table --> Caps
        Table --> Types
    end

    subgraph adapters["execution/ adapters"]
        CP["claude-provider.ts"]
        XP["codex-provider.ts"]
        PP["NEW pi-provider.ts<br/>argv builder, JSONL parser,<br/>failure classifier"]
    end

    Discovery["NEW provider-discovery.ts<br/>resolve executable + --version probe<br/>per descriptor"]
    Loader["plugin-loader.ts<br/>registers only installed descriptors"]
    Validator["config.ts validator<br/>unknown-provider error lists table ids"]
    Consumers["Capability consumers<br/>self-host home, live-boundary,<br/>build-review containment and policy,<br/>child-environment prefixes, smoke"]
    RT["provider-runtime.ts<br/>readinessFor + fallback ladder"]

    Table -->|"factory"| CP
    Table -->|"factory"| XP
    Table -->|"factory"| PP
    Discovery --> Table
    Loader --> Discovery
    Validator -->|"configured ids ⊆ installed ids"| Loader
    Validator --> Table
    Consumers -->|"narrow by capability,<br/>never by literal id"| Caps
    RT --> Caps
```

## Sequence: Boot-time provider discovery

```mermaid
sequenceDiagram
    participant D as Daemon / conduct boot
    participant Disc as Provider discovery
    participant Cat as Provider catalog
    participant Reg as Plugin registry
    participant V as Config validator

    D->>Disc: discover()
    Disc->>Cat: list built-in descriptors
    loop each descriptor
        Disc->>Disc: resolve executable (override env var or PATH)
        Disc->>Disc: run executable --version
    end
    Disc-->>D: installed set + missing set with reason
    D->>Reg: register installed descriptors only
    D->>V: validate config provider references
    alt every configured provider installed
        V-->>D: ok, boot continues
    else a configured provider is missing
        V-->>D: error naming provider, step, and missing reason
        D->>D: refuse to start, non-zero exit
    end
```

## Sequence: Pi step dispatch with fallback

```mermaid
sequenceDiagram
    participant S as Step runner
    participant R as Provider runtime
    participant P as PiProvider
    participant CLI as pi subprocess
    participant N as Next candidate

    S->>R: invoke(step, candidates [pi, claude])
    R->>P: invoke(prompt, cwd, model)
    P->>CLI: spawn pi -p --no-session --mode json
    alt success
        CLI-->>P: JSONL agent_end, usage, exit 0
        P-->>R: InvokeResult ok + output
        R-->>S: normal verdict
    else classified failure
        CLI-->>P: stderr text, exit non-zero, or ENOENT
        P-->>R: InvokeResult with signal (authFailure, rateLimited, modelUnavailable, providerUnavailable)
        R->>N: advance ladder exactly as for claude/codex
        N-->>R: result
        R-->>S: verdict
    end
```

## Legend

- **NEW** marks a component this feature adds. Everything else already exists and is edited.
- **Capability flags** describe what a descriptor supports. Pi declares none of the capabilities
  owned by sibling intakes: selfHost (#1887), containment (#1886), and the review policy catalog
  and skills (#1888). Consumers therefore refuse or skip Pi through the capability check, with a
  named error, rather than through a hardcoded list. Those intakes turn the flags on later.
- `«capability»` is a type-parameter placeholder.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-24 | Added boot-time discovery | Operator expanded scope: register installed providers, fail on configured-but-missing |
| 2026-09-24 | Initial generation | DECIDE for #1884 (Tier L, operator requested full diagrams) |
