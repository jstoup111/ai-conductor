# ADR: Rebase the current validated branch before publication

**Date:** 2026-07-26
**Status:** APPROVED (operator-approved 2026-07-26)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#922)
**Supersedes:** adr-001-rebase-insertion-mechanism; adr-2026-07-26-serial-ship-tail-publication
**Amends:** adr-2026-07-11-verdict-aware-resume-entry (explicit targeting remains exempt from the
resume clamp, but not from the finish publication fence)

## Context

The conductor must publish or update a feature PR only from a branch that has completed every
applicable SHIP validation at the current HEAD and has been rebased onto its current base. The
validation group (`manual_test`, `prd_audit`, and `architecture_review_as_built`) is intentionally
a capped parallel fan-out/fan-in group; this decision does not serialize its members.

The original rebase ADR correctly established the native rebase step, base discovery, no-remote
fallback, conflict HALT, and changed-tree revalidation, but fixed its prerequisite at
`manual_test`. Later SHIP validation added two more group members. Moving the prerequisite to the
completed validation tail improves normal ordering, but is not sufficient as a publication safety
invariant: an already-`done` rebase can satisfy `finish`, the state prerequisite helper treats
`stale` as satisfied, and explicit `fromStep` intentionally bypasses the resume-entry verdict
clamp. The live #922 incident also demonstrated that finish can be reached with failed or stale
validation state. Publication therefore needs a local current-HEAD fence at its own boundary.

## Options Considered

### Option A: Retain the original rebase prerequisite
- **Pros:** No scheduling change.
- **Cons:** Allows externally visible PR publication before all SHIP validation is green.

### Option B: Add a persisted validation epoch or separate publish/join step
- **Pros:** Makes validation freshness an explicit state-machine token.
- **Cons:** Adds new persistent state, migration rules, and a second join representation beside the
  existing validation group.

### Option C: Serial publication tail plus an engine-owned finish fence
- **Pros:** Keeps validation concurrent; establishes an inspectable group join → rebase → finish
  order; protects every finish entry path with current-HEAD evidence; reuses the existing skip,
  completion, verdict, and group-dispatch authorities.
- **Cons:** Recomputes three small completion predicates before finish and can redirect an explicit
  `--from finish` invocation to validation.

## Decision

Choose Option C:

1. The applicable validation members continue to dispatch concurrently under
   `validation_concurrency` and join before the serial tail advances.
2. `rebase` depends on the completed-or-skipped validation tail (`retro`); `finish` continues to
   depend on `rebase`.
3. Immediately before any `finish` dispatch or publication side effect, the engine resolves
   validation membership with the existing tier, track, upstream-skip, bootstrap-mode, and
   configuration predicates. Validly skipped members are excluded.
4. For every applicable member, the fence requires both a `done` state and a freshly recomputed,
   satisfied objective verdict at the current HEAD. `manual_test` must additionally contain no
   FAIL rows. A `failed`, `stale`, pending, or objectively incomplete member is non-green even when
   an older artifact remains on disk.
5. When the fence is non-green, finish is not marked `in_progress` and is not dispatched. The
   engine writes the fresh gate verdicts, marks only the non-green applicable members `stale`,
   emits one observable `kickback` from `finish` to the earliest such member, and redirects there.
   If several members need work, the existing validation group reruns them concurrently; green
   siblings remain complete.
6. `fromStep` remains an explicit navigation override and remains exempt from the #532 resume
   clamp. It is not a publication authorization: `--from finish` still crosses this fence.
7. A no-op rebase can advance to the fence. A changed rebase applies existing invalidation and
   returns through affected build/validation work before the fence can pass. A conflicted rebase
   retains its existing HALT and prevents finish.

The daemon's pre-loop re-kick rebase remains unchanged. It may refresh the branch before pending
validation runs, but it cannot authorize publication because every finish entry crosses the same
current-HEAD fence.

All other original rebase decisions remain unchanged: the rebase remains engine-native; its base
is discovered at runtime with local fallback; and rebase conflict resolution, evidence translation,
and current changed-tree invalidation behavior retain their existing contracts.

## Consequences

### Positive
- The parallel validation fan-out/fan-in remains intact; only the publication tail is serial.
- The PR publication action follows a current-HEAD green validation outcome on every entry path.
- A stale runtime state or explicit starting point cannot bypass the boundary invariant.
- One ADR is the current authority for rebase placement and finish-time safety behavior.

### Negative
- A successful SHIP tail incurs rebase time after validation rather than in parallel.
- Finish performs bounded filesystem checks and refreshes three gate verdicts before dispatch.
- Explicit `--from finish` can redirect to validation, superseding the older expectation that
  targeting finish necessarily dispatches it first.

### Follow-up Actions
- [ ] Update the registry prerequisite and its explanatory comments.
- [ ] Update the Phase 9.0 rebase story to describe the applicable validation tail.
- [ ] Add the engine-owned current-HEAD finish validation fence before all finish side effects.
- [ ] Add acceptance coverage for concurrent validation, already-done rebase state, explicit
  `--from finish`, valid skips, changed-rebase revalidation, and rebase-conflict suppression.
