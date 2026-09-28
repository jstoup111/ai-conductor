# Components: Per-Project Work-Tracker Backend Selection (#845)

**Last updated:** 2026-09-28
**Scope:** Target-state component view of per-project tracker backend selection at the intake
composition root. It covers the project `tracker` config key reserved by
adr-2026-07-22-canonical-tracker-client-seam, the single resolver that reads it, and the
`buildIntake()` backend factory. That factory assembles a composite intake source/port for poll,
claim, and the land/handoff write-backs. Daemon backlog (#851), close/linkage (#852), and
gate/halt write-backs (#853) are out of scope. Paths are relative to `src/conductor/src/engine/`.

## Diagram

```mermaid
graph TD
    subgraph Registry["Project registry (unchanged)"]
        REG["registry.ts<br/>ProjectRecord: name, path, remote<br/>(no tracker field)"]
    end

    subgraph ProjectCfg["Per-project config (committed in each target repo)"]
        YML["«project»/.ai-conductor/config.yml<br/>tracker: backend github or jira,<br/>transport, credentials reference,<br/>site, project_key (Jira only)"]
    end

    subgraph Config["Config validation"]
        TYPES["types/config.ts<br/>NEW TrackerConfig type"]
        VALID["config.ts<br/>tracker in accepted-key universe<br/>+ shape validation (fail closed)"]
    end

    subgraph Selection["NEW: tracker selection"]
        RES["tracker-selection.ts<br/>resolveTrackerSelection(projectPath)<br/>absent key = github default"]
        FACT["backend factory map<br/>github: createGithubIssuesAdapter<br/>jira: not registered until #849"]
    end

    subgraph Root["Intake composition root (engineer-cli.ts)"]
        BI["buildIntake()<br/>groups registered projects by backend"]
        COMP["intake-backend-composite.ts<br/>composite IntakeSource + IntakePort<br/>poll: github-selected projects only<br/>report: routed by sourceRef owner"]
        DIAG["tracker_backend_unavailable<br/>(ConductorEvent, once per episode)"]
    end

    subgraph Callers["Callers (signatures unchanged)"]
        POLL["compose pre-poll / poll / claim<br/>intake-loop-cli"]
        WB["land: reportRouted<br/>handoff: reportDone"]
    end

    subgraph Adapters["Backend adapters"]
        GHA["engineer/intake/github-issues.ts<br/>(unchanged)"]
        JIRA["JiraAdapter (#849, deferred)"]
    end

    REG --> BI
    YML --> VALID
    TYPES --> VALID
    VALID --> RES
    BI --> RES
    RES --> FACT
    FACT --> GHA
    FACT -. "#849" .-> JIRA
    BI --> COMP
    BI --> DIAG
    COMP --> GHA
    POLL --> BI
    WB --> BI
```

## Legend

- **Registry (unchanged):** the machine-local registry keeps its record shape. Backend selection is
  committed project config, not registry state.
- **tracker-selection.ts (new):** the only reader of the `tracker` key. It returns a validated
  `TrackerSelection` and defaults to `github` when the key is absent.
- **Composite source/port:** polls each backend over its own projects and routes `report()` to the
  backend that owns the `sourceRef`. For an all-GitHub registry it delegates to exactly one GitHub
  adapter built as today, so the path stays byte-for-byte identical.
- **Dashed edge:** deferred integration. A `jira` project is excluded from polling and produces one
  diagnostic event until #849 registers an adapter.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-28 | Initial generation | #845 DECIDE: per-project tracker backend selection |
| 2026-09-28 | Named the composite module and the event | #845 plan update |
