# Sequence: Provider-Neutral Task and Mutation Safety (#907)

**Last updated:** 2026-07-26
**Scope:** Concurrent task-local attribution across Claude and Codex, with mutation safety
and judgment authority independent of task telemetry.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor lifecycle
    participant T as Concurrent task telemetry
    participant A as Protected artifact seal
    participant S as Required safety authority
    participant P as Selected provider
    participant W as Feature worktree
    participant J as Judgment gates

    C->>A: create or verify approved DECIDE baseline
    A-->>C: current phase and exact allowed prefixes verified
    par task «a»
        C->>T: validate and activate task «a»
        C->>S: preflight task «a» attempt
        S->>A: verify protected baseline before dispatch
        S-->>C: required protections pass
        C->>P: dispatch task «a» with task-local id
    and task «b»
        C->>T: validate and activate task «b»
        C->>S: preflight task «b» attempt
        S->>A: verify protected baseline before dispatch
        S-->>C: required protections pass
        C->>P: dispatch task «b» with task-local id
    end
    P->>S: request project mutation
    S->>S: evaluate artifact and workspace policy
    alt target is permitted
        S->>W: permit mutation independent of task telemetry
        W-->>P: mutation result
    else protected artifact or live boundary denies target
        S-->>P: reject with actionable guidance
    end
    P->>T: supply explicit Task trailer when committing
    T->>T: validate and preserve supplied id, never globally replace
    P-->>C: task «a» ends
    C->>S: verify terminal attempt result
    S->>A: reject changed, deleted, recreated, or added protected paths
    A-->>S: baseline remains valid
    C->>T: retire only task «a», task «b» remains active
    C->>J: evaluate architecture, wiring, and completeness
    J-->>C: verdict independent of task stamp
```

## Negative and Recovery Paths

- Unknown or stale supplied ids are rejected as telemetry rather than guessed.
- Completion, failure, cancellation, and replacement retire only the matching active row.
- Retry and resume re-enter task-local validation without a workspace-global stamp.
- Initial, retry, resume, grouped, auxiliary, and provider-replacement attempts all enter
  the same pre/post safety wrapper; stale reusable state is rejected by task, provider,
  phase, workspace, baseline, and terminal-run identity.
- Missing task telemetry neither authorizes nor rejects mutation and never determines
  wiring or completion.

## Legend

- `«a»` and `«b»` are concurrent plan task identifiers.
- The selected provider may be Claude or Codex; neither owns task-state authority.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` keeps
  attribution advisory while artifact/workspace policies own mutation safety.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-26 | Add durable artifact seal and pre/post attempt safety wrapper | `/plan` update for issue #907 |
| 2026-07-26 | Replace singular task lease with concurrent task-local telemetry | Conflict-check resolution for issue #907 |
| 2026-07-25 | Resolve the task-safety authority seam | Architecture review for issue #907 |
| 2026-07-25 | Initial sequence | DECIDE architecture for issue #907 |
