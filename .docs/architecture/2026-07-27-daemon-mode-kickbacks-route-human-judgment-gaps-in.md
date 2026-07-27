# Architecture: daemon-mode DECIDE kickback guard (#551)

**Date:** 2026-07-27
**Stem:** daemon-mode-kickbacks-route-human-judgment-gaps-in
**Tier:** M (technical track)

## Scope

The conductor's gate loop, specifically the two seams that can move the run index *backward*
to an earlier step, and the daemon-mode rule governing which targets are permissible.

## Component view (C4 L3 — inside the conductor engine)

```mermaid
flowchart TB
  subgraph loop["Conductor gate loop (engine/conductor.ts)"]
    ADV["advanceTail()<br/>conductor.ts:6244"]
    SCAN["scanKickbackVerdicts()<br/>conductor.ts:6189<br/><b>PATH B — unguarded today</b>"]
    PLANREM["planRemediation()<br/>conductor.ts:1655<br/><b>PATH A — guarded by #644 at :1722</b>"]
    SEL["selectNextGate()<br/>selector.ts:111"]
    NAV["navigateBack()<br/>conductor.ts:336"]
  end

  subgraph new["NEW — engine/kickback-policy.ts (pure)"]
    POL["decideKickbackDisposition({target, steps, daemon})<br/>→ route | halt"]
  end

  subgraph halt["Halt surface"]
    WHM["writeHaltMarker(body, 'needs-human')<br/>halt-marker.ts:37"]
    PR["surfaceRemediationPr()<br/>conductor.ts:1316"]
    EV["emit loop_halt"]
  end

  subgraph store["On-disk state"]
    VERD[".pipeline/gates/&lt;step&gt;.json<br/>gate-verdicts.ts"]
    REMJ[".pipeline/remediation.json<br/>artifacts.ts:2871"]
    HALTF[".pipeline/HALT + HALT.class"]
    ST["conduct-state.json"]
  end

  VERD --> SCAN
  REMJ --> PLANREM
  ADV --> SCAN
  ADV --> SEL
  SCAN -->|"consults (NEW)"| POL
  PLANREM -->|"consults (replaces inline check)"| POL
  POL -->|route| NAV
  POL -->|halt| WHM
  WHM --> HALTF
  WHM --> PR --> EV
  NAV --> ST
  SEL --> ST

  classDef newcls fill:#123a12,stroke:#4c4,color:#dfd
  classDef gap fill:#3a1212,stroke:#c44,color:#fdd
  class POL newcls
  class SCAN gap
```

## The invariant this enforces

> In daemon mode, the run index may never move backward into a `phase: 'DECIDE'` step.
> The condition that would have moved it becomes a `needs-human` HALT carrying the gap
> evidence.

Both backward-navigation seams are now derived from one predicate, so the invariant cannot be
half-true. `navigateBack` itself is deliberately *not* the enforcement point (see the ADR's
rejected options) — it is also called by the rebase-invalidation path (`conductor.ts:4203-4238`)
whose targets are all BUILD/SHIP and must keep working.

## Sequence — daemon, SHIP-phase gate kicks back to `plan`

```mermaid
sequenceDiagram
  participant Gate as SHIP gate
  participant Tail as advanceTail
  participant Scan as scanKickbackVerdicts
  participant Pol as kickback-policy
  participant Halt as halt surface
  participant Op as Operator

  Gate->>Gate: writes an unsatisfied plan verdict carrying kickback provenance
  Tail->>Scan: scan the verdicts, navigate true
  Scan->>Scan: bump the per-gate counter and emit the kickback event
  Note over Scan: cap check unchanged and still first
  Scan->>Pol: decide for target plan, daemon true
  Pol-->>Scan: halt, DECIDE is operator-only in daemon mode
  Scan->>Halt: writeHaltMarker with reason plus evidence, class needs-human
  Halt->>Halt: writeState, surfaceRemediationPr, emit loop_halt
  Scan-->>Tail: halt
  Note over Op: rekick skips needs-human halts forever, no auto-clear
  Op->>Op: edits the DECIDE artifacts and clears the HALT
  Note over Op: resume re-enters at the earliest unsatisfied gate
```

## Interactive path (unchanged)

```mermaid
flowchart LR
  A["conflict_check writes kickback → architecture_review"] --> B["scanKickbackVerdicts"]
  B --> C{"daemon?"}
  C -->|"false (interactive)"| D["navigateBack → amendment pass<br/>(ADR 2026-06-29, legitimate)"]
  C -->|true| E["HALT needs-human"]
```

## Touch list

| Element | Change |
|---|---|
| `engine/kickback-policy.ts` | **new**, pure, no I/O |
| `engine/conductor.ts:1722-1737` | inline #644 check → delegate to the predicate (behavior-identical) |
| `engine/conductor.ts:6189-6231` | consult the predicate before `navigateBack`; halt via `writeHaltMarker(..., 'needs-human')` |
| `engine/steps.ts`, `types/steps.ts` | **unchanged** — phase data is read, never redefined |
| `engine/selector.ts` | **unchanged** — the dead `loopGatesOnly` clamp is explicitly not wired (see ADR) |
