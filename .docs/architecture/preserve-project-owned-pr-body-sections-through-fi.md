# Sequence: Project-owned PR body regions survive FINISH (issue #2616)

**Last updated:** 2026-09-24
**Scope:** how a custom step's pull request body contribution, declared by a step-keyed region
in the project's pull request template, travels from the SHIP draft through FINISH to the ready
flip — replacing the self-host-only `Release-*` snapshot/restore.

## Components

```mermaid
graph LR
    T[".github/pull_request_template.md<br/>step-keyed regions"] --> V["Config load<br/>region declarations validated<br/>against declared custom steps"]
    T --> D["SHIP draft PR<br/>body seeded from template"]
    V --> K["Region capture<br/>on owning step success"]
    K --> S[("Persisted region captures<br/>per PR, per step key")]
    S --> R["Region re-insert + verify<br/>after every FINISH body rewrite"]
    A["author_pr_prose /<br/>judge_pr_prose repair"] --> R
    F["Body floor /<br/>halt-PR rehabilitation"] --> R
    R --> Y["ready flip<br/>ensureShipReady"]
    X["Release-* snapshot/restore<br/>(self-host) — deleted"] -.-> R
```

## Diagram — region lifecycle

```mermaid
sequenceDiagram
    participant Cfg as Config load
    participant Ship as SHIP draft
    participant Step as Custom step «key»
    participant Cap as Region capture
    participant Store as Region store
    participant Fin as FINISH coordinator
    participant GH as Pull request body

    Cfg->>Cfg: parse template regions, each names «key»
    alt «key» is built-in or undeclared
        Cfg-->>Cfg: reject config load, naming the marker
    end
    Ship->>GH: create draft body from template (regions present)
    Step->>GH: write content inside region «key»
    Step-->>Cap: step reports success
    Cap->>GH: read body, extract region «key» bytes
    alt region missing or empty
        Cap-->>Fin: halt naming step «key»
    else region present
        Cap->>Store: persist bytes for «pr», «key»
    end
    Fin->>GH: author_pr_prose / judge repair / body floor rewrite
    Fin->>Store: load captured regions for «pr»
    Fin->>GH: re-insert each region byte-for-byte
    Fin->>GH: re-read body and compare every region
    alt any region differs
        Fin-->>Fin: halt naming step «key», no ready flip
    else all regions match
        Fin->>GH: mark ready for review
    end
```

## Legend

- «key» — a `steps.«key»` entry in `.ai-conductor/config.yml` that is not a built-in step.
- «pr» — the retained draft pull request URL; captures are keyed by it so a re-dispatch in a
  fresh process reuses them, as the deleted `.pipeline/release-metadata-snapshot.json` did.
- Engine-owned regions (reduced build-review coverage, accepted risk, plan declaration line,
  closing reference) keep their own upsert paths and can never be named by a template region.
- A template with no step regions leaves every path above inert: today's draft body (when no
  template exists) and today's FINISH body are unchanged.
- The dashed edge marks the self-host `Release-*` snapshot/restore this change removes; this
  repository's `release-disposition` step becomes an ordinary region owner.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-24 | Initial generation | DECIDE for issue #2616 (spec authoring) |
