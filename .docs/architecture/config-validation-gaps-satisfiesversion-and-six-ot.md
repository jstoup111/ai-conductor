# Components: Config validation gaps (issue #1026)

**Last updated:** 2026-09-28
**Scope:** where each of the seven #1026 validation fixes sits in the config load path —
`validateConfig` and its per-block helpers, the post-validation `harness_version` gate in
`loadProjectConfig`, and the existing warning / deprecated-key channels the fixes reuse.

## Components

```mermaid
graph TD
    Y[".ai-conductor/config.yml<br/>+ ~/.ai-conductor/config.yml"] --> P["YAML parse<br/>loadProjectConfig / loadMergedConfig"]
    P -->|"parse_error: hard fail<br/>(docstring corrected, behaviour kept)"| E["ConfigResult ok:false"]
    P --> V["validateConfig<br/>top-level + steps inline"]
    V --> HV["harness_version<br/>must be a string and a valid semver range"]
    V --> ST["steps.«name»<br/>disable and when: messages state the real rule"]
    V --> W["top-level wiring<br/>deprecated no-op, dropped from config"]
    V --> MV["validateMarkdownViewerBlock<br/>command/args/mode required<br/>when preset absent or custom"]
    V --> MR["validateMermaidRendererBlock<br/>preset required, the only field read"]
    HV -->|invalid| E
    ST -->|invalid| E
    MV -->|invalid| E
    MR -->|invalid| E
    W --> WR["warnings[] + deprecatedKeys[]<br/>adr-2026-08-14-retire-build-review-wiring-rubric"]
    WR --> EV["emitDeprecatedConfigKeyEvents<br/>existing event spine"]
    V -->|ok| RO["resolveOtelConfig<br/>protocol in http/protobuf or grpc"]
    RO -->|"unsupported protocol"| TD["telemetry disabled<br/>named error, run continues"]
    V -->|ok| G["satisfiesVersion<br/>semver.satisfies(installed, constraint)"]
    EP["CLI run path (index.ts)<br/>+ daemon startup (daemon-cli.ts)"] --> RV["installedHarnessVersionForConfig<br/>module-relative VERSION, undefined when unknown"]
    RV -->|"harnessVersion argument<br/>loadConfig / loadMergedConfig"| G
    EP -->|"merged deprecatedKeys"| EV
    G -->|"not satisfied"| VM["ConfigResult version_mismatch"]
    G -->|satisfied| OK["ConfigResult ok:true"]
    SV[("semver dependency<br/>already used by plugin-manifest.ts")] --> HV
    SV --> G
```

## Diagram — harness_version gate

```mermaid
sequenceDiagram
    participant Load as loadProjectConfig
    participant Val as validateConfig
    participant Sem as semver
    participant Gate as satisfiesVersion

    Load->>Val: parsed project config
    alt harness_version is not a string
        Val-->>Load: validation_error naming harness_version
    else harness_version is a string
        Val->>Sem: validRange(«constraint»)
        alt range is invalid
            Val-->>Load: validation_error naming the constraint
        else range is valid
            Val-->>Load: ok, config
        end
    end
    Load->>Gate: installed «version», «constraint»
    Gate->>Sem: satisfies(«version», «constraint»)
    alt not satisfied
        Gate-->>Load: false, version_mismatch
    else satisfied
        Gate-->>Load: true, config returned
    end
```

## Legend

- «constraint» — the project's `harness_version` value; caret, tilde, hyphen range, comparator
  sets and exact versions are all evaluated by `semver`, none silently pass.
- «version» — the installed harness version read from the repository `VERSION` file.
- Solid edges into `ConfigResult ok:false` are validation failures introduced or tightened by this
  change; each names the offending key.
- The `wiring` path does not fail: it reuses the same warning + `deprecatedKeys` channel that
  retired `build_review` keys already use, so the deprecation is visible on the event spine and no
  consumer config breaks.
- No new module, persistence, or external dependency is added; every box is an existing function
  in `src/conductor/src/engine/config.ts` except `resolveOtelConfig`
  (`src/conductor/src/engine/otel/otel-config.ts`) and `semver` (existing dependency).

> **Amended 2026-09-28 by #1026:** conflict-check withdrew the `when` + `parallel` rejection (ADR `004-when-parallel-workflow-dsl` supports it) and moved the `otel.protocol` check to `resolveOtelConfig`, which disables telemetry rather than failing config load.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-28 | Initial generation | DECIDE for issue #1026 (spec authoring) |
| 2026-09-28 | Removed when+parallel rejection; otel.protocol moved to resolveOtelConfig | Conflict-check resolutions (ADR 004; otel-observability stories) |
