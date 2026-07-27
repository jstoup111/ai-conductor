**Status:** Accepted

# Engineer handoff publishes the spec branch before opening its PR

## Story: Publish a new spec branch during handoff

**Requirement:** TECH-1 — Remote handoff delivers the landed spec branch and opens its PR without a manual push.

As an operator, I want `engineer handoff` to publish a newly landed spec branch before opening its
PR so that the first handoff completes without manual Git intervention.

### Acceptance Criteria

#### Happy Path

- Given a landed `spec/<slug>` branch in its per-idea worktree and an `origin` remote where that
  branch does not yet exist, when handoff runs, then the exact local branch is pushed to `origin`
  with upstream tracking before the PR-create command runs.
- Given that branch publication succeeds, when handoff continues, then it opens the spec PR for
  `spec/<slug>` from the per-idea worktree and reports the existing `pr-opened` result with its URL.
- Given the remote branch already exists at the same or an earlier commit reachable by a normal
  fast-forward push, when handoff is retried, then publication succeeds without force-pushing and
  PR creation proceeds.

#### Negative Paths

- Given the local and remote spec branches have diverged, when the normal push is rejected, then
  handoff does not force-push, does not attempt PR creation, exits nonzero, and reports that the
  per-idea worktree was retained.
- Given branch publication succeeds but PR creation fails or returns no PR URL, when handoff
  reports the failure, then it exits nonzero and retains the per-idea worktree instead of reporting
  `local-commit` success.

### Done When

- [ ] An observable command trace proves `git push -u origin spec/<slug>` completes before
      `gh pr create --head spec/<slug> --fill`, with both commands scoped to the per-idea worktree.
- [ ] A brand-new remote branch produces the existing `pr-opened` JSON result without any manual
      pre-push.
- [ ] Retry and divergent-remote checks prove handoff never issues a force push.
- [ ] Push and PR-creation failures return a nonzero CLI status and leave the worktree present.

## Story: Preserve the genuine no-remote fallback

**Requirement:** TECH-2 — Offline repositories retain their successful local-only handoff outcome.

As an operator of a repository without a remote, I want handoff to preserve the committed spec
locally so that remote publication is not required for a valid offline workflow.

### Acceptance Criteria

#### Happy Path

- Given the target repository has no configured remote, when handoff runs, then it returns the
  existing `local-commit` result with the reachable spec branch and does not attempt either a push
  or PR creation.
- Given an intake-sourced idea takes the no-remote branch, when handoff records delivery evidence,
  then the authored key and branch evidence remain recorded as in the existing fallback contract.

#### Negative Paths

- Given an `origin` remote exists but its push fails because of authentication, network,
  authorization, or remote rejection, when handoff classifies the failure, then it does not label
  the outcome as no-remote or emit a successful `local-commit` result; it exits nonzero and retains
  the per-idea worktree.
- Given a GitHub PR command fails after a successful push, when handoff classifies the failure, then
  the presence of the now-published branch does not convert the failure into a no-remote fallback.

### Done When

- [ ] A repository with no configured remote returns exit 0 with `kind: "local-commit"`, keeps the
      spec branch reachable, and preserves authored-ledger and source-branch evidence.
- [ ] No-remote execution records no push or PR-create invocation.
- [ ] Representative authentication, network, remote-rejection, and PR-create failures return
      nonzero and never emit `kind: "local-commit"`.
