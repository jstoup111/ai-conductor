# Sequence: fail-closed shipment and protected-branch check (#916, #936)

**Last updated:** 2026-07-25
**Scope:** Normal engine-driven shipment, the missing-evidence failure path, and GitHub's required
pre-merge check. The same verifier governs every path.

## Diagram

```mermaid
sequenceDiagram
  participant F as Finish session
  participant R as Existing record generator
  participant V as Shared evidence verifier
  participant S as Pipeline state
  participant D as Daemon outcome boundary
  participant PR as GitHub implementation PR
  participant A as Required record Action
  participant O as Operator
  participant M as Protected main

  F->>R: generate + commit .docs/shipped/«slug».md
  R->>PR: push feature HEAD carrying code + record
  F->>V: finalize PR shipment «slug», «prUrl»
  V->>V: parse record, verify slug, PR, hash, commit, pushed HEAD
  alt durable evidence passes
    V->>S: allow pr_url + finish-choice + DONE
    V->>D: allow processed cache write + teardown
    PR->>A: pull_request synchronize
    A->>V: verify checked-out PR head
    V-->>A: pass
    A-->>PR: required check succeeds
    O->>PR: approve and merge
    PR->>M: code and record land atomically
  else evidence missing, malformed, mismatched, uncommitted, or unpushed
    V-->>F: block with exact evidence gap
    Note over S,D: no terminal markers, no complete status,<br/>no processed write, no destructive teardown
    PR->>A: pull_request synchronize
    A->>V: verify checked-out PR head
    V-->>A: fail
    A-->>PR: required check fails, protected main rejects merge
  end
```

## Legend

- The engine and Action consume one verifier contract; neither re-implements shipped-record
  semantics.
- `finish-record` remains the terminal local-state writer, but only after durable verification.
- Branch protection turns the Action from an advisory signal into a merge gate.
- Keep/discard outcomes do not claim shipment and do not require or create shipped records.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | Prevent engine and GitHub merge paths from completing without durable evidence |
