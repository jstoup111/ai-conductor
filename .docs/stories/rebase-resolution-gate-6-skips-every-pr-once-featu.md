**Status:** Accepted

# Stories: Rebase resolution with retained feature worktrees

Source: `jstoup111/ai-conductor#1150`

## Story: Resolve conflicts while an idle feature worktree is retained

As an operator, I want the daemon to distinguish a retained worktree from a live feature run so
conflicted implementation PRs continue receiving automatic rebase resolution without racing an
active build.

### Acceptance Criteria

#### Happy Path

- Given a watched open implementation PR is conflicting and its feature worktree is retained but no
  feature run is active for that slug, when the daemon evaluates rebase-resolution eligibility,
  then the retained worktree does not block the attempt and resolution is dispatched.
- Given an eligible PR has a retained feature worktree, when resolution runs, then its transient
  resolution checkout exists alongside the retained worktree and neither checkout disturbs the
  other's files or lifecycle.
- Given an active feature run finishes and its retained worktree remains, when a later sweep
  evaluates the still-conflicting PR, then it becomes eligible without operator cleanup of that
  worktree.

#### Negative Paths

- Given a feature run genuinely owns the slug when a conflicting PR is evaluated, when the sweep
  reaches rebase-resolution eligibility, then resolution is skipped, no transient resolution
  checkout is created, and the outcome log names the active-run reason.
- Given one rebase-resolution attempt is already active, when another sweep evaluates any
  conflicting watched PR, then the existing resolution serial guard still defers the second
  attempt.

### Done When

- [ ] Focused tests prove that retained-and-idle is eligible while genuinely-active is skipped with
      an explicit reason, and that eligibility returns after the active run ends.
- [ ] Focused tests prove the retained feature checkout and transient resolution checkout can
      coexist without either being removed or modified by the other's lifecycle.
- [ ] Existing autoresolve cooldown, attempt-cap, remediation-label, and resolution-serialization
      tests remain green.
- [ ] The approved resolution-worktree lifecycle ADR is amended or superseded so it no longer
      equates feature-worktree existence with an active daemon owner.
