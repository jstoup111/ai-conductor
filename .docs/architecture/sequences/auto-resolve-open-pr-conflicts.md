# Sequence: Auto-Resolve a Conflicting Open PR

**Last updated:** 2026-07-04
**Scope:** One sweep tick handling a watched PR that GitHub reports CONFLICTING — happy path
(deterministic-only resolution) with the escalation alternative.
**Source PRD:** `.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md`

## Diagram

```mermaid
sequenceDiagram
    participant Sweep as mergeable sweep
    participant GH as GitHub (gh)
    participant WT as resolve worktree
    participant Rebase as rebase engine
    participant Skill as /rebase session
    participant Suite as test suite

    Sweep->>GH: prMergeState(prUrl)
    GH-->>Sweep: CONFLICTING, labels
    Sweep->>Sweep: gate — no needs-remediation, cooldown ok, attempts under cap
    Sweep->>WT: create .worktrees/resolve-«slug» at PR branch tip
    Sweep->>Rebase: rebase onto origin/«default»
    Rebase-->>Sweep: conflicts list
    Rebase->>Rebase: Tier 1 deterministic — CHANGELOG re-append, .docs keep-both
    alt conflicts remain
        Rebase->>Skill: dispatch bounded attempt (1..cap)
        Skill-->>Rebase: resolved or cannot-resolve
    end
    alt resolution complete
        Rebase->>Rebase: guards — isBranchCurrent, featureCommitsPreserved
        Rebase->>Suite: run full suite in worktree
        Suite-->>Rebase: green
        Rebase->>GH: git push --force-with-lease
        GH-->>Sweep: PR mergeable again
        Sweep->>WT: remove worktree, reset attempt state
    else gave up or any gate failed
        Rebase->>Rebase: git rebase --abort (branch untouched)
        Sweep->>GH: remove mergeable, add needs-remediation, comment reason
        Sweep->>WT: remove worktree, keep attempt state
    end
    Sweep->>Sweep: log outcome (FR-16)
```

## Legend

- The **only** externally visible mutation on the success path is the lease-protected push.
- The escalation path mutates labels + one comment; the PR branch itself is never touched.
- «slug» / «default» are placeholders for the feature slug and the repo's derived default branch.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | New auto-resolution flow (intake #247) |
