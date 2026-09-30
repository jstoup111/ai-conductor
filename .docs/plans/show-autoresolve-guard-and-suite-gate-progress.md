# Implementation Plan: Show autoresolve guard and suite gate progress

**Date:** 2026-09-28
**Stories:** .docs/stories/show-autoresolve-guard-and-suite-gate-progress.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change adds signals on the success path of resolveConflictingPr only and leaves every failure, escalation, and publication contract intact.

## Summary

Three bounded tasks deliver #2762. Task 1 adds one ConductorEvent variant, rebase_resolution_stage, and its sink declaration. Task 2 emits it, together with matching daemon log lines, when the acceptance guards pass and when the suite gate starts and passes inside resolveConflictingPr. Task 3 proves the failure paths are unchanged and the signals are best-effort. Suite progress heartbeats, suite timeouts, terminal rendering, and OTel export are out of scope.

## Technical Approach

Add a variant to the ConductorEvent union in src/conductor/src/types/events.ts, next to the rebase auto-resolution lifecycle variants: type rebase_resolution_stage, stage acceptance-guards or suite-gate, status started or passed, prUrl string, worktreePath string, and optional durationMs number present only on the suite-gate passed event. Declare it in EVENT_SINKS in src/conductor/src/engine/event-sinks.ts as render false, persist true, audit false, otel false, matching rebase_supersession_verdict. Persisting puts it in the feature ledger that the daemon's feature-scoped forwarding emitter already writes; no sink, ledger, or file is added.

In resolveConflictingPr in src/conductor/src/engine/autoresolve.ts add a small local helper that emits one stage event through deps.events inside try/catch; on a rejected emit it logs one line naming the PR and the error and returns normally, so observability can never change the resolution outcome. This follows the existing best-effort pattern the daemon uses around rebase_resolution_attempt. Then:

1. After the acceptance guards return ok, log the PR with acceptance guards passed and the worktree path, and emit stage acceptance-guards, status passed.
2. Immediately before deps.runSuite, log the PR with suite gate started and the worktree path, and emit stage suite-gate, status started.
3. After the suite result is judged ok and before publishResolution, log the PR with suite gate passed and the runner's durationMs, and emit stage suite-gate, status passed, durationMs set from the runner result.

The failure branches (guard failure, suite failure including an unconfigured suite command) are not edited, so their existing log lines, escalate calls, and logOutcome stage names are unchanged. The log lines go through the same injected log function that already writes the tier2 outcome line.

Tests extend src/conductor/test/integration/autoresolve-loop.test.ts, which drives the real resolveConflictingPr over a real local repository and private bare remote with fakes only at the gh runner, suite runner, and resolver. Inject a recording emitter that also snapshots the remote branch tip at each emit, so ordering against the lease push is observed at the real push boundary. The guard-rejection case uses the existing runAcceptanceGuards dependency seam. No real LLM, gh, or network call is reachable.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, and both stories on 2026-09-28 (delegated).
- Verified: resolveConflictingPr in src/conductor/src/engine/autoresolve.ts logs the tier2 outcome, runs the acceptance guards and logs only on failure, calls emitExcusedRebaseCitationResidue, runs deps.runSuite(worktreePath) and logs only on failure, then calls publishResolution.
- Verified: deps.runSuite returns exitCode, durationMs, and configured; deps.events is an optional ConductorEventEmitter; deps.runAcceptanceGuards is an existing injectable seam.
- Verified: src/conductor/src/daemon-cli.ts passes featureScope.events from startFeatureEventPersistence as deps.events.
- Verified: EVENT_SINKS in src/conductor/src/engine/event-sinks.ts uses satisfies Record over every ConductorEvent type, so the new variant must be declared there.
- Verified: src/conductor/test/engine/event-sinks.test.ts pins the exact persisted-type set in PINNED_PERSISTED_EVENT_TYPES, and src/conductor/test/integration/audit-trail-completeness.integration.test.ts requires a classification and a fixture for every ConductorEvent type.
- Verified: src/conductor/test/integration/autoresolve-loop.test.ts already drives resolveConflictingPr with a real repository, a private bare remote, and injected runSuite, resolver, gh, and log.
- Event-spine verdict: extend the union with one variant; exception none; no new channel.
- Scope check: conductor engine code, no instruction-surface change; no skill addition; provider-agnostic.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Declare the rebase_resolution_stage event
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/test/engine/event-sinks.test.ts, src/conductor/test/integration/audit-trail-completeness.integration.test.ts
**Dependencies:** none

**Steps:**
1. Add rebase_resolution_stage to PINNED_PERSISTED_EVENT_TYPES in the event-sinks test and a not-audited-by-design classification plus a fixture in the audit-trail completeness test; establish RED through scoped-run.
2. Add the union variant with the fields in Technical Approach and a doc comment naming its producer.
3. Declare it in EVENT_SINKS as render false, persist true, audit false, otel false.
4. Run the two focused test files and the typecheck that covers tests, then commit.

**Done when:**
1. The ConductorEvent union contains rebase_resolution_stage with stage, status, prUrl, worktreePath, and optional durationMs, and the typecheck covering test files passes.
2. EVENT_SINKS declares rebase_resolution_stage as render false, persist true, audit false, otel false, and the pinned persisted-type test passes with it included.
3. The audit-trail completeness test classifies rebase_resolution_stage as not-audited-by-design and passes with its fixture.

### Task 2: Emit guard-pass and suite start and pass signals
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/autoresolve.ts, src/conductor/test/integration/autoresolve-loop.test.ts
**Dependencies:** 1

**Steps:**
1. In the autoresolve-loop integration test, add a passing-resolution case with a recording emitter that stores each event with the remote branch tip read at emit time, and a runSuite fake that records the events present when invoked and returns a fixed durationMs. Establish RED.
2. Add the best-effort emit helper and the three log-and-emit points described in Technical Approach inside resolveConflictingPr.
3. Run the focused integration file through scoped-run and commit.

**Done when:**
1. The passing-resolution integration test observes, in order, rebase_resolution_stage events acceptance-guards passed, suite-gate started, and suite-gate passed, each carrying the PR URL and the resolution worktree path that runSuite received.
2. The same test observes that the acceptance-guards passed event and the suite-gate started event are already recorded when the suite runner is invoked.
3. The same test observes the suite-gate passed event with durationMs equal to the runner's returned duration, recorded while the remote branch still holds its pre-resolution tip, and the outcome refreshed with the remote tip then advanced.
4. The same test observes daemon log lines for acceptance guards passed and suite gate started naming the PR and the worktree path, and suite gate passed naming the PR and the duration in milliseconds.

### Task 3: Keep failure paths unchanged and the signals best-effort
**Story:** Story 1 (negative path)
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/autoresolve.ts, src/conductor/test/integration/autoresolve-loop.test.ts
**Dependencies:** 2

**Steps:**
1. Add integration cases: an emitter whose emit rejects; no emitter; a red suite with a recording emitter; and a guard rejection through the runAcceptanceGuards seam with a recording emitter and a counting runSuite. Establish RED where the Task 2 helper does not already hold.
2. Adjust only the helper in resolveConflictingPr if a case fails; do not edit the guard or suite failure branches.
3. Run the focused integration file through scoped-run and commit.

**Done when:**
1. With a rejecting emitter and with no emitter, the integration tests end refreshed, the remote branch tip advances, and all three stage log lines are present.
2. The red-suite test observes the existing suite gate failed line and the stage=suite-gate result=escalated outcome line, no suite gate passed line, no suite-gate passed event, zero push attempts, an unchanged remote branch tip, and outcome escalated.
3. The guard-rejection test observes the existing acceptance guard failed line and the stage=acceptance-guards result=escalated outcome line, zero suite runner calls, no acceptance-guards passed or suite-gate started line or event, and outcome escalated.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an autoresolve attempt whose rebased branch passes the acceptance guards, when resolveConflictingPr continues past the guards, then the daemon log records that the acceptance guards passed for that PR and a rebase_resolution_stage event with stage acceptance-guards, status passed, the PR URL, and the resolution worktree path is emitted before the suite gate starts. | 1, 2 | "The passing-resolution integration test observes, in order, rebase_resolution_stage events acceptance-guards passed, suite-gate started, and suite-gate passed, each carrying the PR URL and the resolution worktree path that runSuite received." | diff-local |
| Story 1 happy: Given an autoresolve attempt that reaches the suite gate, when the suite gate starts, then the daemon log records the suite-gate start naming the PR and the resolution worktree, and a rebase_resolution_stage event with stage suite-gate, status started, the PR URL, and the worktree path is emitted before the suite runner is invoked. | 2 | "The same test observes that the acceptance-guards passed event and the suite-gate started event are already recorded when the suite runner is invoked." | diff-local |
| Story 1 happy: Given the suite runner reports exit code 0, when the suite gate settles, then the daemon log records the suite-gate pass for that PR with the runner's duration in milliseconds, and a rebase_resolution_stage event with stage suite-gate, status passed, the PR URL, the worktree path, and durationMs equal to the runner's reported duration is emitted before the lease push updates the remote branch. | 2 | "The same test observes the suite-gate passed event with durationMs equal to the runner's returned duration, recorded while the remote branch still holds its pre-resolution tip, and the outcome refreshed with the remote tip then advanced." | diff-local |
| Story 1 negative: Given the injected event emitter rejects every emit, when the attempt passes both stages, then all three stage log lines are still written, the resolution is still pushed, and the outcome is refreshed. | 3 | "With a rejecting emitter and with no emitter, the integration tests end refreshed, the remote branch tip advances, and all three stage log lines are present." | diff-local |
| Story 1 negative: Given no event emitter is injected, when the attempt passes both stages, then all three stage log lines are still written and the outcome is refreshed. | 3 | "With a rejecting emitter and with no emitter, the integration tests end refreshed, the remote branch tip advances, and all three stage log lines are present." | diff-local |
| Story 2 happy: Given the suite runner reports a nonzero exit code, when the suite gate settles, then the existing suite gate failed log line and the suite-gate escalation outcome line are written as today, no suite-gate passed log line or event is recorded, no push is attempted, and the outcome is escalated. | 3 | "The red-suite test observes the existing suite gate failed line and the stage=suite-gate result=escalated outcome line, no suite gate passed line, no suite-gate passed event, zero push attempts, an unchanged remote branch tip, and outcome escalated." | diff-local |
| Story 2 negative: Given the acceptance guards reject the rebased branch, when the guard stage settles, then the existing acceptance guard failed log line and the acceptance-guards escalation outcome line are written as today, no acceptance-guards passed or suite-gate started log line or event is recorded, the suite runner is never invoked, and the outcome is escalated. | 3 | "The guard-rejection test observes the existing acceptance guard failed line and the stage=acceptance-guards result=escalated outcome line, zero suite runner calls, no acceptance-guards passed or suite-gate started line or event, and outcome escalated." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the type and sink-registry contract through the existing exhaustive registry tests. Task 2 owns the production boundary integration: the real resolveConflictingPr over a real local repository and private bare remote, observed at the injected emitter, the injected log, the suite runner, and the bare remote's branch tip. Task 3 owns the alternate branches in the same integration file. The daemon-side wiring that passes featureScope.events is unchanged and already exercised by existing daemon tests. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No ADR is required: the event-spine verdict extends the existing union with no new channel.
