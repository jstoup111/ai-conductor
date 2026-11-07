# Components: Round-Scoped Routed Host Verdicts and Classified Parked Exits (#3455)

**Last updated:** 2026-10-28
**Scope:** How a routed host's child region verdicts are written and read, and how the gate-driven
loop stops when routed parking leaves nothing runnable. Covers `gate-verdicts.ts` (`GateVerdict`,
`writeVerdict`), `conductor.ts` (`readGateVerdictOverlay`, `advanceTail`'s `parked` arm, the step
loop's `parkedForRouting` exit), `selector.ts` (`selectNextGate`, unchanged rule), and the bounded
stall machinery `#3445` adds to `routing/round-admission.ts` (`recordRoundStall`,
`routing_rounds_stalled`).

## Diagram

```mermaid
graph TD
    subgraph Write["Child region verdict writes"]
        STEP["Region step tail<br/>acceptance_specs, build, test_suite, build_review<br/>conductor.ts"]
        WV["writeVerdict / computeAndWriteVerdict<br/>gate-verdicts.ts<br/>NEW: a child write while a routed round<br/>hosts that child stamps routedRound"]
    end

    subgraph Durable["Durable state"]
        CV[("children/«k»/gates/«step».json<br/>GateVerdict + NEW optional routedRound")]
        CS[("children/«k»/conduct-state.json<br/>region step status")]
        MARKER[("refs/conductor/«slug»/repairing<br/>host + roundId")]
    end

    subgraph Read["Gate selection"]
        OV["readGateVerdictOverlay<br/>conductor.ts<br/>NEW: for a routed host, mask a satisfied child verdict<br/>whose routedRound is not the executing round"]
        SEL["selectNextGate / gateSatisfied<br/>selector.ts — rule unchanged:<br/>no verdict, so status decides"]
    end

    subgraph Park["Parked exit"]
        ADV["advanceTail parked arm and refused completion<br/>conductor.ts — NEW: stopParkedForRouting"]
        STALL["recordRoundStall (from #3445)<br/>trailing identical routing_rounds_stalled<br/>events: attempts 1-2 mechanical, 3+ needs-human"]
        HALT["HALT + HALT.class + loop_halt<br/>names round, parking kind, reason"]
    end

    DAEMON["Daemon re-kick of a mechanical HALT<br/>then stack preflight admits or exits the round"]

    STEP --> WV
    WV --> CV
    MARKER -->|"executing roundId"| WV
    MARKER -->|"executing roundId"| OV
    CV --> OV
    CS --> SEL
    OV --> SEL
    EXIT["NEW: continueRoutedHostExit on resume<br/>when every host region gate is satisfied<br/>under the round scope (decision 13)"]
    REFUSE["Existing exit refusal stop<br/>exit HALT stands, else child-region<br/>refusal HALT; no routing stall"]
    SEL -->|"host region finished in round"| EXIT
    SEL -->|"parked: nothing runnable"| ADV
    EXIT -->|"exit refused"| REFUSE
    ADV --> STALL
    STALL --> HALT
    HALT -->|"mechanical"| DAEMON
    ADV -.->|"OLD HOLE: returned with no marker,<br/>daemon wrote a generic needs-human halt"| DAEMON
```

## Sequence: routed round re-enters a host that holds verdicts from an earlier lap

```mermaid
sequenceDiagram
    participant P as Stack preflight
    participant E as Host region entry
    participant C as Conductor loop
    participant O as Verdict overlay
    participant S as Selector
    participant H as Stall recorder

    P->>E: admit round «r» on host «k»
    E->>E: restage region steps to pending
    C->>O: read verdicts for host «k»
    O->>O: mask satisfied verdicts without routedRound «r»
    O-->>S: masked overlay
    S-->>C: run build (pending, no verdict)
    C->>C: build, test_suite, build_review each run
    Note over C: each verdict written stamped «r»
    C->>C: crash and resume within «r»
    C->>O: read verdicts for host «k»
    O-->>S: «r» verdicts kept
    S-->>C: next unfinished step only
    alt routed parking leaves nothing runnable
        S-->>C: parked
        C->>H: record stall for «r», parking kind
        H-->>C: mechanical (attempt 1-2) or needs-human
        C->>C: write HALT naming «r» and the reason
    end
```

## Legend

- **NEW** marks behavior this spec adds. **OLD HOLE** marks the defect path it closes.
- One conductor resolver, `routedRoundForActiveChild`, supplies the executing round to both the
  verdict stamp and the overlay mask, so the two can never disagree about which round is executing.
- `routedRound` is an optional additive `GateVerdict` field. Flat (N=1) features and non-routed
  child regions never write it and never mask on it.
- Masking applies only to satisfied verdicts and deletes them from the in-memory overlay only; an
  unsatisfied verdict from any round still blocks. Selection then falls back to the
  child's step status, so a re-pended step re-runs and a step finished earlier in the round stays
  `done`.
- `recordRoundStall` and `routing_rounds_stalled` are delivered by `#3445`
  (`routed-repair-opens-a-new-round-while-an-earlier-r`). This spec reuses them rather than adding
  a second retry counter.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-28 | Initial generation | #3455 round-scoped routed host verdicts and classified parked exits |
| 2026-10-28 | Added the resume exit of a finished host region | Operator included the interrupted-exit gap in #3455 scope |
| 2026-10-28 | A refused resume exit reuses the in-loop refusal stop | Conflict check: restack and preflight exit HALTs keep their own class |
| 2026-10-28 | Named the planned conductor methods | Plan update |
