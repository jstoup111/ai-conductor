# Sequence: Provider-Neutral Self-Host Isolation (#907)

**Last updated:** 2026-07-26
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
    participant D as Isolated skill discovery
    participant V as Live-boundary verifier
    participant P as Selected provider
    participant W as Feature worktree
    participant L as Live checkout and unrelated config

    C->>R: begin selected-first provider candidates
    loop each resolved actual candidate
        R-->>C: Claude or Codex runtime
        C->>V: fingerprint live checkout and unrelated provider state
        V-->>C: bounded baseline ready
        C->>I: allocate candidate-specific throwaway provider home
        alt required isolation cannot be verified
            I-->>C: unavailable or unverifiable
            C-->>C: stop candidate before provider dispatch
        else isolation ready
            I->>A: prepare selected auth into isolated destination
            A-->>I: child env or opaque temporary credential handle
            I->>D: create child-only skill view from worktree
            D-->>I: Claude skills or Codex .agents/skills ready
            I->>I: install engine controls and worktree harness assets
            I-->>C: isolated context with selected authentication only
            C->>P: dispatch self-host candidate
            P->>W: read and mutate feature worktree
            P--xL: mutation denied
            Note over P,L: no personal settings/hooks, global relink,<br/>mutable state, or live-checkout access
            P-->>C: success, failure, or provider-unavailable result
            C->>V: verify live boundary before fallback or acceptance
            alt live boundary changed or unverifiable
                V-->>C: reject safe completion with sanitized recovery
            else live boundary unchanged
                V-->>C: terminal verification passes
            end
        end
        C->>I: finally teardown candidate home, discovery, and credential state
        I-->>C: idempotent path-bounded cleanup complete
    end
```

## Negative and Recovery Paths

- Isolation readiness is established before the provider runs; an unverifiable boundary
  never degrades into a normal dispatch.
- The selected authentication source is the only approved dependency on live provider
  state. Claude and Codex both exclude unrelated preferences, extensions, lifecycle
  customizations, histories, sessions, caches, and mutable state.
- Claude does not copy operator settings/personal hooks or relink live global skills;
  worktree skills and engine-owned controls are installed inside its throwaway home.
- Codex cached login is copied only as an opaque restricted credential artifact and is
  removed with the isolated home. #904's live user catalog is replaced only for the
  self-host child by a worktree-owned `.agents/skills` view.
- The provider may mutate the feature worktree but not the live harness checkout.
- Teardown is required after success, failure, or interruption. Retry and resume create
  a fresh isolated context with the same #905 authentication-selection rules.
- Provider fallback cannot reuse the prior candidate's home or auth: each candidate enters
  isolation after actual-runtime resolution and completes verification/cleanup before advance.
- Provisioning failures remove only feature-created paths before any model work starts;
  diagnostics are redacted before logs, HALTs, attempt metadata, or persisted artifacts.

## Legend

- `--x` denotes a denied mutation relationship.
- Issue #905 remains the authority for authentication selection and bounded execution;
  #907 owns the surrounding self-host configuration and checkout isolation outcome.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-26 | Move provider-home/auth lifecycle inside the actual-candidate fallback loop | Post-plan architecture review for issue #907 |
| 2026-07-26 | Add planned live fingerprint and unified terminal cleanup flow | `/plan` update for issue #907 |
| 2026-07-26 | Apply minimal isolated-home behavior to both Claude and Codex | Conflict-check resolution for issue #907 |
| 2026-07-26 | Add opaque cached-auth handoff and isolated #904 skill discovery | Landed #905 and inflight #904 conflict resolution |
| 2026-07-25 | Initial sequence | DECIDE architecture for issue #907 |
