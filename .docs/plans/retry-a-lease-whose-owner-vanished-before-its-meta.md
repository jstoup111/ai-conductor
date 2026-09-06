# Implementation Plan: Retry a lease whose owner vanished before its metadata read

**Date:** 2026-09-06
**Stories:** .docs/stories/retry-a-lease-whose-owner-vanished-before-its-meta.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing lease contract — no owner is ever stolen without proven death, corrupt or ambiguous ownership never falls back to timeout-and-steal, and the public failure-kind union is unchanged.

## Summary

Four bounded tasks deliver #2172 inside one engine module and its existing unit test file. The lease's recovery path stops treating a missing owner file as a recovery refusal and treats it as a lease that is simply unheld right now, retried on the ordinary bounded wait path. Stale recovery claims, claim-pid liveness, the full-suite lock, wait-budget defaults, and every lease call site are outside this slice.

## Technical Approach

Add one outcome, `owner_absent`, to the private `recoverDeadOwner` result union. In its first `readOwner` catch, use the module's existing `isMissing` helper: an absence returns the new outcome and emits no recovery diagnostic, exactly as the existing claim-write absence branch already does; every other error keeps the current `ownership_changed` diagnostic and the "owner metadata is unavailable" refusal verbatim. Metadata that is present but unparseable still returns the invalid-or-ambiguous refusal, because the absence test happens before parsing and never reaches it. The public `ConductStateLeaseFailureKind` union, the filesystem seam, the owner and claim shapes, the quarantine sequence, and the release handle are all untouched.

In the acquire loop, handle the new outcome on the ordinary retry path rather than the immediate-retry path the existing absence outcome uses. The loop keeps its current order: it records a live owner pid when occupied, checks the elapsed wait budget, retries an already-vanished lease with no delay, and otherwise waits the retry delay before the next attempt. The new outcome falls through to the budget check and then the wait, so it costs one retry delay per attempt.

That placement is the one design choice worth stating. A lease directory can exist with no owner file in two distinct situations: the owner released the directory in the window between the contender's already-held error and its metadata read, which is the ordinary contention this issue reports; and an owner that died between creating the directory and writing its metadata, which leaves a directory that never gains an owner. Reusing the immediate-retry outcome would fix the first and turn the second into a hot loop that re-attempts the creation with no delay for the whole wait budget. Routing through the ordinary delay fixes the first in one retry — the directory is gone, so the next creation succeeds — and bounds the second to the existing budget, ending in the honest timeout failure kind instead of a recovery refusal. The timeout message already omits its live-owner clause when no live owner was ever observed, so no message change is required.

No new telemetry is introduced and no diagnostic variant is added. The retry path is silent for the same reason the existing absence branch is silent: nothing was stolen and nothing is ambiguous, so there is no recovery to report. This is a narrowing of an existing in-process callback's emissions, not a new channel.

Tests extend the existing lease unit test file and its in-memory shared filesystem, which already throws an absence error for a missing owner file and refuses writes whose parent directory is gone. The contention race is expressed by wrapping the fixture's directory-creation seam so the held lease releases on the already-held error, before the recovery read. The bounded cases inject the clock and wait seams the lease already accepts, so no real time passes. No third-party boundary, process, or network is involved; no conductor run is required.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, both stories, and the ordinary-delay placement on 2026-09-06 (delegated).
- Verified: `conduct-state-lease.ts` lines 183-189 catch every first `readOwner` failure, report an `ownership_changed` diagnostic, and return the refusal message "owner metadata is unavailable"; the acquire loop maps that outcome to failure kind `recovery_refused`.
- Verified: the same function already returns its vanished outcome from an absent claim write through the module-level `isMissing` helper, and emits no diagnostic on that branch.
- Verified: the acquire loop records a live owner pid, checks the elapsed budget, retries the vanished outcome without waiting, and otherwise awaits the retry delay; its timeout message appends a live-owner clause only when a live owner pid was recorded.
- Verified: `parseLeaseOwner` runs after the read, so metadata that is present but corrupt still reaches the invalid-or-ambiguous refusal.
- Verified: three production call sites construct the lease — the filesystem conduct-state store, the intake ledger, and build-review dispositions — so ordinary daemon-plus-CLI contention reaches this path.
- Verified: the lease unit test file builds an in-memory filesystem whose owner read throws an absence error for a missing file and whose writes require an existing parent directory, and it already exercises a release during the liveness probe with injected clock and wait seams.
- Verified: no documentation page, harness rule, or configuration reference mentions the lease's recovery-refused failure or its messages, so no documentation update is owed.
- Scope check: consumer-facing engine behavior with no rule, flag, or documentation surface; no new skill; provider-agnostic. Event spine: no channel is added, so the spine is unaffected.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree; no pending assumption changes the approach.

## Tasks

### Task 1: Treat an absent owner file as an unheld lease rather than a refusal
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** none

**Steps:**
1. Add a unit test that acquires the lease with the existing in-memory filesystem, then has a second lease contend through a wrapper whose directory-creation seam releases the held lease before rethrowing the already-held error, so the recovery read finds no owner file.
2. Assert the contender acquires successfully, that its own owner metadata is recorded, that no recovery diagnostic is emitted, and that its release succeeds. Establish RED against the current refusal.
3. Add an `owner_absent` member to the private recovery outcome union, and in the first owner-read catch return it when the module's existing absence helper matches the error, emitting no diagnostic.
4. In the acquire loop, treat that outcome as a retry rather than a refusal, leaving the existing vanished, occupied, and refused branches unchanged.
5. Run the scoped test file and the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A contender whose owner released the lease during the recovery read acquires the lease successfully instead of returning a recovery-refused result.
2. That acquisition emits no recovery diagnostic and records the contender's own owner metadata.
3. The recovery outcome union carries the new absent-owner member and the public lease failure-kind union is unchanged.

### Task 2: Keep refusing unreadable and invalid owner metadata
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 1

**Steps:**
1. Add a unit test whose filesystem wrapper throws a permission error from the owner read while the lease directory still exists, and assert the acquire result keeps failure kind recovery-refused with the unchanged unavailable-metadata message.
2. Assert that attempt reports exactly one refused recovery diagnostic with the ownership-changed reason, and that the stored owner metadata is left untouched.
3. Confirm the existing corrupt and ambiguous metadata cases still refuse with their current message and invalid-metadata diagnostic reason; extend them only if the new branch changed their observable outcome.
4. Run the scoped test file and the typecheck target that covers test files, then commit.

**Done when:**
1. A non-absence owner-read error returns failure kind recovery-refused with the unavailable-owner-metadata message unchanged.
2. That refusal emits exactly one recovery diagnostic whose reason is ownership-changed, and leaves the existing owner metadata in place.
3. The corrupt and ambiguous owner-metadata cases keep their existing failure kind, message, and diagnostic reason.

### Task 3: Retry an absent-owner lease on the bounded wait path
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conduct-state-lease.ts, src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 1

**Steps:**
1. Add a unit test whose filesystem always reports the lease directory as already held and always reports its owner file as absent, with the clock and wait seams injected so the wait seam advances the injected clock and counts its calls.
2. Assert the wait seam is invoked once per attempt and that no attempt retries the creation without waiting, establishing that the absent-owner outcome does not reuse the immediate-retry branch.
3. Add a companion assertion that the existing vanished outcome still retries without waiting, so the two branches stay distinguishable.
4. Run the scoped test file and the typecheck target that covers test files, then commit.

**Done when:**
1. Each absent-owner attempt invokes the injected wait seam exactly once before the next creation attempt.
2. The total injected elapsed time stays within the configured wait budget and the test completes without real waiting.
3. The existing immediate-retry branch for a vanished lease still performs no wait.

### Task 4: End a permanently owner-less lease in a bounded timeout
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/conduct-state-lease.test.ts
**Dependencies:** 3

**Steps:**
1. Extend the always-absent-owner fixture from the previous task so the injected clock reaches the configured wait budget, and assert the acquire result fails with the timeout failure kind.
2. Assert the failure message names the configured budget and contains no live-owner clause, since no live owner was ever observed on this path.
3. Assert no recovery diagnostic is emitted anywhere in that attempt, and that the lease directory and its contents are left untouched.
4. Run the scoped test file and the typecheck target that covers test files, then run the configured aggregate test command before handoff and commit.

**Done when:**
1. A permanently owner-less lease directory ends the acquire attempt with failure kind timeout rather than recovery-refused.
2. The timeout message names the configured wait budget and omits the live-owner clause.
3. The attempt emits no recovery diagnostic and leaves the contended lease directory unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a lease owner removes its lease directory between a contender's already-held error and that contender's owner-metadata read, when the contender acquires the lease, then it acquires the lease normally instead of failing with a recovery-refused result. | 1 | "A contender whose owner released the lease during the recovery read acquires the lease successfully instead of returning a recovery-refused result." | diff-local |
| Story 1 negative: Given the owner-metadata read fails for a reason other than the metadata being absent, when the contender acquires the lease, then it fails with the existing recovery-refused result naming unavailable owner metadata and reports the ownership-changed recovery diagnostic. | 2 | "A non-absence owner-read error returns failure kind recovery-refused with the unavailable-owner-metadata message unchanged." | diff-local |
| Story 1 negative: Given the owner metadata is present but corrupt or ambiguous, when the contender acquires the lease, then it still fails with the existing recovery-refused result naming invalid or ambiguous owner metadata. | 2 | "The corrupt and ambiguous owner-metadata cases keep their existing failure kind, message, and diagnostic reason." | diff-local |
| Story 2 happy: Given a lease directory that exists with no owner metadata, when the contender retries within its wait budget, then each attempt waits the configured retry delay rather than retrying immediately. | 3 | "Each absent-owner attempt invokes the injected wait seam exactly once before the next creation attempt." | diff-local |
| Story 2 negative: Given the owner metadata is still absent when the wait budget is exhausted, when the contender's acquire attempt ends, then it fails with the timeout failure kind and a message that names no live owner. | 4 | "The timeout message names the configured wait budget and omits the live-owner clause." | diff-local |

## Test dispositions and integration ownership

All five criteria are diff-local against the module's existing injected filesystem, clock, and wait seams; nothing here needs a real filesystem, process, network, or conductor run. Task 1 owns the contention-race acquisition. Task 2 owns the preserved refusal surface, including the existing corrupt and ambiguous regressions. Task 3 owns the retry-placement proof, and Task 4 owns the budget-exhaustion terminal outcome, reusing Task 3's fixture rather than building a second one. The existing lease tests for stealing refusal, labelled diagnostics, worktree isolation, and serialized store writes remain authoritative for everything this slice does not change; no new aggregate, smoke, or external-service test is added, and no terminal validation task is required beyond the aggregate run already named in Task 4.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
