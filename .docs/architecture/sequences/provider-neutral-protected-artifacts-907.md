# Sequence: Provider-Neutral Protected Artifacts (#907)

**Last updated:** 2026-07-25
**Scope:** Phase-scoped protection for frozen DECIDE artifacts during BUILD and SHIP,
including allowed exceptions, unknown targets, retry, and resume.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor lifecycle
    participant PS as Phase protection state
    participant P as Selected provider
    participant S as Required safety authority
    participant D as Protected artifacts

    C->>PS: enter BUILD or SHIP step with allowed scope
    C->>P: dispatch step
    P->>S: request artifact mutation
    S->>PS: read active phase, step, and allowed scope
    alt target cannot be determined
        PS-->>S: target unknown while phase active
        S-->>P: reject as unverifiable
    else target is protected and not allowed
        PS-->>S: frozen target
        S-->>P: reject with phase and recovery guidance
    else target is outside protected scope or explicitly allowed
        PS-->>S: allowed target
        S->>D: permit mutation
        D-->>P: mutation result
    end
    P-->>C: step success, failure, or interruption
    C->>PS: clear active phase state
    Note over C,PS: retry and resume write fresh state<br/>before another provider dispatch
```

## Negative and Recovery Paths

- Unknown mutation targets fail closed while a protected phase is active.
- A provider cannot infer permission from a missing or malformed protection context.
- Step-specific exceptions remain explicit and bounded; an unrelated artifact never
  becomes writable through a broad phase exemption.
- Cleanup occurs on success, failure, and interruption. Retry and resume establish a
  fresh context rather than silently weakening protection.

## Legend

- Protected artifacts are the approved product, architecture, story, and plan record
  frozen during BUILD and SHIP except for explicit lifecycle-owned updates.
- The selected provider may be Claude or Codex; the phase contract is the same.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial sequence | DECIDE architecture for issue #907 |
