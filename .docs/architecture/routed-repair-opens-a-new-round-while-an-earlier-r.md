# Components: Routed Round Continuation and Single-Open-Round Invariant (#3445)

**Last updated:** 2026-10-26
**Scope:** How a routed host exit advances its round, how a new routed round is admitted, and how
resume reconciles durable routing state — `routing/routed-exit.ts` (`requestRoutedExit`,
`advanceRound`), `routing/round-admission.ts` (`admitRound`, `reconcileRounds`),
`restack/stack-preflight.ts` (`runStackPreflight`), and the two `conductor.ts` callers (the
in-loop BUILD-region exit and the whole-feature audit routing).

## Diagram

```mermaid
graph TD
    subgraph Callers["Routed exit callers"]
        LOOP["In-loop BUILD-region exit<br/>conductor.ts"]
        PRE["Resume preflight, built host<br/>stack-preflight.ts runStackPreflight"]
    end

    subgraph Exit["Routed exit owns its continuation"]
        RRE["NEW: routing exit continuation<br/>round-admission.ts<br/>requestRoutedExit settles the host,<br/>then reconcile returns the next routed step"]
        REC["reconcileRounds<br/>round-admission.ts<br/>NEW: marker-owning round first,<br/>then older rounds in ref order"]
        ADV["advanceRound<br/>next host, queue, leaf return, or close"]
    end

    subgraph Open["Opening a round"]
        AUDIT["Whole-feature audit routing<br/>conductor.ts"]
        QUEUE["Revalidation queue admission<br/>revalidation-queue.ts"]
        ADMIT["admitRound<br/>NEW kind-aware fence: audit needs no other<br/>non-closed round; revalidate only while<br/>the open round waits on the queue"]
    end

    subgraph State["Durable routing refs, CAS only"]
        ROUTES[("routes/«roundId»<br/>route records")]
        MARKER[("repairing<br/>per-host repair marker")]
    end

    STOP["Mechanical HALT + reason<br/>names every open round<br/>via the #3446 preflight stop path;<br/>needs-human on the 3rd identical stop"]

    LOOP --> RRE
    PRE --> RRE
    RRE --> REC
    REC --> ADV
    ADV -->|"admit next host:<br/>record + marker in one CAS"| MARKER
    ADV --> ROUTES
    REC -->|"no progress possible"| STOP
    AUDIT --> ADMIT
    QUEUE --> ADMIT
    ADMIT -->|"enumerate non-closed rounds"| ROUTES
    ADMIT -->|"another round open"| STOP
    ADMIT -->|"create marker"| MARKER
    PRE -.->|"OLD HOLE: returned repaired<br/>without reconciling, so the next<br/>host was never admitted"| AUDIT
```

## Sequence: built host resumed after a halt

```mermaid
sequenceDiagram
    participant C as Conductor resume
    participant P as runStackPreflight
    participant X as Exit continuation
    participant R as reconcileRounds
    participant S as Routing refs
    C->>P: preflight
    P->>R: reconcile, finds host built
    R-->>P: resume-exit for host 1 of round «n»
    P->>X: exit host 1
    X->>S: exit restack applied, host 1 restacked, marker deleted
    X->>R: reconcile before returning
    R->>S: advance round «n», admit host 2, create marker
    R-->>X: navigate host 2
    X-->>P: navigate host 2
    P-->>C: navigate host 2, not repaired
    Note over C,S: Whole-feature audit runs only after every round is closed
```

## Legend

- **Callers**: today the in-loop exit reconciles after the exit and the resume preflight does not.
  One continuation in `round-admission.ts` (exit, then reconcile) gives both callers the same next step;
  it lives there because `round-admission.ts` already imports `routed-exit.ts`, so no import cycle forms.
- **NEW / OLD HOLE** annotations: the behavior changes this feature makes. Everything else is the
  existing seam governed by `adr-2026-10-12-routed-whole-feature-repair` decisions 6 and 7.
- **Repair marker**: a per-host ref deleted at every host exit. It is not a round lock, which is why
  admission must also enumerate non-closed route records.
- **Mechanical HALT**: the daemon re-kicks it without an operator; only the 3rd consecutive identical stop is needs-human. The stop path belongs to #3446.
- `«…»`: placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-26 | Initial generation | DECIDE for #3445: routed rounds opened while an earlier round was still open |
| 2026-10-26 | Stop node is a mechanical HALT | Conflict C1 with #3458's mechanical live-owner design |
