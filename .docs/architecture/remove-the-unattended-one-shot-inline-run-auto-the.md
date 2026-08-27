# Components: unattended execution paths after the one-shot removal

**Last updated:** 2026-08-26
**Scope:** The two entry paths into the inline engine's run modes, showing what this
feature deletes versus what stays as the daemon's contract. Feature slug:
`remove-the-unattended-one-shot-inline-run-auto-the` (jstoup111/ai-conductor#1436).

## Diagram

```mermaid
graph TD
    subgraph Operator entries
        CLI["conduct-ts inline «feature»<br/>(cli.ts)"]
        DAEMON["conduct-ts daemon start<br/>(daemon-cli.ts)"]
        EX["examples/inline.sh<br/>(RETIRED: re-pointed at daemon)"]
    end

    subgraph Mode derivation
        DM["deriveMode (index.ts)<br/>--auto rejects, exit 1,<br/>names daemon + docs guide<br/>(dead 'auto' return arm DELETED)"]
    end

    subgraph Engine
        COND["Conductor (conductor.ts)<br/>mode: interactive | default | auto"]
        LIVE["'auto' branches reachable from<br/>daemon dispatch — KEPT<br/>(checkpoint skip, dispatch gating)"]
        DEAD["'auto' branches reachable only from<br/>the removed one-shot — DELETED<br/>(audit-classified, e.g. finish-prompt<br/>PR opening, one-shot hard-failure handler)"]
    end

    CLI --> DM
    DM -->|"--interactive → 'interactive'<br/>no flag → 'default'"| COND
    DM -.->|"--auto → error + exit 1<br/>(never reaches engine)"| X["terminal message:<br/>daemon start + running-the-daemon guide"]
    DAEMON -->|"mode: 'auto' (unchanged)"| COND
    EX -.->|before: ran inline --auto| DM
    COND --> LIVE
    COND -.-> DEAD

    style DEAD stroke-dasharray: 5 5
    style EX stroke-dasharray: 5 5
```

## Legend

- Solid arrows: surviving paths (unchanged behavior).
- Dashed arrows / dashed nodes: paths this feature deletes or retires.
- The `'auto'` RunMode value itself is **kept** — it is the daemon's dispatch contract
  (daemon-cli.ts passes `mode: 'auto'`). Only branches unreachable from the daemon go.
- `«feature»` marks a variable argument.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1436 (engineer spec) |
