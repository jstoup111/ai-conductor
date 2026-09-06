# Track: Recoverable resolution worktree after a crashed attempt

Track: technical

Scope boundary: Small fix for #2157, approved by the operator on 2026-09-06 (delegated). Make the transient resolution worktree helper reap its own leftover git registration before recreating the checkout, so the next attempt for the same slug recovers without an operator running a prune by hand. Reaping stays scoped to that attempt's own path. Repository-wide registration sweeps, the daemon's per-feature worktree lifecycle, the mergeable-sweep eligibility gate, escalation labelling, and the CI-fix caller's own behavior are outside this slice.

This is an internal engine correction to an existing daemon code path; acceptance criteria live in technical stories rather than a PRD.

The operator approved the scoped path-targeted reap over the filer's `git worktree prune` hypothesis on 2026-09-06 (delegated). A repository-wide prune reaps sibling slugs racing through their own lifecycle; the repository already rejected that trade-off once, in the targeted stale-registration helper the feature worktree cleanup path uses.

Scope check: A — consumer-facing (the transient resolution worktree runs in any project whose daemon performs mergeable autoresolve; no self-host, live-boundary, or `isSelfBuild()` code path is touched, so no repo-only signal fires); B — n/a (no new skill); C — provider-agnostic (git subprocess behavior only, no provider path, variable, or capability). No catalog registration is required. No canonical documentation page describes autoresolve-specific prune recovery, so no documentation update is owed.

Verified foundation: `src/conductor/src/engine/autoresolve.ts:342-351` removes the leftover directory with `rm` and then calls `git worktree add --detach`, with no registration reap in between; the `finally` at line 368 only runs in-process, so a genuine crash never reaches it. `src/conductor/src/engine/worktree.ts:98-110` and its `removeStaleWorktreeRegistration` helper already establish the targeted-remove precedent and record, in a code comment, why `git worktree prune` is unsafe when another slug is racing. `git worktree remove --force` on a registered-but-missing path exits 0 and clears the registration, and exits 128 harmlessly when the path is not a working tree (verified against git 2.53.0 in a throwaway repository). `src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts` already drives this helper against a real local git repository and covers only the unregistered-leftover case.
