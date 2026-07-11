# Sequence: Daemon halt_marker stall → /remediate → resume or HALT

**Last updated:** 2026-07-10
**Scope:** Daemon-mode flow for #459 — from the build agent writing
`.pipeline/halt-user-input-required` to either an answered resume (no retry burned) or a
question-carrying HALT.

## Diagram

```mermaid
sequenceDiagram
    participant BA as Build agent
    participant CL as Conductor retry loop
    participant FS as .pipeline files
    participant PR as planRemediation
    participant RP as remediation-planner (/remediate)

    BA->>FS: write halt-user-input-required («question»)
    CL->>CL: build gate miss
    CL->>FS: read marker CONTENT (new - before clear)
    CL->>FS: persist build-stall-question.md
    CL->>FS: clearHaltMarker (ack, as today)
    CL->>CL: emit build_stall reason halt_marker

    alt daemon mode and remediationRounds under budget
        CL->>PR: trigger build_stall with question evidence
        PR->>RP: dispatch /remediate (question + committed artifacts)
        RP->>FS: write remediation.json dispositions
        PR-->>CL: outcome
        alt disposition route (answerable)
            CL->>CL: set retry hint = answer
            CL->>CL: attempt-- (no retry burned), continue build
        else disposition halt (architectural-clarity / product-scope)
            CL->>FS: write HALT carrying «question» verbatim
        end
    else remediation dispatch fails or budget exhausted (fail-safe)
        CL->>FS: write HALT carrying «question» verbatim
    end

    note over CL: interactive mode unchanged - runInteractive('build') REPL
```

## Legend

- «question» = the one-line blocker text the build agent wrote into the marker.
- The `attempt--` resume mirrors the sessionExpired no-burn idiom (conductor.ts:1497).
- Budget = existing `remediationRounds < MAX_KICKBACKS_PER_GATE`; no new counter.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE for #459 (engineer spec) |
