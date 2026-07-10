# Sequence: Setup-failure triage (#446)

**Last updated:** 2026-07-09
**Scope:** The two triage stages that run when `bin/setup` fails in a daemon worktree,
from re-dispatch of a kept broken tree through quarantine, retry, fix-session, and the
HALT terminal.

## Diagram

```mermaid
sequenceDiagram
    participant D as makeRunFeature
    participant P as prepareWorktree
    participant S as bin/setup
    participant T as setup-triage
    participant G as git in worktree
    participant F as fix-session agent
    participant H as HALT marker

    D->>P: prepare kept worktree «slug»
    P->>S: run with CI=true
    S-->>P: non-zero exit + stderr tail
    P->>T: classified SetupFailure
    T->>G: status porcelain
    alt tree is dirty
        T->>G: commit ALL uncommitted and untracked to wip/setup-quarantine-«slug»
        T->>G: reset hard to HEAD
        T->>S: re-run setup ONCE
        alt retry passes
            S-->>T: exit 0
            T-->>D: dispatch normally, quarantine ref logged
        else retry still fails
            S-->>T: non-zero exit
            T->>F: one bounded fix-session, prompt = stderr tail
        end
    else tree already clean
        T->>F: one bounded fix-session, prompt = stderr tail
    end
    alt contract met - setup exit 0, fix committed
        F-->>D: dispatch normally
    else contract failed
        F->>H: HALT naming setup error and quarantine ref
        H-->>D: feature parked for operator
    end
```

## Legend

- Stage 1 (quarantine + single retry) is deterministic git machinery; stage 2 (fix-session)
  is the single LLM dispatch, one attempt per rotation.
- The quarantine commit is created BEFORE any reset — preserve-then-heal, never
  silently discard.
- «slug» is the feature slug of the wedged worktree.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-09 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#446 |
