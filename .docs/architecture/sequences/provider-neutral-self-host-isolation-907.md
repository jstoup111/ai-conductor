# Sequence: Provider-Neutral Self-Host Isolation (#907)

**Last updated:** 2026-07-25
**Scope:** A harness self-build under Claude or Codex, preserving issue #905's selected
authentication source while excluding unrelated operator configuration and protecting
the live checkout on every terminal path.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor self-host coordinator
    participant R as Provider routing
    participant A as Selected authentication source
    participant I as Self-host isolation boundary
    participant P as Selected provider
    participant W as Feature worktree
    participant L as Live checkout and unrelated config

    C->>R: resolve provider for build step
    R-->>C: Claude or Codex
    C->>A: obtain issue 905 selected source
    A-->>C: selected authentication context
    C->>I: prepare provider-aware isolated execution
    alt required isolation cannot be verified
        I-->>C: unavailable or unverifiable
        C-->>C: stop before provider dispatch
    else isolation ready
        I-->>C: isolated context with selected authentication
        C->>P: dispatch self-host build
        P->>W: read and mutate feature worktree
        P--xL: mutation denied
        Note over P,L: unrelated preferences, lifecycle customizations,<br/>mutable state, and live checkout remain protected
        P-->>C: success, failure, or interruption
        C->>I: teardown isolated context
        I-->>C: cleanup complete
    end
```

## Negative and Recovery Paths

- Isolation readiness is established before the provider runs; an unverifiable boundary
  never degrades into a normal dispatch.
- The selected authentication source is the only approved dependency on live provider
  state. Unrelated preferences, extensions, lifecycle customizations, and mutable state
  do not enter the self-host context.
- The provider may mutate the feature worktree but not the live harness checkout.
- Teardown is required after success, failure, or interruption. Retry and resume create
  a fresh isolated context with the same #905 authentication-selection rules.

## Legend

- `--x` denotes a denied mutation relationship.
- Issue #905 remains the authority for authentication selection and bounded execution;
  #907 owns the surrounding self-host configuration and checkout isolation outcome.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial sequence | DECIDE architecture for issue #907 |
