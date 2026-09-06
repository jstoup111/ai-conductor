# Implementation Plan: Record land-gate rejections on the event spine

**Date:** 2026-09-06
**Stories:** .docs/stories/record-land-gate-rejections-on-the-event-spine.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing event-spine contract — one emitter, one union, one persister, one ledger format — and adds no reader, no artifact, and no gate.

## Summary

Four bounded tasks deliver #1628. Task 1 gives every rejection in the landing primitive a stable gate identifier. Task 2 adds the persisted rejection event and the pure classifier that turns a thrown error into it. Task 3 emits the event from the landing command's failure path onto the target repository's persisted event ledger. Task 4 proves the recording path cannot degrade the operator-facing rejection, and updates the event-catalogue documentation. Historical backfill, precision reporting, rejection recording for other commands, and any change to gate strictness are outside this slice.

## Technical Approach

The landing primitive rejects through eighteen `throw new Error` sites plus one `TargetPathMissingError`, each carrying prose only. Introduce an exported `LandGateError` subclass in `land-spec.ts` carrying a `gate` field typed by an exported closed union of gate identifiers, and a small `landGateError(gate, message)` constructor helper. Convert each rejection site to that helper, keeping the message text byte-identical so operator-facing output and existing message assertions are unchanged. The identifiers follow the site they replace: worktree-missing, worktree-dirty, owner-identity-unresolved, required-artifacts-missing, plan-protected-targets, plan-done-when, plan-stories-reference, stories-not-approved, tier-artifacts-missing, artifact-stem-mismatch, adr-not-approved, adr-uncitable-decision, mermaid-render, mermaid-tool-missing, artifact-empty, artifact-draft-status, and artifact-stub. The coherence gate keeps its own five internal rejections untouched; instead the single `runCoherenceGate` call site is wrapped so any error from it is re-raised as a gate error under the `coherence` identifier with the validator's own message preserved as the reason. The gh-runner placeholder that reports a missing injected runner is not a gate and stays a plain error.

Add one `ConductorEvent` member, `land_gate_rejected`, with `gate`, `reason`, `project`, `worktreePath`, and an optional `sourceRef`. Because `EVENT_SINKS` is a total record over the union's `type`, the new member mechanically forces its sink declaration; declare it persist-only — the landing command has no renderer and the audit trail is a step-lifecycle record, not a command-rejection record. Add an exported pure classifier next to the error class: it maps a `LandGateError` to its own identifier, a missing-target-path error to `target-path-missing`, and anything else to `unclassified`, so an unexpected failure is recorded rather than dropped. The classifier also caps the recorded reason at 1000 characters and appends an explicit truncation marker when it cuts; several landing processes append to one ledger, and `EventPersister` uses a single synchronous append whose atomicity holds only below the platform pipe-buffer size, so a bounded record is a correctness requirement rather than a cosmetic one. The operator-facing message printed to stderr is never truncated.

Emit from the landing command's existing failure branch in `dispatchEngineer`, copying the shape the rewind command already uses for a one-shot emission: construct a `ConductorEventEmitter`, attach an `EventPersister` pointed at the target repository's canonical `.pipeline/events.jsonl`, start it, emit the classified event, stop it. The canonical repository root — not the per-idea worktree — is the ledger location on purpose: the worktree is removed by handoff once the idea finally lands, which would erase exactly the rejection history the period counts are computed from, while the repository root ledger is the same file name, the same schema, and the same reader path the existing consumers already use. Wrap the whole emission so a ledger failure cannot change the branch's behaviour: the original rejection message, the retained-worktree line, and the nonzero exit code are produced first and unconditionally, and a recording failure adds at most one advisory line.

Testing follows the repository test rules. The classifier and the gate identifiers are pure and are tested as unit cases at that seam. The command-level behaviour is tested through `dispatchEngineer` end to end with an injected gh runner and a real local Git repository, the pattern the existing land owner-gate test already establishes; no conductor run, no provider, and no network are involved. Fixture builders and assertion grouping may vary; the boundary proof — the event read back from the persisted ledger file — must not.

## Preconditions and claim ledger

- Operator approved Small scope, the single-event design with a closed gate vocabulary, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `land-spec.ts` contains eighteen `throw new Error` sites and one `TargetPathMissingError` throw, all reached from `landSpec`, none carrying a machine-readable identifier.
- Verified: `runCoherenceGate` in `coherence-validator.ts` throws five internal errors, and `landSpec` calls it exactly once, so one wrap covers them all.
- Verified: `landSpec`'s only production caller is the `land` case of `dispatchEngineer` in `engineer-cli.ts`, whose catch block prints the message plus the retained worktree path and returns 1.
- Verified: `EVENT_SINKS` is declared `Record<ConductorEvent['type'], SinkDeclaration>`, so an added union member is a compile error until its sink row exists, and `persistedEventTypes()` derives the persister subscription from that record.
- Verified: `rewind.ts` constructs a `ConductorEventEmitter` plus an `EventPersister` over a repository-root pipeline ledger for a single one-shot emission, and `emitOrThrow` reports subscriber failures to its caller.
- Verified: `TargetPathMissingError` is exported from `engineer/target.ts` and sets its own `name`, so an instance check is available to the classifier.
- Verified: the existing land owner-gate command test drives `dispatchEngineer` end to end over a temporary registry and a real local Git repository with an injected gh runner, so the same harness supports reading the ledger back.
- Event spine: extend the union; no sidecar, no bespoke format, no new reader; no exception A, B, or C is claimed.
- Scope check: consumer-facing engine behaviour; no new skill; provider-agnostic.
- Verify-claims verdict: CLEAR. Every path, symbol, and count above was read in this worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Give every landing rejection a stable gate identifier
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-gate-rejection.test.ts (new)
**Dependencies:** none

**Steps:**
1. Write failing unit cases that invoke the landing primitive against temporary fixtures shaped to trip a representative set of gates, and assert the raised error carries the expected gate identifier while its message is unchanged.
2. Establish RED, then add the exported gate-identifier union, the `LandGateError` subclass, and the `landGateError(gate, message)` helper to the landing primitive.
3. Convert each rejection site to the helper with the identifier named in the technical approach, leaving every message string byte-identical.
4. Wrap the single coherence gate invocation so any error it raises is re-raised under the coherence identifier with the validator's own message preserved, and leave the validator itself unmodified.
5. Run the focused test file and the typecheck target that includes tests, then commit.

**Done when:**
1. Every rejection raised by the landing primitive is a gate error carrying one identifier from the exported closed union.
2. Coherence validator rejections reach the caller under the coherence identifier with the validator's own message preserved as the reason.
3. Every converted rejection message is byte-identical to the message it replaced, and existing landing tests that assert message text still pass.

### Task 2: Add the persisted rejection event and its classifier
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-gate-rejection.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases for the classifier covering a gate error, a missing-target-path error, an unrecognised error, and a reason longer than the cap.
2. Establish RED, then add the `land_gate_rejected` member to the event union with gate, reason, project, worktree path, and optional source reference fields.
3. Add its sink row as persist-only, with rendering, audit, and telemetry export all off, and confirm the record stays total over the union.
4. Implement the exported classifier that maps a gate error to its identifier, a missing-target-path error to the target-path identifier, and any other error to the unclassified identifier.
5. Cap the recorded reason at 1000 characters, appending an explicit truncation marker when it cuts, and leave the source message untouched for the caller.
6. Run the focused test file and the typecheck target that includes tests, then commit.

**Done when:**
1. The persisted event type is a member of the event union and is subscribed by the persister through the sink record with no other sink enabled.
2. The classifier returns the error's own gate identifier for a gate error, the target-path identifier for a missing-target-path error, and the unclassified identifier for any other error.
3. A reason longer than the cap is returned truncated to the cap with an explicit truncation marker, and the classifier never mutates the error it was given.
4. A serialized record built from a capped reason stays under the single-append atomicity bound asserted in the test.

### Task 3: Emit the rejection event from the landing command
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-land-rejection-events.test.ts (new)
**Dependencies:** 2

**Steps:**
1. Write failing command-level tests that drive the landing command end to end over a temporary registry and a real local Git repository with an injected gh runner, tripping the unapproved-stories gate and the coherence gate.
2. Establish RED, then in the landing command's failure branch classify the caught error and emit the rejection event through a locally constructed emitter with a persister pointed at the target repository's canonical pipeline event ledger.
3. Start the persister, emit, and stop it, keeping the emission after the existing message output so the operator-facing text ordering is unchanged.
4. Add a case that drives a successful landing in the same harness and asserts the ledger gains no rejection event.
5. Run the focused test file and the typecheck target that includes tests, then commit.

**Done when:**
1. A rejected landing appends exactly one rejection event to the target repository's persisted event ledger, carrying the gate identifier, the reason, the project name, and the worktree path.
2. Two rejections tripping different gates produce two ledger records whose gate identifiers differ, so per-gate counts and reasons are derivable from the ledger alone.
3. A successful landing appends no rejection event to that ledger.
4. The source reference is carried on the event when the landing invocation supplied one, and omitted when it did not.

### Task 4: Keep recording from degrading the reported rejection
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-land-rejection-events.test.ts, docs/reference/artifacts.md
**Dependencies:** 3

**Steps:**
1. Write a failing command-level case in which the pipeline ledger location cannot be written, and assert the rejection message, the retained-worktree line, and the exit code are unchanged.
2. Establish RED, then guard the emission so any failure inside it is caught, produces at most one advisory line, and never alters the branch's message output or return value.
3. Add a case proving an unexpected non-gate failure from the landing primitive is still recorded, under the unclassified identifier.
4. Update the event-catalogue section of the reference documentation: add the new event to the persisted list, correct the variant, type, and persisted counts, and state where the landing command writes it and why the repository root rather than the per-idea worktree.
5. Run the focused test file, the typecheck target that includes tests, and the repository validation suite, then commit.

**Done when:**
1. An unwritable ledger leaves the rejection message, the retained-worktree line, and the nonzero exit code byte-identical to a run with a writable ledger.
2. An unclassified landing failure is still recorded as a rejection event under the unclassified identifier.
3. The reference documentation lists the new event among the persisted types, its counts match the sink record, and it states the ledger location and the reason for it.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a land invocation is rejected because its stories artifact is not approved, when the command reports the failure, then the target repository's persisted event ledger gains one land-gate-rejection event whose gate identifier names the stories-approval gate and whose reason carries the rejection message. | 1, 3 | "A rejected landing appends exactly one rejection event to the target repository's persisted event ledger, carrying the gate identifier, the reason, the project name, and the worktree path." | diff-local |
| Story 1 happy: Given a land invocation is rejected by the coherence gate, when the command reports the failure, then the recorded event's gate identifier names the coherence gate and its reason carries the coherence validator's own message. | 1, 3 | "Coherence validator rejections reach the caller under the coherence identifier with the validator's own message preserved as the reason." | diff-local |
| Story 1 happy: Given several land invocations against one repository are rejected by different gates, when the persisted ledger is replayed, then each rejection appears as its own event and the per-gate counts and reasons are derivable from those events alone. | 3 | "Two rejections tripping different gates produce two ledger records whose gate identifiers differ, so per-gate counts and reasons are derivable from the ledger alone." | diff-local |
| Story 1 negative: Given a land invocation that passes every gate and commits, when the command returns success, then no land-gate-rejection event is recorded. | 3 | "A successful landing appends no rejection event to that ledger." | diff-local |
| Story 2 happy: Given a rejection message longer than the recorded-reason cap, when the event is built, then the recorded reason is truncated to the cap and marked as truncated, while the message printed to the operator remains complete. | 2 | "A reason longer than the cap is returned truncated to the cap with an explicit truncation marker, and the classifier never mutates the error it was given." | diff-local |
| Story 2 negative: Given a land failure that no gate identifier classifies, when the event is built, then it is recorded under the unclassified gate identifier rather than dropped. | 2, 4 | "The classifier returns the error's own gate identifier for a gate error, the target-path identifier for a missing-target-path error, and the unclassified identifier for any other error." | diff-local |
| Story 2 negative: Given the persisted event ledger cannot be written, when a land invocation is rejected, then the command still prints the original rejection message and the retained worktree path and still exits nonzero. | 4 | "An unwritable ledger leaves the rejection message, the retained-worktree line, and the nonzero exit code byte-identical to a run with a writable ledger." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 and Task 2 own unit coverage at the gate-identifier and classifier seams, with no command dispatch and no filesystem beyond temporary artifact fixtures. Task 3 owns command-level integration from the landing command through the real landing primitive, the real emitter, and the real persister, with a real local Git repository, a temporary registry, and an injected gh runner as the only third-party boundary. Task 4 owns the failure-isolation and unclassified cases in that same harness plus the documentation update. No test reaches a real language model, a real GitHub API, or the network, and no test starts a conductor run. Existing landing-gate tests remain authoritative for what the gates accept and reject; no aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4
