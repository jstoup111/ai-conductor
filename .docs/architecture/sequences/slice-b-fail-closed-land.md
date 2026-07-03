# Sequence: Slice B fail-closed land (B2) + universal stamping (B1)

**Last updated:** 2026-07-02
**Scope:** The land flow through `landSpec` after Slice B — identity resolved from the
machine (user-config) chain, gate evaluated before any write, both outcomes shown.

## Diagram

```mermaid
sequenceDiagram
  participant EP as Entry point (engineer-cli land / loop / conduct DECIDE)
  participant MI as machine-identity.ts
  participant LS as land-spec.ts landSpec
  participant WT as per-idea worktree
  participant IM as intake-marker.ts

  EP->>MI: readMachineOwnerConfig (user config only)
  MI->>MI: resolveDaemonOwner (configured then gh login)
  alt identity resolved
    MI-->>EP: author id
    EP->>LS: landSpec(ownerConfig, gh) with resolved chain
    LS->>LS: identity gate passes (B2)
    LS->>WT: stage .docs artifacts on spec/«slug»
    LS->>IM: writeIntakeMarker Owner: id (B1)
    IM-->>WT: .docs/intake/«slug».md committed with spec
    LS-->>EP: landed (branch, slug)
  else identity unresolved
    MI-->>EP: unresolved
    EP->>LS: landSpec invoked
    LS--xEP: REFUSE loud error (B2) — before any write
    Note over LS,WT: no branch created, no marker,<br/>no artifact commit, worktree untouched
  end
```

## Legend

- The gate fires inside `landSpec` **before** branch creation / staging / marker write —
  the refusal path leaves the target repo byte-for-byte unchanged.
- `machine-identity.ts` reads the **user** config only; the target repo's project config
  is never part of the identity chain (D2 anti-leak, enforced since Slice A).
- B1: the plain `/conduct` DECIDE path gains the same `writeIntakeMarker` stamping the
  `/engineer` path already has.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-02 | Initial generation | Slice B spec (issue #184) |
