# ADR: Dedicated Transient Worktree for Open-PR Conflict Resolution

**Status:** APPROVED
**Date:** 2026-07-04
**Related:** adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep

## Context

Resolution must rebase and run the suite somewhere isolated (PRD NFR-2). Candidate
workspaces: the feature's original build worktree (may still exist, may carry HALT/mid-build
state, may have been removed), the primary checkout (forbidden), or a dedicated worktree.

## Options

- **A. Reuse the feature's build worktree** — often gone after finish; when present it is
  daemon-owned state (possible live HALT, paused rebase, dirty tree) that resolution must not
  disturb; entangles two lifecycles.
- **B. Dedicated transient worktree per resolution (chosen)** — `git worktree add` at the PR
  branch tip under `.worktrees/resolve-<slug>`, removed when the attempt ends.
- **C. Bare clone per resolution** — heavier (full checkout + separate object store), no gain
  over a worktree in the same repo.

## Decision

Option B, with these rules:

1. **Provision:** fetch, then worktree-add at the PR branch tip; run the existing
   `prepareWorktree` namespace step (`WORKTREE_NAMESPACE` in `.env`) so the suite run is
   isolated from other worktrees' resources.
2. **Teardown on BOTH success and failure.** Unlike finish-time (which leaves a paused rebase
   for the human), an open-PR resolution aborts the rebase on any failure — the durable state
   is the untouched PR branch, the escalation label, and the reason comment. A leftover
   worktree has nothing a human needs; removing it also lets the next attempt (after
   cooldown / operator clear) start clean. A stale `resolve-<slug>` leftover from a crashed
   run is force-recreated at the next attempt.
3. **Eligibility guard:** skip resolution for a slug whose **build worktree currently exists**
   (`.worktrees/<slug>`) — that feature is daemon-owned right now (mid-build, halted, or
   awaiting rekick), and two actors rewriting one branch invites lease races. The sweep logs
   the skip (FR-16).
4. Resolution worktrees are disjoint by construction from build worktrees (`resolve-` prefix)
   and from engineer authoring worktrees (`engineer-` prefix).

## Consequences

- No lifecycle entanglement with build or rekick machinery; the lease push remains the last
  line of defense against the residual race window.
- Disk cost is transient (one checkout during an attempt).
- The build-worktree guard means a halted feature's PR waits for the operator/rekick path
  instead of being auto-refreshed underneath it — intentional precedence.
