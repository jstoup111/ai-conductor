# ADR: Every non-done dispatch outcome leaves an operator-clearable lever

**Date:** 2026-08-05
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (#1329)

## Context

`makeRunFeature` (`src/conductor/src/engine/daemon-runner.ts`) wraps a dispatch in a
try/catch that writes a diagnostic `.pipeline/HALT` so an errored feature parks for human
inspection instead of being silently excluded. The catch is guarded by `if (worktree)` —
`worktree` is assigned by `deps.createWorktree(item.slug)` at the top of the try. If
`createWorktree` itself throws (a leftover directory, a 128 from `git worktree add`, a
permissions failure), `worktree` is still `undefined`, so **no marker is written**.

`pickEligible` (`daemon.ts:130-170`) then treats the slug via `started`/`parked`: an errored
outcome adds it to `parked`, whose only exit is `isHalted` reporting the marker gone — but
the marker was never written, so the daemon believes it is still parked with nothing for the
operator to clear. There is no HALT to remove, no `.daemon/parked/` entry to unpark, and no
gate to satisfy.

This is the shape #1329 reports: a worktree on disk with setup-era artifacts only
(`git-hooks`, `session-hooks`, `step-heartbeat`, `task-evidence.json`), no
`conduct-state.json`, no HALT, no park — and no supported operator lever.

Confidence note: that `createWorktree` threw is the **best-supported** explanation for the
observed missing marker (~35%); it has not been confirmed from the `reporting_app` daemon
log. This decision deliberately does not rest on that attribution — it states an invariant
that must hold for **every** non-done outcome regardless of which path fired.

## Options Considered

### Option A: Fix only the confirmed failing path
- **Pros:** Minimal.
- **Cons:** The failing path is not confirmed. Fixing one branch leaves the class of "errored
  with no lever" open, and the next variant reproduces the same unrecoverable state.

### Option B: Drop the process-lifetime exclusion — retry errored slugs each tick
- **Pros:** Nothing gets permanently stuck.
- **Cons:** Reintroduces the tight re-kick spin this repo has already been burned by
  (`CLAUDE.md`, daemon-ops rule 2: the resume path re-kicks git errors with no backoff,
  #681). Unbounded retry of a deterministic failure is worse than a visible stop.

### Option C: Invariant — no non-done outcome returns without an operator-clearable marker
- **Pros:** Closes the whole class. Keeps the deliberate stop (no spin) while guaranteeing
  the stop is always operator-reachable and always explains itself.
- **Cons:** The marker must be writable at a path derivable **without** a worktree handle, so
  the runner needs the deterministic worktree path independent of `createWorktree` success.

## Decision

**Option C.** Establish the invariant: **a dispatch that ends in any state other than `done`
must leave a marker an operator can find and clear**, and the daemon must treat that marker
as the sole resume condition.

Concretely:

1. The error catch derives the marker path from the slug (the deterministic
   `.worktrees/<slug>` location), not from the possibly-unassigned `worktree` handle, so a
   `createWorktree` failure still produces a marker.
2. When even that write fails, the failure is logged explicitly as an unrecoverable-state
   warning naming the slug — the daemon never returns an error outcome while silently
   believing a lever exists.
3. The marker content names the failing stage and the operator action that resumes it.
4. Retry semantics are unchanged: the feature stays stopped until the operator clears the
   marker. This ADR does not introduce automatic retry.

## Consequences

### Positive
- No dispatch failure can produce a feature that is excluded with nothing to clear.
- The stop remains deliberate — no retry spin is introduced.

### Negative
- The runner must know the deterministic worktree path for a slug before creation succeeds,
  a small coupling between the runner and the worktree layout convention.
- A marker may be written into a directory that is not a valid git worktree; it is a
  diagnostic file, and the operator-facing remedy must account for that case.

### Follow-up Actions
- [ ] Derive the error-marker path from the slug, not the worktree handle.
- [ ] Log explicitly when the marker write itself fails.
- [ ] Assert the invariant in tests for the createWorktree-throws path.
