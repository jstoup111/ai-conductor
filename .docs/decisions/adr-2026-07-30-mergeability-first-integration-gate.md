# ADR: Use prospective mergeability as the automatic integration gate

**Date:** 2026-07-30
**Status:** SUPERSEDED by `adr-2026-07-30-finish-only-mergeability-gate`
**Deciders:** James Stoup (operator), engineer session
**Amends:** `adr-2026-07-26-rebase-tail-current-branch-before-publication`

## Context

The current publication tail requires the validated feature branch to be current with its resolved
base. Both finish-time integration and re-kick resume call the same engine-owned rebase primitive,
which rebases whenever the base contains commits absent from the feature.

The operator’s priority is prompt mergeability with stable feature history, not ancestry freshness.
An advanced base should trigger history rewriting only when the feature cannot merge cleanly into
that base.

Constraints:

- Existing detection of a paused/incomplete rebase must run before any safe-skip decision.
- Both automatic integration callers must make the same decision.
- Conflict recovery remains automatic and retains its bounded resolver and HALT behavior.
- A clean skip must not invoke evidence translation or protected-artifact seal rebaselining because
  feature history did not move.
- An indeterminate result must enter the existing rebase path.
- Git 2.53’s installed documentation verifies that a prospective merge returns exit status `0` for
  clean, `1` for conflicts, and another status for an inability to complete. Its quiet mode is
  explicitly intended for exit-status-only use and can stop early on conflict.

## Options Considered

### Option A: Classify mergeability inside the shared rebase primitive

After the active-rebase guard and base resolution, retain the already-current fast path. For a
feature behind its base, perform a read-only prospective merge:

- clean → return a distinct mergeable-skip outcome;
- conflict → continue into the existing rebase path;
- error/unknown → continue into the existing rebase path.

**Pros:** One policy covers finish and re-kick by construction; no network or PR dependency; existing
recovery stays intact; no history rewrite on the common mergeable path.

**Cons:** A merge-level conflict result does not predict which replayed commit will conflict during
the subsequent rebase. The check may write unreachable Git objects even though it changes no refs,
index, worktree, or commit history.

### Option B: Classify hosted PR mergeability

Use the hosting platform’s PR state as the finish decision.

**Pros:** Closest match to hosted merge acceptance.

**Cons:** Network-dependent, can be unknown, unavailable when draft publication failed, and couples
the engine-native gate to one hosting provider.

### Option C: Remove finish-time integration

Publish every completed branch unchanged and defer conflicts to the post-publication sweep.

**Pros:** No routine history rewriting and the smallest finish path.

**Cons:** Discovers conflicts later and splits completion recovery across two asynchronous
mechanisms.

## Decision

Adopt Option A.

Add a deterministic tri-state prospective-merge classifier at the single shared integration seam.
The existing `performRebase` primitive remains the production owner because both finish-time and
re-kick already call it.

Decision order:

1. Reject an already-active or paused rebase exactly as today.
2. Resolve the current default/base target.
3. If the feature is already current, return the existing already-current no-op.
4. Otherwise evaluate a prospective merge of committed `HEAD` and the resolved base without
   changing refs, index, worktree, or history.
5. Clean → return `mergeable_skip`; do not verify/rotate the rebase-specific seal, translate
   evidence, invalidate gates, or run rebase.
6. Conflict or indeterminate → run the existing protected-seal preflight and rebase/resolution path.

`mergeable_skip` is a distinct `RebaseOutcome` variant and emits a distinct event. It satisfies the
existing engine-native loop gate without downstream invalidation. The step retains its historical
name for lifecycle compatibility; only its satisfied predicate changes from “current with base” to
“current with base or prospectively mergeable.”

This amends only the freshness predicate in
`adr-2026-07-26-rebase-tail-current-branch-before-publication`. Its serial validation → integration
→ finish placement, current-HEAD validation fence, changed-rebase invalidation, conflict recovery,
and manual rebase rules remain authoritative.

## Consequences

### Positive

- Mergeable completed branches keep stable history and reach publication sooner.
- Finish-time and re-kick cannot drift because they share one classifier.
- Conflict recovery remains automatic.
- Clean skips avoid evidence translation, seal rebaselining, and downstream re-verification.
- The decision is local, deterministic, and provider-independent.

### Negative

- The feature can finish while not containing the latest base commits; later target-branch changes
  can still create conflicts before merge.
- A merge conflict indicates recovery is needed but does not identify the eventual per-commit rebase
  conflict shape.
- Existing telemetry and tests that equate a no-op with “already current” must gain a distinct
  mergeable-skip outcome.

### Follow-up Actions

- [ ] Add the prospective-merge classifier and tri-state tests.
- [ ] Extend rebase outcomes, verdicts, events, and operator formatting for mergeable skip.
- [ ] Cover both finish-time and re-kick paths with real-Git integration tests.
- [ ] Prove conflict and indeterminate outcomes enter the existing automatic resolver.
- [ ] Update daemon and recovery documentation.
