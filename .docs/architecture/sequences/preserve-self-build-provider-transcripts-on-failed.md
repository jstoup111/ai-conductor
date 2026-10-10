# Sequence: Capture, then retain or prune, a self-host provider transcript

**Last updated:** 2026-10-10
**Scope:** The two halves of #611 — harvest at scratch release (and at dead-owner sweep), and the
later keep/prune decision once the conductor has the step verdict.

## Diagram: normal attempt

```mermaid
sequenceDiagram
    participant CV as Conductor
    participant PE as Provider execution
    participant CH as Provider child process
    participant HV as Transcript harvester
    participant SCR as Scratch home
    participant ST as .pipeline/transcripts
    participant BUS as Event spine

    CV->>PE: dispatch step «step» attempt «n»
    PE->>SCR: acquire home
    PE->>CH: spawn with provider home env
    CH->>SCR: write session transcript files
    CH-->>PE: exit - success, failure, or zero work
    PE->>HV: harvest before release - in the existing finally
    HV->>SCR: match descriptor transcripts.globs only
    HV->>ST: copy to «step»/«runId»-a«n»
    HV->>BUS: provider_transcripts_captured
    PE->>SCR: release home - unchanged rm
    PE-->>CV: step result
    CV->>CV: decide verdict incl. no_task_progress
    alt failed, stalled, no_task_progress, or HALT
        CV->>ST: retain capture
        CV->>BUS: provider_transcripts_retained
    else success with progress
        CV->>ST: prune capture
        CV->>BUS: provider_transcripts_pruned
    end
    Note over ST: count and size cap evicts oldest retained captures
```

## Diagram: killed attempt recovered by the sweep

```mermaid
sequenceDiagram
    participant CH as Provider child process
    participant SW as Dead-owner sweeper
    participant HV as Transcript harvester
    participant SCR as Scratch home
    participant ST as .pipeline/transcripts
    participant BUS as Event spine

    CH--xSCR: killed - finally never runs
    SW->>SCR: lease names a dead owner
    SW->>HV: harvest before reclaim
    HV->>ST: copy allowlisted files, marked interrupted
    HV->>BUS: provider_transcripts_captured - interrupted
    SW->>SCR: reclaim home - unchanged
    Note over ST: interrupted captures are always retained
```

## Diagram: operator post-mortem

```mermaid
sequenceDiagram
    participant OP as Operator
    participant CLI as ai-conductor transcripts
    participant EV as .pipeline/events.jsonl
    participant ST as .pipeline/transcripts

    OP->>CLI: ai-conductor transcripts «slug»
    CLI->>EV: read capture and retention events
    CLI->>ST: read retained capture files
    CLI-->>OP: list captures and final assistant message
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #611 — self-build transcripts deleted on teardown |
