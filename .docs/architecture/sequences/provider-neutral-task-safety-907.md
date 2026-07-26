# Sequence: Provider-Neutral Task and Mutation Safety (#907)

**Last updated:** 2026-07-25
**Scope:** Current-task identity and mutation authorization across Claude and Codex,
including stale identity, failure cleanup, and the separate judgment-gate boundary.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor lifecycle
    participant T as Task state authority
    participant S as Required safety authority
    participant P as Selected provider
    participant W as Feature worktree
    participant J as Judgment gates

    C->>T: start task «id»
    T->>T: validate task and make «id» current
    T-->>S: current identity «id»
    C->>P: dispatch task «id»
    P->>S: request project mutation
    S->>T: read current identity
    alt identity is valid and matches task «id»
        T-->>S: current «id»
        S->>W: permit mutation
        W-->>P: mutation result
    else identity is empty, stale, unknown, or mismatched
        T-->>S: invalid identity
        S-->>P: reject with actionable guidance
    end
    P-->>C: task success, failure, or cancellation
    C->>T: end task «id»
    T->>T: clear identity only when «id» is current
    C->>J: evaluate architecture, wiring, and completeness
    J-->>C: verdict independent of task stamp
```

## Negative and Recovery Paths

- A provider dispatch never makes an unknown or stale identity authoritative.
- Completion, failure, cancellation, and task replacement all remove the ended task's
  authority before later work proceeds.
- Retry and resume re-enter through the same start and validation flow; they do not
  inherit authority merely because an old identity remains on disk.
- The judgment gates evaluate the resulting work independently. A valid task identity
  is necessary for mutation safety but is not proof that the implementation is wired or
  complete.

## Legend

- `«id»` is the active plan task identifier.
- The selected provider may be Claude or Codex; neither owns task-state authority.
- `adr-2026-07-25-provider-neutral-safety-authority` places the task lease and
  terminal mutation audit in the conductor safety boundary; provider lifecycle hooks
  supply early events but do not own acceptance.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Resolve the task-safety authority seam | Architecture review for issue #907 |
| 2026-07-25 | Initial sequence | DECIDE architecture for issue #907 |
