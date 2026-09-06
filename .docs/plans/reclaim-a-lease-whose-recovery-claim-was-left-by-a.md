# Implementation Plan: Reclaim a lease whose recovery claim was left by a dead process

**Date:** 2026-09-06
**Stories:** .docs/stories/reclaim-a-lease-whose-recovery-claim-was-left-by-a.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing lease contract — nothing is taken from an owner or a recoverer without an injected liveness probe proving it dead, corrupt or ambiguous records still refuse rather than fall back to timeout-and-steal, exclusion stays decided by atomic filesystem operations, and the public failure-kind union is unchanged.

## Summary

Four bounded tasks deliver #2170 inside one engine module and its existing unit test file. The conduct-state lease stops treating any existing recovery claim as proof that recovery is in progress: it reads the claim, proves its writer dead through the same injected liveness probe it already uses for the owner, and reclaims the lease when it is. The acquire timeout stops reporting a proven-dead owner as live and names the state that actually blocks the caller. The full-suite lock carrying the same defect pattern, the owner-metadata read path, claim expiry by age, and wait-budget defaults are outside this slice.

## Technical Approach

Add a recovery-claim validator and parser beside the module's existing owner pair, matching the record the claim writer already emits: version 1, a positive integer pid, a non-empty token, and a parsable claimed-at timestamp. Anything else is invalid, exactly as the owner validator treats a malformed owner record.

Replace the already-held branch of the exclusive claim write. Instead of returning to the acquire loop immediately, it reads the existing claim through the module's existing claim-read seam and dispatches on four cases. A read that reports no claim means the claim vanished between the losing write and the read, so the attempt retries with no blocker recorded. A read that fails for any other reason, and a claim that does not parse, both refuse without touching anything, under a claim-specific diagnostic reason. A claim whose liveness probe throws refuses under its own reason, because unverifiable liveness must never license a steal. A claim whose pid the probe reports live returns to the loop as occupied, recording that claim's pid as the blocker.

A claim whose pid is proven dead is adopted rather than deleted: the recoverer keeps the stale serialized claim as its recovery authority and continues into the module's existing confirm-then-quarantine sequence unchanged. This is the one design choice worth stating. The obvious alternative — unlink the stale claim, then retry and write a fresh exclusive claim — reintroduces the very race it is meant to close, because two recoverers can both observe the same dead claim and the slower one's unlink would delete a live claim the faster one had already written. Adoption never unlinks: two recoverers that adopt the same dead claim both reach the atomic directory move, which admits exactly one; the loser's move finds no source directory. That loser is handled by the second production change, which maps an absent quarantine source to the module's existing retry outcome instead of a refusal — the lease is simply gone, so the ordinary creation retry is correct and the wait budget still bounds it.

The acquire loop's remembered live-owner pid becomes a blocker descriptor carrying a kind and a pid. The live-owner clause of the timeout message keeps its current wording verbatim; a live recovery claim produces a parallel clause naming the recovery claim's pid; an attempt that observed neither keeps the bare budget message. The proven-dead owner is never recorded as a blocker again, which is the false "owner pid N is live" the issue reports.

Observability changes only within the module's existing in-process recovery-diagnostic callback: two refusal reasons are added for the claim-specific refusals, and the recovered diagnostic gains an optional reclaimed-claim pid emitted only when a stale claim was adopted, spread conditionally the way the existing store label already is so current diagnostic assertions stay exact. No event, ledger, file, or channel is added; only the lease's own unit tests subscribe to that callback, so no production consumer changes. Pid recycling remains the module's pre-existing accepted risk and is not addressed here.

Tests extend the existing lease unit test file and its in-memory shared filesystem, which already stages a lease directory, an owner record, and files directly through its seams for the corrupt-owner cases, and whose directory move throws an absence error when its source is gone. The concurrency case injects the clock, wait, and liveness seams the lease already accepts, so no real time passes and no process, network, or third-party boundary is involved.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, both stories, and adoption over unlinking on 2026-09-06 (delegated).
- Verified: the branch handling an already-existing recovery claim returns occupied to the acquire loop carrying the owner's pid, and nothing in the module reads, parses, or liveness-checks an existing claim.
- Verified: that occupied outcome is only reachable after the owner's pid was already proven dead by the injected probe, so the pid it reports as the live blocker is the pid it just proved dead.
- Verified: the acquire loop remembers one live-owner pid and appends a live-owner clause to its timeout message only when that pid was recorded.
- Verified: the claim writer emits a record of version 1, the writing pid, a recovery-suffixed token, and a claimed-at timestamp, so a claim validator can mirror the existing owner validator field for field.
- Verified: the module already exports the injected liveness seam, an absence helper used by the claim-write branch, a claim-read seam that reports an absent claim as no claim, and an atomic quarantine move to a per-process destination followed by a confirm-and-delete.
- Verified: the quarantine move's failure branch currently refuses for every error, including an absent source directory.
- Verified: the release handle refuses to release while a recovery claim exists, so nothing in this slice changes the release contract.
- Verified: three production sites construct the lease — the filesystem conduct-state store, the intake ledger, and build-review dispositions — and none subscribes to the recovery-diagnostic callback or injects a custom filesystem, so the diagnostic union can gain members without touching a consumer.
- Verified: the lease unit test file stages a lease directory, owner record, and file contents directly through the in-memory filesystem seams, asserts exact diagnostic objects, and already exercises injected clock and wait seams.
- Verified: no documentation page, harness rule, skill, or configuration reference mentions the lease's messages, failure kinds, or recovery diagnostics, so no documentation update is owed.
- Verified: the sibling spec for #2172 edits the same function's first owner-metadata read catch and adds an absent-owner outcome there; it touches neither the claim branch nor the quarantine branch, so the two changes overlap only in the shared outcome union and the shared test file.
- Scope check: consumer-facing engine behavior with no rule, flag, or documentation surface; no new skill; provider-agnostic. Event spine: no channel is added and no schema moves; the change narrows and enriches an existing in-process callback, so the spine is unaffected.
- Verify-claims verdict: CLEAR. Every path, symbol, and branch above was read in the worktree; no pending assumption changes the approach.

## Tasks

### Task 1: Reclaim a recovery claim whose writer is proven dead
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** none

**Steps:**
1. Add a unit test that stages a lease directory through the in-memory filesystem seams with a valid owner record for one pid and a valid recovery claim for a second pid, then acquires the lease with a third pid and a liveness probe that reports both staged pids dead.
2. Assert the acquisition succeeds, that the stored owner record is the acquiring pid's, and that exactly one recovered diagnostic is emitted naming the dead owner pid and the reclaimed claim pid. Establish RED against the current occupied-then-timeout behavior.
3. Add a recovery-claim validator and parser mirroring the existing owner pair, requiring version 1, a positive integer pid, a non-empty token, and a parsable claimed-at timestamp.
4. In the already-held branch of the exclusive claim write, read the existing claim, and when it parses and its pid is proven dead, adopt the stale serialized claim as the recovery authority and fall through to the existing confirm-then-quarantine sequence.
5. Add the optional reclaimed-claim pid to the recovered diagnostic, spread conditionally so attempts that reclaimed nothing emit the current object unchanged.
6. Run the scoped test file and the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A lease staged with a dead owner and a dead claimant's claim is acquired successfully instead of timing out as occupied.
2. The reclaiming acquisition stores the acquiring process's own owner record over the quarantined lease.
3. That acquisition emits exactly one recovered diagnostic carrying both the dead owner pid and the reclaimed claim pid.
4. An acquisition that reclaimed no stale claim emits its recovered diagnostic without the reclaimed-claim field.

### Task 2: Refuse an invalid or unverifiable recovery claim instead of stealing
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 1

**Steps:**
1. Add unit tests that stage a dead owner with an unparsable claim and with a structurally invalid claim, and assert each acquire attempt fails with the recovery-refused failure kind and a message naming an invalid or ambiguous recovery claim.
2. Add a unit test whose liveness probe throws for the staged claim's pid but not the owner's, and assert the attempt fails with the recovery-refused failure kind and a message naming unverifiable recovery-claim liveness.
3. Assert each refusal emits exactly one refused diagnostic under its own claim-specific reason, and that the staged owner and claim contents are unchanged afterward.
4. Add the two claim-specific reasons to the diagnostic union and implement the three refusals, including a refusal for a claim read that fails for a reason other than the claim being absent.
5. Confirm the existing corrupt and ambiguous owner-metadata cases keep their current failure kind, message, and reason; extend them only if this branch changed their observable outcome.
6. Run the scoped test file and the typecheck target that covers test files, then commit.

**Done when:**
1. An unparsable or structurally invalid recovery claim returns the recovery-refused failure kind with a message naming an invalid or ambiguous recovery claim.
2. A recovery-claim liveness probe that throws returns the recovery-refused failure kind with a message naming unverifiable recovery-claim liveness.
3. Each of those refusals emits exactly one refused diagnostic under its own claim-specific reason and leaves the staged owner and claim contents unchanged.
4. The existing corrupt and ambiguous owner-metadata refusals keep their current failure kind, message, and diagnostic reason.

### Task 3: Name the actual blocking state in the acquire timeout
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 1

**Steps:**
1. Add a unit test that stages a dead owner and a recovery claim whose pid the injected probe reports live, with injected clock and wait seams that exhaust the configured budget, and assert the timeout message names that live recovery claim pid.
2. Assert the same attempt never names the dead owner as live and emits no recovery diagnostic.
3. Replace the loop's remembered live-owner pid with a blocker descriptor carrying a kind and a pid, set it only from a live owner or a live recovery claim, and render the existing live-owner clause verbatim alongside a parallel live-recovery-claim clause.
4. Confirm the existing live-owner timeout test passes unchanged, proving the current message wording is preserved.
5. Run the scoped test file and the typecheck target that covers test files, then commit.

**Done when:**
1. A lease blocked by a live recovery claim times out with a message naming that recovery claim's pid.
2. That timeout message never describes the proven-dead owner as live, and the attempt emits no recovery diagnostic.
3. The existing live-owner timeout message is byte-identical to its current wording and its test passes unamended.

### Task 4: Keep two recoverers of one stale claim mutually exclusive
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 1

**Steps:**
1. Add a unit test that stages one lease with a dead owner and a dead claimant's claim, then runs two acquirers with distinct pids concurrently against the same in-memory filesystem with injected clock and wait seams.
2. Assert exactly one acquirer succeeds, that neither returns the recovery-refused failure kind, and that the loser either acquires after the winner releases or ends in a bounded timeout.
3. Map an absent source directory in the quarantine move to the module's existing retry outcome, leaving every other quarantine failure refusing as it does today.
4. Add a unit test whose staged claim is removed by the claim-read seam before it returns, and assert the attempt ends in a bounded timeout whose message carries no blocking-pid clause.
5. Run the scoped test file and the typecheck target that covers test files, then run the configured aggregate test command before handoff and commit.

**Done when:**
1. Two concurrent acquirers over one proven-dead claim produce exactly one successful acquisition and no recovery-refused result.
2. The losing acquirer retries on the ordinary bounded path and leaves exactly one lease directory behind.
3. A quarantine move that fails for any reason other than an absent source directory still returns the recovery-refused failure kind.
4. An attempt whose recovery claim vanished before the inspecting read times out with a message carrying no blocking-pid clause.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a lease directory whose owner pid and whose existing recovery claim pid are both proven dead, when a new acquirer attempts the lease, then it quarantines the lease, acquires it, and records its own owner metadata. | 1 | "A lease staged with a dead owner and a dead claimant's claim is acquired successfully instead of timing out as occupied." | diff-local |
| Story 1 happy: Given a stale recovery claim was reclaimed, when the acquirer reports its recovery diagnostic, then the recovered diagnostic names both the dead owner pid and the reclaimed claim pid. | 1 | "That acquisition emits exactly one recovered diagnostic carrying both the dead owner pid and the reclaimed claim pid." | diff-local |
| Story 1 negative: Given the existing recovery claim is present but corrupt or ambiguous, when a new acquirer attempts the lease, then it fails with a recovery-refused result naming an invalid or ambiguous recovery claim and leaves the stored owner metadata and claim unchanged. | 2 | "An unparsable or structurally invalid recovery claim returns the recovery-refused failure kind with a message naming an invalid or ambiguous recovery claim." | diff-local |
| Story 1 negative: Given the liveness probe for the existing recovery claim's pid throws, when a new acquirer attempts the lease, then it fails with a recovery-refused result naming unverifiable recovery-claim liveness and leaves the stored owner metadata and claim unchanged. | 2 | "A recovery-claim liveness probe that throws returns the recovery-refused failure kind with a message naming unverifiable recovery-claim liveness." | diff-local |
| Story 2 happy: Given a lease whose existing recovery claim names a pid the liveness probe reports live, when the acquirer's wait budget expires, then the timeout message names that live recovery claim pid rather than the dead owner's pid. | 3 | "A lease blocked by a live recovery claim times out with a message naming that recovery claim's pid." | diff-local |
| Story 2 happy: Given a lease held by a live owner with no recovery claim present, when the acquirer's wait budget expires, then the timeout message names the live owner pid exactly as it does today. | 3 | "The existing live-owner timeout message is byte-identical to its current wording and its test passes unamended." | diff-local |
| Story 2 negative: Given two acquirers both observe the same proven-dead recovery claim and both attempt to quarantine the lease, when the directory move is arbitrated, then exactly one acquirer recovers the lease and the other retries within its wait budget instead of failing with a recovery-refused result. | 4 | "Two concurrent acquirers over one proven-dead claim produce exactly one successful acquisition and no recovery-refused result." | diff-local |
| Story 2 negative: Given the existing recovery claim disappears between a losing claim write and the inspecting read, when the acquirer's wait budget expires, then the timeout message names no blocking pid at all. | 4 | "An attempt whose recovery claim vanished before the inspecting read times out with a message carrying no blocking-pid clause." | diff-local |

## Test dispositions and integration ownership

All eight criteria are diff-local unit coverage against the module's existing injected filesystem, clock, wait, and liveness seams; none needs a real filesystem, process, network, LLM, or conductor run. Task 1 owns the reclaiming acquisition and the enriched recovered diagnostic. Task 2 owns the preserved refusal surface, including the existing owner-metadata regressions it must not disturb. Task 3 owns both timeout-message criteria, reusing the existing live-owner timeout test as the unchanged-wording proof rather than adding a second fixture. Task 4 owns the concurrency and vanished-claim cases and the quarantine retry mapping they depend on. The existing lease tests for refusing a live owner, for labelled diagnostics, for worktree isolation, and for serialized store writes remain authoritative for everything this slice does not change; no new smoke, acceptance, or external-service test is added, and no terminal validation task is required beyond the aggregate run already named in Task 4.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4
