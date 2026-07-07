# Architecture: audit-trail write-completeness for retro (ai-conductor#328)

**Last updated:** 2026-07-07
**Scope:** engine event-sink audit writer — every step/gate/retry/kickback/HALT outcome
appends a structured record to `.pipeline/audit-trail/events.jsonl` so `/retro` can
reconstruct run friction under fresh-session-per-step (#325) without conversational
recall. New elements marked with `*`.

## Diagram

```mermaid
flowchart TD
    subgraph LOOP[conductor engine loop - fresh session per step]
        DISPATCH[step dispatch via StepRunner] --> RETRY{retry loop attempt n}
        RETRY -->|attempt fails, budget left| RETRY
        RETRY --> OUTCOME[post-step outcome path]
        OUTCOME --> GV[computeAndWriteVerdict]
        OUTCOME --> KB[scanKickbackVerdicts]
        OUTCOME --> HALTW[writeHalt / writeHaltMarker]
    end

    CLR[clearHaltMarker + daemon watchHaltCleared] --> AT

    GV -->|GateVerdict object| GATES[.pipeline/gates/«step».json - unchanged]
    GV -->|same in-memory GateVerdict| AT

    RETRY -.->|*retry record, attempt n| AT
    KB -.->|*kickback record| AT
    HALTW -.->|*intervention record| AT

    AT[*audit-trail.ts - AuditTrailWriter, single writer]
    AT -->|append-only JSONL| EV[*.pipeline/audit-trail/events.jsonl]

    AH[autoheal.ts writeAuditFile - unchanged] --> DIR[.pipeline/audit-trail/]
    SK[pipeline + simplify skill artifacts - unchanged] --> DIR
    EV --- DIR

    RETRO[/retro Data Collection/] -->|*reads events.jsonl first-class| EV
    RETRO --> DIR
```

## Legend

- `*` — new in this feature; everything else exists today.
- Solid arrows — existing data flow; dotted arrows — new audit-record emissions.
- `AuditRecord` (JSONL line): `step`, `phase` (decide/build/ship), `event`
  (`gate_pass` | `gate_fail` | `kickback` | `retry` | `intervention` | `halt_cleared`),
  `reason?`, `cause?`, `attempt?`, `at` (epoch ms).
- Gate records are derived from the **same in-memory `GateVerdict`** the engine writes to
  `.pipeline/gates/«step».json` (`gate-verdicts.ts`), so verdict and audit record cannot
  diverge. A clean single-pass step still emits one `gate_pass` record — absence of a
  record for an executed step is provably a bug, not a silent success.
- `halt_cleared` is a **new emission** — today clearing is a bare unlink observed only by
  the daemon watcher; the writer records it as a first-class event.
- Skills are NOT instrumented: step retries, kickbacks, and HALTs are all driven by the
  engine loop, so the engine emits every record deterministically.

## Sequence: induced gate failure + retry, then kickback/HALT variants

```mermaid
sequenceDiagram
    participant CT as conductor loop
    participant SR as DefaultStepRunner
    participant GV as gate-verdicts.ts
    participant AT as audit-trail.ts «new»
    participant FS as .pipeline/

    CT->>SR: run step «fresh session»
    SR-->>CT: attempt 1 result
    CT->>GV: computeAndWriteVerdict
    GV->>FS: gates/«step».json satisfied=false
    GV-->>CT: GateVerdict
    CT->>AT: record gate_fail reason attempt 1
    AT->>FS: append audit-trail/events.jsonl
    CT->>SR: retry «resume same step session»
    CT->>AT: record retry attempt 2
    AT->>FS: append events.jsonl
    SR-->>CT: attempt 2 result
    CT->>GV: computeAndWriteVerdict
    GV->>FS: gates/«step».json satisfied=true
    CT->>AT: record gate_pass
    AT->>FS: append events.jsonl

    alt kickback verdict found
        CT->>AT: record kickback from «step» with evidence
        AT->>FS: append events.jsonl
    else HALT path
        CT->>FS: writeHaltMarker
        CT->>AT: record intervention cause
        AT->>FS: append events.jsonl
        Note over FS: operator clears HALT
        FS-->>AT: watchHaltCleared callback records halt_cleared
        AT->>FS: append events.jsonl
    end

    Note over FS: /retro Data Collection reads events.jsonl —<br/>both the failure and the retry are reconstructable<br/>without .pipeline/gates or git
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | Spec for #328 audit-trail write-completeness (engineer DECIDE) |
| 2026-07-07 | Plan update: writer subscribes to the ConductorEventEmitter bus (EventPersister pattern) rather than per-seam calls; `halt_cleared` is a first-class ConductorEvent with `cause: operator\|rekick`; writer paths root at injected projectRoot (never cwd) | /plan + conflict resolutions locked the mechanism |
