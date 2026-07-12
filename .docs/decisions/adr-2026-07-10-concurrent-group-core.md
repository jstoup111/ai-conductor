# ADR: Concurrent group core — one capped, engine-integrated parallel executor

**Date:** 2026-07-10
**Status:** APPROVED (operator-approved 2026-07-10)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#469)
**Amends:** 004-when-parallel-workflow-dsl

## Context

Issue #469 needs the SHIP-tail validators to run concurrently. The engine already has a
parallel primitive — ADR 004's `parallel:` config DSL executed by `runParallelGroup`
(conductor.ts) — but direct code inspection (2026-07-10, all claims **verified**, not
inferred) shows it is unfit and unused:

1. **Wrong dispatch (bug):** every branch calls `this.stepRunner.run(groupName, …)` — the
   *group name*, not the branch's `skill`. All branches execute the same step.
2. **Unbounded fan-out:** plain `Promise.all`, no concurrency cap.
3. **No engine integration:** branch results are checked only for `result.success` —
   `rateLimited`, `sessionExpired`, `authFailure` are dropped on the floor, bypassing the
   retry ladder and the shared rate-limit episode coordinator (which IS designed for
   concurrent waiters: per-process object, later-deadline-wins).
4. **Zero usage:** no `parallel:` key exists in any registered project's
   `.ai-conductor/config.yml` nor the user-level config (all four projects checked
   2026-07-10). The `when-parallel` tests assert the buggy semantics.

Additional verified constraints:
- The step runner's shared `this.sessionId` is single-session; concurrent branches need
  locally-minted session ids (precedent: `uuidv4()` at step-runners.ts:625/678/741 for
  build-review/rebase side-sessions).
- The three validators' stale-marker sweep is keyed per step (`STALE_SWEEP_STEPS` =
  exactly `manual_test`, `prd_audit`, `architecture_review_as_built`).
- No concurrency library exists in runtime deps (only `uuid`); a cap must be hand-rolled.

## Options Considered

### Option A: Extend `runParallelGroup` in place
- **Pros:** single primitive; APPROVED ADR 004 stays the umbrella.
- **Cons:** indistinguishable from the hybrid once "unused" was verified; framing invited
  imaginary back-compat caution.

### Option B: New narrow validation-group runner beside the old one
- **Pros:** smallest diff; strictest reading of the #469 seam lock.
- **Cons:** leaves verified-buggy dead code; #474 (parallel build task-streams, critical)
  would need a third mechanism later.

### Option C (chosen): Hybrid — one new core, both consumers re-pointed
- **Pros:** one correct primitive; DSL schema kept; latent bugs die; #474 gets a base.
- **Cons:** larger diff than B; `when-parallel` tests must be rewritten to corrected
  semantics; more conductor.ts churn while other criticals are in flight.

## Decision

Build a **new concurrent group core** (`GroupCore`) as the engine's only parallel
executor, and re-point both consumers at it:

1. **Capped fan-out.** A hand-rolled semaphore (no new deps) bounds in-flight branches to
   `validation_concurrency` (new top-level config key, default **2**, clamped to ≥1;
   precedent: `rebase_resolution_attempts` — types/config.ts + the `validateConfig`
   allow-list + a `resolve*` clamp helper).
2. **Per-branch skill dispatch.** Each branch runs its own step/skill name — fixing bug (1).
3. **Fresh session per branch.** Each branch mints a local `uuidv4()` session id
   (`resume: false`), never touching the shared `this.sessionId` (fresh-session-per-step
   #325 already guarantees steps assume no conversational carryover).
4. **Rate-limit episode wiring.** A branch that returns `rateLimited` enters the shared
   per-process episode (`enter(deadline)`, later-deadline-wins) and waits on `clear()`
   without burning its retry budget — the same contract as the serial loop's handling
   (conductor.ts rate-limit branch). Sibling branches naturally share the episode object.
5. **Per-branch retry ladder.** Branch retries reuse the step's resolved `max_retries`,
   completion checks, and per-step stale sweep (`STALE_SWEEP_STEPS`) — semantics
   equivalent to the serial loop, scoped per branch.
6. **Single-writer state.** Branches return outcomes; only the core writes
   `conduct-state.json` (synthetic `«group»__«branch»` keys retained from ADR 004) at
   join, eliminating concurrent state-file writes.
7. **`runParallelGroup` is deleted**, and the ADR-004 `parallel:` DSL (config schema
   **unchanged**) executes through the core. `when-parallel` tests are rewritten against
   the corrected semantics (branch-skill dispatch, cap, rate-limit pass-through).
8. **Events.** Existing `parallel_started` / `parallel_failure` / `parallel_completed`
   events are kept; branch-level step events carry the branch name so interleaved logs
   stay attributable.

Chosen because the "keep two primitives" cost of Option B was justified only by a
back-compat risk that verification showed does not exist, and because #474 (parallel task
streams in build) will reuse this core rather than grow a third mechanism.

## Consequences

### Positive
- One correct, capped, engine-integrated concurrency primitive; no dead code.
- The DSL becomes actually usable; its three latent bugs are fixed as a byproduct.
- #474 inherits a ready base.

### Negative
- Larger conductor.ts diff than the pure-narrow option, while other criticals flow
  through the same file (rebase churn risk).
- `when-parallel` test suite must be rewritten, not merely extended.
- Two consumers share one core: a core regression affects both (mitigated by the
  rewritten test suite covering both consumers).

### Follow-up Actions
- [ ] `validation_concurrency` documented in README.md + src/conductor/README.md (same PR)
- [ ] Append "Amended by: adr-2026-07-10-concurrent-group-core" note to
      004-when-parallel-workflow-dsl.md (append-only)
- [ ] #474 design should target this core (note on the issue after merge)
