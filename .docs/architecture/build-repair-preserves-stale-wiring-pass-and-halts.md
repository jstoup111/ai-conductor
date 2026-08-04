# Components: BUILD-verification member reuse after a repair

**Last updated:** 2026-08-03
**Scope:** Proposed satisfaction boundary for the deterministic BUILD-verification group
(`wiring_check`, `test_suite`) across a BUILD repair, and the reconciliation of the two
step-satisfaction predicates that currently disagree.

## Diagram

```mermaid
graph LR
  subgraph loop["Conductor run loop"]
    walk["Forward step walk<br/>entry gate check"]
    tail["advanceTail selection<br/>selectNextGate"]
    join["BUILD group fan-out and join"]
    kick["Deterministic kickback to build"]
  end

  subgraph predicates["Satisfaction predicates"]
    sel["gateSatisfied<br/>verdict-file authoritative"]
    gate["stepSatisfied via checkGate<br/>state-status only"]
    clamp["clampToRunnablePrerequisite<br/>backward-only, gate predicate"]
  end

  subgraph anchors["Per-member evidence anchors (unchanged)"]
    wire["wiring-evidence.json<br/>recorded head vs current head<br/>re-derive on mismatch"]
    suite["full-suite proof<br/>content fingerprint<br/>REUSED or STALE"]
  end

  subgraph obs["Observability"]
    ev["member settle decision<br/>reused or recomputed, with basis"]
    log["daemon.log rendering"]
  end

  tail --> sel
  walk --> gate
  tail --> clamp
  clamp --> gate
  clamp -->|"dispatch the prerequisite"| join
  join --> wire
  join --> suite
  wire --> ev
  suite --> ev
  ev --> log
  join --> kick
  kick -->|"leave every member in one reconciled status"| sel
  kick --> gate

  classDef proposed fill:#d5f5e3,stroke:#1e8449,stroke-width:2px;
  classDef existing fill:#fdebd0,stroke:#b9770e;
  class clamp,ev,log proposed;
  class sel,gate,walk,tail,join,kick,wire,suite existing;
```

## Repair-and-rejoin Sequence

```mermaid
sequenceDiagram
  participant B as build
  participant G as BUILD group join
  participant W as wiring_check
  participant S as test_suite
  participant BR as build_review

  G->>W: dispatch
  G->>S: dispatch
  W-->>G: pass, verdict written
  S-->>G: failure or no verdict
  G->>B: kickback, leave BOTH members in one reconciled status
  B-->>G: repair commit changes HEAD
  G->>W: dispatch again (no reuse from the on-disk verdict)
  G->>S: dispatch again
  alt member evidence still matches the current code state
    W-->>G: settle from recorded evidence, emit reused with basis
  else evidence no longer matches
    W-->>G: re-derive at current head, emit recomputed with basis
  end
  S-->>G: REUSED on fingerprint match, else execute and settle
  G->>BR: dispatch only after the join declares every prerequisite satisfied
```

## Legend

- **Green (proposed):** the tail-selection clamp, and the per-member settle-decision events with their
  daemon.log rendering.
- **Amber (existing):** everything this change consumes rather than invents — both satisfaction
  predicates, the concurrent group core and its join, the kickback path, and each member's own
  code-state-anchored evidence.

## Invariants this topology enforces

1. A member is declared satisfied only by the round that verified it. No on-disk gate verdict, step
   status, or timestamp is sufficient authority on its own.
2. Each member's validity is decided by exactly one authority — its own evidence anchor. No second,
   coarser authority is layered over it.
3. `build_review` is dispatched only when every declared prerequisite is satisfied under the same
   predicate its own entry check uses.
