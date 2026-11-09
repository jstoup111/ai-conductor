# Components: Taskless Routed Obligations Dispatch on a Host That Can Hold the Fix, and a Stranded Round Can Be Closed (#3605)

**Last updated:** 2026-11-07
**Scope:** How a taskless whole-feature obligation (a `manual_test` FAIL or a post-region
custom-step kickback) is placed on a stack child, how that child's region entry decides whether
there is BUILD work, and how an operator recovers a stranded audit round. Covers
`admitRoutedTasklessKickback` in `conductor.ts`, `runResidueRoutingCall` /
`renderResidueRoutingPrompt` in `routing/residue-routing-call.ts`, `selectHost` in
`routing/cannot-host.ts`, the audit no-op guard in `routing/host-region-entry.ts`,
`checkCloseable` / close in `stack-rounds-cli.ts`, and the refusal text in
`stack-commit-guard-cli.ts`.

## Diagram

```mermaid
graph TD
    subgraph Gate["Whole-feature gate on the leaf"]
        MT["manual_test FAIL rows<br/>or custom-step kickback"]
        KB["handleManualTestFailKickback<br/>retry hint + kickback event"]
    end

    subgraph Admission["Taskless admission (conductor.ts)"]
        ATK["admitRoutedTasklessKickback"]
        MAN["NEW: per-child changed-path manifest<br/>from sealed closures"]
        JUDGE["runResidueRoutingCall<br/>NEW input: FAIL evidence + manifest<br/>NEW answer field: implicatedPaths"]
        FLOOR["selectHost (cannot-host.ts)<br/>raise owner until host tree<br/>contains every implicated path"]
        LEAF["NEW: no implicated paths<br/>→ host on the leaf"]
        REC[("routes/«roundId»<br/>audit, remTaskIds empty,<br/>retryHint on host")]
    end

    subgraph Entry["Host region entry (host-region-entry.ts)"]
        GUARD["Audit no-op guard"]
        TASKLESS["NEW: taskless obligation present<br/>→ dispatchable, not derived complete"]
        BUILD["BUILD dispatched on host «n»<br/>with the retry hint"]
        DAC["derived-already-complete<br/>(task work only)"]
        EXIT["Routed exit<br/>no-commit exit + anti-whitewash<br/>escalation unchanged"]
    end

    subgraph Operator["Operator recovery (CLI)"]
        CLOSE["stack rounds --close «r» --reason<br/>NEW: admits an admitted host<br/>with no dispatchable work;<br/>sole round closes into leaf return"]
        NEG["Host with dispatchable work<br/>→ still refused"]
        CG["stack-commit-guard refusal<br/>NEW: names only commands valid<br/>for the round kind"]
        LCOMMIT["Operator commits fix on the leaf<br/>→ leaf gates re-run"]
    end

    MT --> KB --> ATK
    ATK --> MAN --> JUDGE --> FLOOR
    JUDGE -- "no paths named" --> LEAF
    FLOOR --> REC
    LEAF --> REC
    REC --> GUARD
    GUARD --> TASKLESS --> BUILD --> EXIT
    GUARD -- "task-bound, all tasks complete" --> DAC
    DAC -. "stranded halt" .-> CG
    CG --> CLOSE
    CLOSE --> LCOMMIT
    CLOSE --> NEG
```

## Legend

- **NEW** marks behavior this change adds; unmarked nodes exist today and keep their behavior.
- `«roundId»`, `«n»`, `«r»` are placeholders for a routing round id, a host child position and a
  round id given on the command line.
- Solid arrows are the normal flow; the dotted arrow is the halt an operator recovers from.
- "Leaf" is the last declared slice position (`feat/daemon-«slug»`), whose tree holds every
  child's code.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | #3605: taskless routed obligation was placed blind and never dispatched; no supported recovery for a stranded sole audit round |
