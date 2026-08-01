# Sequence: Rebase conflict resolution integrity

**Last updated:** 2026-08-01
**Scope:** Proposed bounded conflict-resolution attempt and its conservative acceptance boundary.

## Diagram

```mermaid
sequenceDiagram
    participant E as Rebase engine
    participant G as Git worktree
    participant S as Rebase skill
    participant H as HALT writer

    E->>G: Start sanctioned rebase
    G-->>E: Pause on conflicted replay commit
    E->>S: Dispatch bounded resolution attempt
    S->>G: Inspect rebase state, source commit, parents, and full branch context
    S->>S: Compare proposed replay with source intent and upstream changes
    alt intent is clear
        S->>G: Apply coordinated resolution and continue rebase
        S->>G: Validate completed replay against source intent
        alt validation remains clear
            S-->>E: resolved true
            E->>G: Apply existing currency and commit-preservation guards
        else validation is ambiguous
            S-->>E: resolved false with commit, file, and ambiguity evidence
            E->>H: Write actionable HALT
        end
    else intent is ambiguous
        S-->>E: resolved false with commit, file, and ambiguity evidence
        E->>H: Write actionable HALT
    end
```

## Legend

- The rebase skill remains the judgment boundary and may make coordinated cross-file edits.
- The engine retains deterministic branch-currency and commit-preservation guards.
- Ambiguity is a terminal safety signal for the attempt, not permission to guess.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-01 | Confirmed staged and post-continue validation sequence | Plan update |
| 2026-08-01 | Added proposed integrity sequence | Specify #1152 before implementation |
