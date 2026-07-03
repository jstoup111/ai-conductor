# ADR: Post-rebase refresh is the only force-push, and only `--force-with-lease`

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session

## Context

With `pr_timing: early-draft`, the daemon pushes the feature branch during the build. The
finish-time native rebase step (adr-001-rebase-insertion-mechanism) rewrites local history
when the base has moved, so an early-pushed remote branch diverges after a successful
rebase and a plain push is rejected. Today **no force-push exists anywhere** in
`src/conductor/src/` (verified by grep: only `git worktree remove --force` and
`gh label create --force`), and escalation deliberately skips pushing on rebase-conflict
HALTs because "pushing mid-rebase is unsafe" (`conductor.ts:508-511`). Introducing any
force-push therefore needs an explicit, contained policy.

## Options Considered

### Option A: `--force-with-lease` push, engine-native, only immediately after a successful rebase
- **Pros:** Lease refuses to clobber a remote the daemon didn't last write; scope is one
  deterministic engine-native call site; ADR-001's no-dispatch keystone and satisfied
  predicate are untouched.
- **Cons:** First force-push in the system — a policy precedent that must stay contained.

### Option B: Delete the remote branch and re-push after rebase
- **Cons:** Closes the open draft PR (GitHub auto-closes PRs whose head branch is
  deleted), destroying the visibility the mode exists to provide.

### Option C: Never rewrite pushed history (merge base into branch instead of rebase)
- **Cons:** Contradicts APPROVED adr-001 (rebase-on-latest is the sanctioned insertion
  mechanism); merge-commit noise in implementation PRs.

## Decision

Option A, with hard containment rules:

1. The **only** call site permitted to force-push is the engine-native early-draft refresh
   that runs immediately after the native rebase step reports success. It uses
   `git push --force-with-lease` — never bare `--force`.
2. Every other early-draft push (build start, loopGate step boundaries, engineer
   checkpoint pushes) is a plain fast-forward push; a rejected plain push outside the
   post-rebase site is a loud advisory failure, never an escalation to force.
3. **No push of any kind during a paused rebase or rebase-conflict HALT** — unchanged from
   today's escalation rule (`conductor.ts:508-511`).
4. ADR-001 is not amended: rebase detection, the satisfied predicate, no-dispatch (except
   the bounded conflict_halt sub-path from
   adr-2026-06-29-rebase-conflict-resolution-dispatch), and kickback re-verification all
   stay exactly as specified. This ADR only governs what happens to the **remote** copy
   after a rebase the existing machinery already performed.
5. The push goes through the `pr-labels.ts` `GitRunner` seam (injectable, kill-switch
   guarded) so tests never touch a real remote.

## Consequences

### Positive
- Early-pushed draft PRs survive the finish-time rebase with full history continuity.
- Lease semantics make a concurrent-writer clobber structurally impossible; combined with
  the one-daemon-per-repo rule, the daemon is always the lease holder.

### Negative
- A force-push precedent now exists; reviewers must reject any new force call site that
  cites this ADR outside the post-rebase refresh (the containment rule IS the decision).

### Follow-up Actions
- [ ] Implement the post-rebase refresh call site gated on `pr_timing === 'early-draft'` AND rebase success
- [ ] Negative-path test: plain push rejected mid-build does NOT escalate to force
- [ ] Negative-path test: no push occurs during rebase-conflict HALT
