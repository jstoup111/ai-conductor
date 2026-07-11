# Components: Daemon Stall Remediation (halt-user-input-required → /remediate)

**Last updated:** 2026-07-10
**Scope:** How a `halt_marker` build stall in daemon mode is routed through the existing
`/remediate` machinery before it may become a feature HALT (#459). Interactive mode is
unchanged (REPL handoff). The implicit `no_task_progress` stall is out of scope (#280).

## Diagram

```mermaid
graph TD
    subgraph BuildDispatch["Build dispatch (agent side)"]
        AGENT["Build agent (/pipeline skill)"]
        MARKER[".pipeline/halt-user-input-required<br/>(one-line question)"]
        AGENT -- "cannot proceed autonomously" --> MARKER
    end

    subgraph RetryLoop["Conductor retry loop (conductor.ts)"]
        GATE["build completion gate miss"]
        BREAKER["stall breaker<br/>reason = halt_marker"]
        CAPTURE["NEW: read marker content<br/>BEFORE clearHaltMarker"]
        EVID[".pipeline/build-stall-question.md<br/>(persisted evidence)"]
        RESUME["NEW: resume branch<br/>attempt-- no retry burned<br/>(sessionExpired idiom)"]
    end

    subgraph Remediation["Remediation machinery (existing, reused)"]
        PLANREM["planRemediation<br/>NEW trigger: build_stall"]
        SKILL["/remediate dispatch<br/>remediation-planner agent"]
        RJSON[".pipeline/remediation.json<br/>dispositions"]
    end

    subgraph Outcomes
        HINT["retry hint carries the answer<br/>pendingRetryHints"]
        HALT[".pipeline/HALT<br/>carries question verbatim"]
    end

    MARKER --> GATE
    GATE --> BREAKER
    BREAKER --> CAPTURE
    CAPTURE --> EVID
    CAPTURE -- "interactive mode: unchanged REPL path" --> REPL["runInteractive('build')"]
    EVID -- "daemon mode, remediationRounds under budget" --> PLANREM
    PLANREM --> SKILL
    SKILL --> RJSON
    RJSON -- "disposition = route (answerable)" --> HINT
    HINT --> RESUME
    RJSON -- "disposition = halt<br/>(architectural-clarity or product-scope)" --> HALT
    PLANREM -- "dispatch fails OR budget exhausted<br/>(fail-safe)" --> HALT
```

## Legend

- **NEW** nodes are the additions of #459; everything under *Remediation machinery* exists
  today and is reused unchanged except for the new `build_stall` trigger.
- `remediationRounds` / `MAX_KICKBACKS_PER_GATE` is the shared bound — stall remediations
  consume the same budget as prd_audit/finish/as-built remediations.
- Fail-safe invariant: any path that ends in `.pipeline/HALT` must carry the agent's
  question verbatim as the first line — never the generic "retries exhausted" string.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE for #459 (engineer spec) |
