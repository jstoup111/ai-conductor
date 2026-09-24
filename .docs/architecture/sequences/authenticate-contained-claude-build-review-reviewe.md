# Sequence: Contained Claude reviewer credential resolution

**Last updated:** 2026-09-24
**Scope:** One contained Claude build_review member dispatch for #2737, from credential resolution to verdict or refusal.

## Diagram

```mermaid
sequenceDiagram
  participant SR as Step runner
  participant CS as Credential step
  participant CP as Claude provider
  participant RV as Contained reviewer
  participant EV as Event spine
  SR->>CS: resolve credential for the resolved build_auth mode
  CS->>CS: daemon-token reads the daemon token, api-key checks the ambient key
  alt credential missing or unreadable
    CS-->>SR: unavailable with mode, path or variable, and state
    SR->>EV: reviewer-credential-unavailable, needs-human halt, no attempt spent
  else credential available
    CS-->>SR: one value
    SR->>CP: invoke with reviewAccess ready and the credential overlay
    CP->>CP: scratch HOME and CLAUDE_CONFIG_DIR plus the credential variable
    CP->>RV: launch under bwrap
    RV-->>CP: structured verdict
    CP-->>SR: rubric result
    SR->>EV: existing verdict events
  end
```

## Legend

The credential value flows only through the provider env overlay; no credential file is written to scratch.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-24 | Initial sequence | #2737, resolved-mode credential |
