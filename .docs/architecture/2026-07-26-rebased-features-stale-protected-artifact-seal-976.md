# Architecture: protected-artifact seal rebaselining (#976)

**Stem:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
**Tier:** M — lightweight architecture pass

## Scope

One module gains a lifecycle: `.pipeline/protected-artifact-seal.json` may now be *replaced* under
a narrow, provable condition. Nothing else in the step topology moves.

## Component view (C4 level 3, seal boundary only)

```mermaid
flowchart TB
    subgraph engine["src/conductor/src/engine"]
        COND["conductor.ts<br/>BUILD/SHIP step guard<br/>(~3730-3795)"]
        SEAL["protected-artifact-seal.ts<br/>create · verify · <b>rebaseline</b>"]
        REB["rebase.ts / rebase-translate.ts<br/>performRebase → translateAfterRebase"]
        TEL["telemetry<br/>protected_artifact_seal events"]
    end

    STATE[".pipeline/protected-artifact-seal.json<br/>(gitignored, per-worktree)"]
    GIT["git<br/>ls-tree · show · merge-base --is-ancestor"]

    COND -->|"verify before every<br/>BUILD/SHIP attempt"| SEAL
    COND -->|"create on first<br/>BUILD attempt"| SEAL
    REB -->|"NEW: rotate after a<br/>clean engine rebase"| SEAL
    SEAL --> STATE
    SEAL --> GIT
    SEAL -->|"NEW: rotation +<br/>refusal events"| TEL

    classDef new stroke-width:3px;
    class SEAL,TEL new;
```

The new dependency is `rebase → seal`, mirroring the existing `rebase → task-evidence /
task-status` translation. The seal module stays ignorant of the rebase module.

## Seal state machine

```mermaid
stateDiagram-v2
    [*] --> Absent
    Absent --> Sealed: first BUILD attempt<br/>(workspace matches HEAD)
    Absent --> MissingHalt: SHIP attempt with no seal

    Sealed --> Sealed: verify ok<br/>(baseline is ancestor of HEAD,<br/>content matches)
    Sealed --> Violation: content differs and<br/>divergence NOT explained by base
    Sealed --> Rebaselined: engine rebase completed cleanly<br/>(pre-state verified ok)
    Sealed --> Rebaselined: baseline NOT ancestor of HEAD<br/>AND divergence fully explained by base

    Rebaselined --> Sealed: new baseline = post-rebase HEAD,<br/>lineage appended

    Violation --> [*]: step fails, no dispatch;<br/>attempt >= 2 writes classified HALT
    MissingHalt --> [*]
```

The only two edges into `Rebaselined` are the proactive one (the engine performed the rebase and
verified the pre-state) and the defensive one (history was rewritten out from under the seal and
every differing path is provably inherited from the base branch). Every other verification failure
still lands in `Violation` exactly as today.

## Rotation decision sequence

```mermaid
sequenceDiagram
    participant C as conductor.ts
    participant S as seal module
    participant G as git

    C->>S: verifyProtectedArtifactSeal
    S->>S: read existing seal
    S->>G: merge-base is-ancestor baseline HEAD
    alt baseline IS ancestor (normal history)
        S->>S: fingerprint workspace against seal
        S-->>C: ok, or "Protected artifact changed" naming the path
    else baseline NOT ancestor (history rewritten)
        S->>G: ls-tree at HEAD and at the base tip
        S->>S: per differing path — workspace equals HEAD blob AND HEAD blob equals base blob
        alt every difference inherited from base
            S->>S: rebaseline at HEAD, append lineage
            S-->>C: ok (rotated)
        else some difference authored by the feature
            S-->>C: refusal naming the feature-authored path
        end
    end
```

## Key architectural decision

Recorded in `.docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md` (APPROVED):
the rotation predicate is *provable inheritance from the base branch*, not *non-ancestry alone*.
Non-ancestry is the cheap trigger that tells us the seal can no longer be evaluated as-is; it is
never sufficient on its own to grant a rotation, because an agent can rewrite history.

## Invariants preserved

- A seal is never rotated to a later commit **on the same history** — the pinned immutability
  behaviour is narrowed, not removed.
- Uncommitted workspace edits to a protected artifact always fail; rotation requires the workspace
  to match the committed tree at HEAD.
- A missing seal at SHIP still fails closed.
- Non-git roots still bypass the boundary entirely (unchanged).
