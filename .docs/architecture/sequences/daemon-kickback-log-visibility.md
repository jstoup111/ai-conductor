# Sequence: DECIDE-phase amendment kickback becomes a visible log line

**Last updated:** 2026-07-04
**Scope:** The currently-silent path — a DECIDE-phase skill (conflict-check or stories) re-opens architecture-review in amendment mode — from verdict write to prominent daemon log line. The tail-loop/SHIP kickback paths already emit; they reuse the same renderer case and gain only the restyle.

## Diagram

```mermaid
sequenceDiagram
    participant SK as conflict-check skill session
    participant GV as .pipeline/gates/architecture_review.json
    participant CO as Conductor engine
    participant EB as Event bus
    participant RD as renderDaemonEvent
    participant DL as .daemon/daemon.log

    SK->>GV: write kickback verdict «from conflict_check, evidence»
    SK-->>CO: step session ends
    CO->>GV: read gate verdicts on advance
    Note over CO: NEW - front-half re-open detection<br/>step is earlier than first loopGate<br/>today advanceTail returns before scanning it
    CO->>CO: mark architecture_review pending, downstream stale (existing)
    CO->>EB: emit kickback «from conflict_check to architecture_review» (NEW)
    EB->>RD: dispatch event
    RD->>RD: format undimmed bold line<br/>↩ KICKBACK: conflict_check re-opened architecture_review — «evidence» (×1)
    RD->>DL: ANSI-stripped timestamped line — KICKBACK tag carries prominence
    Note over RD,DL: operator scanning tmux or conduct daemon logs<br/>sees backward motion at a glance
```

## Legend

- **NEW** annotations are this feature; state transitions (pending / stale) already happen today — only the event emission and rendering are added.
- The same `kickback` event shape is reused so the renderer has exactly one backward-motion case for engine-initiated kickbacks; `navigation_back` (operator-initiated) renders separately.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#240 |
