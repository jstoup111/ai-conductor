# ADR: Operator park drains one scheduling unit, then stops with a typed outcome

**Date:** 2026-07-29
**Status:** APPROVED (operator-approved 2026-07-29)
**Deciders:** James Stoup (operator), Codex engineer session
**Supersedes:** `adr-2026-07-04-operator-park-marker`
**Preserves:** the superseded ADR's marker ownership, repo-root storage, fail-toward-parked reads, dashboard precedence, and canonical park-state module
**Depends on:** `adr-2026-07-10-concurrent-group-core`
**Compatible with:** `adr-2026-07-29-deterministic-build-verification-fanout` in the concurrently authored deterministic-test-suite spec

## Context

The approved 2026-07-04 operator-park ADR makes a park durable and absolute before feature dispatch and re-kick, but its third decision explicitly leaves an already-running feature attempt untouched. One attempt now spans many serial steps and may contain concurrent groups. A park placed during an early unit can therefore permit later model, test, review, and publication work before the attempt ends.

The product contract now requires a narrower boundary: the active serial step or whole parallel group settles through its ordinary result path, every applicable status becomes durable, and the daemon stops before another scheduling unit starts. Interactive runs remain unchanged.

Verified source facts:

- `Conductor.run()` owns serial dispatch and both configured and built-in concurrent-group entry paths.
- Successful serial-step status is written before the loop advances.
- The approved concurrent-group core settles every started branch and gives the conductor a single-writer join for state, gates, and joined events.
- `runConductorInWorktree` currently returns no termination value; `makeRunFeature` interprets a return with neither DONE nor HALT evidence as an error and writes a HALT.
- The daemon's feature outcome type currently has only `done`, `halted`, and `error`; the pool already has a distinct durable operator-park predicate and an in-memory parked set used for later resume.
- The concurrently authored deterministic BUILD verification group is approved to reuse the same concurrent-group core and conductor scheduler; it does not introduce a second executor.

## Options Considered

### Option A: Keep attempt-level parking

- **Pros:** no engine changes; current ADR remains intact.
- **Cons:** does not satisfy the approved product requirement and continues later autonomous work after the operator asks to stop.

### Option B: Write a second worktree-resident boundary marker

- **Pros:** daemon outcome readers can classify the stop after the conductor returns; survives a process restart.
- **Cons:** duplicates the repo-root park source of truth, requires a second clear/staleness lifecycle, permits contradictory marker states, and can make an old boundary stop masquerade as current after unpark.

### Option C: Return a typed boundary-stop result through the daemon call chain (chosen)

- **Pros:** preserves one durable park authority; makes an intentional stop unambiguous even if the operator unparks immediately after the boundary observation; avoids manufacturing HALT evidence; ignored return values preserve interactive call sites.
- **Cons:** extends conductor, runner, and pool outcome contracts and requires exhaustive classification updates.

### Option D: Stop from an event listener or process signal after step completion

- **Pros:** keeps the policy outside the conductor scheduler.
- **Cons:** races event delivery against state writes and the next dispatch, creates signal/cancellation cleanup paths, and cannot naturally treat a parallel join as one boundary.

## Decision

Choose Option C and carry forward every unaffected decision from the superseded operator-park ADR.

1. **One durable authority remains.** Repo-root operator park state stays the only persistent park directive. No boundary-specific PARKED or HALT file is added to a feature worktree.
2. **Daemon-only predicate.** The daemon composition injects a fail-toward-parked boundary predicate into the conductor, closed over the main project root and feature slug. Interactive conductor construction omits it and is byte-for-byte unchanged.
3. **One pre-unit gate.** The conductor consults that predicate at the shared scheduler boundary immediately before any pending serial step, configured parallel group, or built-in parallel group begins. Completed/skipped state may be traversed to find the next pending unit, but no pending unit dispatches before the gate passes.
4. **Drain, then decide.** The gate is never consulted inside an active scheduling unit. Serial work reaches its ordinary terminal status path. Concurrent work settles every started member and completes the core's single-writer join. Only the next scheduler boundary can stop progression.
5. **Typed termination, not inferred absence.** When the gate sees an active or indeterminate park, the conductor returns an `operator-parked` termination carrying the last settled scheduling-unit identity when available. The daemon worktree wrapper propagates that result directly; it is not reconstructed later from missing DONE/HALT markers or from a second park read.
6. **First-boundary race is covered.** The existing pre-rebase park check returns the same typed result. A park landing after feature selection but before the first conductor unit therefore remains an intentional park, never an indeterminate loop exit that creates a false HALT.
7. **Pool state is explicit.** The feature runner maps the typed termination to a distinct `parked` feature outcome, keeps the worktree, and skips failure escalation, HALT creation, completion narration, and shipped/processed side effects. The daemon pool records the slug in its in-memory parked set without registering a machine-HALT watcher. Removing the durable park later makes the persisted feature state eligible for ordinary resume.
8. **Natural failures retain authority.** If active work produces a genuine halt, error, kickback, or remediation disposition, that existing outcome and its diagnostics remain authoritative. Operator-park display precedence remains unchanged, but parking does not rewrite the work's status.
9. **Boundary reporting is persisted.** A provider-neutral boundary event records the slug's last settled serial step or parallel group and is rendered in the feature-scoped daemon log. This event reports lifecycle state; it does not become a second completion or park authority.
10. **Every parallel group inherits the gate.** Park handling is outside group membership and branch execution. The current SHIP validation group, the concurrently specified deterministic BUILD verification group, configured parallel groups, and future groups all join normally and encounter the same next-unit gate without park-specific member code.

## Verify-Claims Ledger

### Claims

- **Verified (99%):** the conductor owns every current serial and concurrent-group dispatch path — direct inspection of `conductor.ts` and `group-core.ts`.
- **Verified (99%):** current serial success and parallel joins persist terminal state before control returns to the outer loop — direct inspection of `conductor.ts`, `state.ts`, and the approved concurrent-group ADRs.
- **Verified (99%):** missing DONE/HALT evidence currently becomes an error in `makeRunFeature` — direct inspection of `daemon-runner.ts` and `daemon-deps.ts`.
- **Verified (98%):** a typed result can propagate through the in-process daemon wrapper without external transport, storage, or provider behavior — direct inspection of `daemon-cli.ts`, `daemon-deps.ts`, and `daemon-runner.ts`.
- **Verified (95%):** the sibling deterministic BUILD group is designed on the shared group core and conductor scheduler — inspected its operator-approved ADR and architecture review in the live sibling engineer worktree; it is not merged yet.

### Assumptions

- **Confirmed (100%, operator):** the park boundary is the whole active parallel group, not each member independently.
- **Confirmed (100%, operator):** parking preserves the active unit's natural status before stopping and never forces a status.
- **Confirmed (100%, operator):** boundary parking is daemon-only; interactive conduct remains unchanged.

**Verdict:** CLEAR.

## Consequences

### Positive

- A mid-attempt park has a bounded, observable stopping point without cancelling in-flight work.
- Park authority remains single-source and restart-safe.
- Serial and parallel scheduling share one enforcement rule, including groups added later.
- Immediate unpark after boundary observation cannot turn the intentional stop into a false missing-marker error.

### Negative

- The daemon call chain and feature-status union gain a fourth normal outcome.
- Every feature-outcome switch and event/reporting consumer must handle `parked` exhaustively.
- The central conductor file overlaps with the concurrently authored deterministic BUILD group and will require ordinary rebase/conflict resolution before implementation.

### Follow-up Actions

- [x] Mark `adr-2026-07-04-operator-park-marker` superseded after this ADR is operator-approved.
- [ ] Add serial, configured-group, SHIP-group, and deterministic-BUILD-group boundary acceptance coverage.
- [ ] Update daemon operator documentation and the emergency-stop runbook to replace the attempt-level known limitation with scheduling-unit semantics.
- [ ] Re-run overlap/conflict checks after the deterministic BUILD group lands or materially changes.
