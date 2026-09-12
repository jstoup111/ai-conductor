# Implementation Plan: Recover stale conduct-state lease recovery claims

**Date:** 2026-09-11
**Stories:** .docs/stories/recover-stale-conduct-state-lease-recovery-claims.md
**Design:** .docs/decisions/adr-2026-09-11-immutable-state-lease-recovery-succession.md
**Conflict check:** PASS, .docs/conflicts/2026-09-11-recover-stale-conduct-state-lease-recovery-claims.md
**Approval:** Operator approved the plan, updated diagram, and coherence review in composer on 2026-09-11. BUILD remains gated on the operator-merged spec PR.

## Summary

Ten scoped TDD tasks repair shared lease recovery through immutable owner-bound successor claims. All five accepted stories and six ADR decisions are mapped below. Tasks cover functional behavior only.

## Technical Approach

Keep `createConductStateLease` as the one shared lease factory. Extend its claim parsing and recovery state machine, retaining exclusive directory creation, exclusive claim-file creation, token ownership, quarantine-before-cleanup, and the injected filesystem/liveness/clock seams. Claims are immutable: an eligible dead predecessor has one deterministic successor slot, created exclusively; the winner stays authoritative while live. Retain `recovery.json` as the legacy-compatible canonical root. Bound new records to the lease-owner token and predecessor identity, and use an owner-bound fallback root when a retained canonical record explicitly belongs to another owner.

Slot names use the hex SHA-256 digest of JSON serialization of `[ownerToken, predecessorToken]`; prefix them as recovery records under the same lease directory. The records retain complete identities for validation, so path computation never substitutes for semantic checks. New bound records retain version 1, positive pid, nonempty unique token, and valid claimedAt, adding ownerToken and predecessorToken; legacy records omit both binding fields. A root has null predecessorToken. Keep metadata immutable after exclusive creation. A fresh claim token comes from the existing token factory; test fixtures that require distinct attempts must supply distinct tokens.

Use a visited-identity set and a single original deadline to bound traversal. Refuse malformed, unsupported, inconsistent, cyclic, unreadable, or unverifiable authority; retry proven pre-mutation disappearance and owner-generation changes. No delete-in-place recovery, second reusable recovery mutex, age-based stealing, external service, or new event channel is introduced.

The local pattern basis is `createConductStateLease` and the test file's `sharedLeaseFilesystem`: preserve parent-directory absence, EEXIST exclusivity, renamed descendant paths, injected process liveness, fake time, deterministic promise barriers, and awaited cleanup. These semantics model the production boundary; class/helper names may vary inside the same module, but replacing exclusive creation with a read-then-write or a fake that ignores missing parents is not equivalent. Existing `createFilesystemConductStateStore.apply` is the integration entry point; Task 2 alone owns the store-boundary proof for changed lease behavior. Other tasks prove narrower acquisition/release branches without duplicating the store flow.

## Prerequisites and scope

Operator accepted approach A, technical track, comprehensive shared-lease edge cases, Medium review depth, the ADR, and five stories. The clean conflict report is available. Full-suite lock changes, intake workflow requeue policy, remote process liveness, and replacement locking technologies are excluded.

Existing source was inspected: `createFilesystemConductStateStore` accepts a lease parameter and its `whileHoldingLease` calls acquire before mutation and release afterward. No new wiring API is assumed. The production filesystem supports the existing injected claim-read/write methods; no atomic compare-and-delete primitive is assumed. Use this repository's scoped-run interface for scoped RED/GREEN; the configured aggregate gate remains responsible for completed-feature verification. Individual tasks are intended as small focused TDD increments, roughly 2–5 minutes each, not a promise of total elapsed build time.

## Tasks

### Task 1: Parse recovery identities at the acquisition boundary
**Story:** Story 2 (criteria: Story 2, S2.3)
**Type:** negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** none

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Add acquire-boundary fixtures for truncated JSON, unsupported versions, invalid pid/token/time, missing half of the new owner/predecessor binding pair, and inconsistent root binding. Implement a tagged legacy/bound/invalid parser invoked on recovery-claim EEXIST; preserve the public filesystem and liveness seams. New bound records retain version/pid/token/claimedAt and add ownerToken plus predecessorToken (null for a root); validate exact owner/predecessor context when traversing later. Derive filesystem-safe deterministic slot names with SHA-256 of the JSON tuple [ownerToken, predecessorToken], retaining the full identities in the record for validation.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: parse recovery identities at the acquisition boundary`. Await every started contender before fixture cleanup.

**Done when:**
- The EEXIST path in createConductStateLease.acquire parses encountered claims and returns recovery_refused for truncated JSON, unsupported version, invalid pid/token/time, or incomplete owner/predecessor binding, without granting ownership or removing the lease.
- Recovery slot derivation uses the owner/predecessor tuple rather than a reusable shared successor filename, and validation compares the stored full identities to the expected context.

### Task 2: Wire immutable recovery through acquisition and the state-store boundary
**Story:** Story 1 (criteria: S1.1, S1.2, S2.1, S2.2, S5.1–S5.3)
**Story:** Story 2 (criteria: S1.1, S1.2, S2.1, S2.2, S5.1–S5.3)
**Story:** Story 5 (criteria: S1.1, S1.2, S2.1, S2.2, S5.1–S5.3)
**Type:** happy-path, negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 1

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Extend acquire to arbitrate the canonical recovery.json root with writeRecoveryClaim exclusive creation. On a valid dead root, traverse/elect owner-bound successors without unlinking or replacing existing claims; a live contender is occupied. A successful terminal writer revalidates authority and uses the existing quarantine path. Bind new root records to the observed owner while retaining legacy compatibility. This task owns the one store-boundary integration proof: exercise createFilesystemConductStateStore.apply with a real lease, a fixture-owned state file, injected liveness, and persistence observation. Cover recovered mutation, live/invalid refusal, and two disjoint mutations. Use the existing createFilesystemConductStateStore parameter for lease injection; do not add another store or force a production caller edit merely for a test. Use the default production filesystem with a temporary directory for a legacy dead-root acquire/release test; replace process liveness, not filesystem semantics.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: wire immutable recovery through acquisition and the state-store boundary`. Await every started contender before fixture cleanup.

**Done when:**
- createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires.
- createFilesystemConductStateStore.apply reaches the repaired lease, persists the requested field while preserving unrelated fields after dead-claim recovery, and releases ownership for a subsequent mutation.
- Through createFilesystemConductStateStore.apply, live recovery claimants and invalid claim metadata return a lease failure with zero persistence writes.
- Two disjoint createFilesystemConductStateStore.apply mutations after interrupted recovery preserve both committed values and observe maximum protected persistence concurrency of one.
- A fixture-owned real filesystem test with injected dead-process probes acquires and releases a legacy stale recovery claim through the production filesystem adapter.

### Task 3: Keep competing recoverers serialized
**Story:** Story 1 (criteria: S1.3, S1.4, S3.1, S3.4)
**Story:** Story 3 (criteria: S1.3, S1.4, S3.1, S3.4)
**Type:** happy-path, negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 2

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Use the sharedLeaseFilesystem fixture with deterministic barriers around claim writes and before quarantine. Implement the loser path so EEXIST follows the winning record, refuses to supersede a live terminal claimant, and resumes only after release or proved death. Preserve the early live-owner check before touching claim state. Reuse the existing bounded wait seam; deadline refinements belong to Task 7. Do not duplicate Task 2 store integration: this task exercises the exported acquire/release boundary.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: keep competing recoverers serialized`. Await every started contender before fixture cleanup.

**Done when:**
- Concurrent createConductStateLease.acquire calls over one dead predecessor produce at most one active handle; after release a waiting contender can acquire within its remaining budget.
- A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine.

### Task 4: Reject stale authority after owner replacement
**Story:** Story 3 (criteria: S3.3, S3.5)
**Type:** negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 3

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Pause an old contender before its claim write; let the old generation complete and a new owner acquire; then resume it. Implement owner-token checks on every traversed record and authority confirmation before moving a directory. If the canonical root explicitly belongs to a different owner, retain it and arbitrate the deterministic current-owner root slot; never clear it in place. An owner change or lost claim authority abandons the old attempt and retries under the same deadline. Preserve the existing quarantine identity confirmation. Follow the approved immutable-claim pattern: losing observers never unlink any current-path claim.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: reject stale authority after owner replacement`. Await every started contender before fixture cleanup.

**Done when:**
- createConductStateLease.acquire revalidates owner and terminal-claim identities before quarantine; a changed owner or lost authority causes a bounded retry without moving or releasing the replacement generation.
- A delayed old-generation claimant cannot authorize recovery of a new owner; its valid foreign-generation record is retained without overwriting a current claim, and current-owner recovery uses only the deterministic owner-bound authority path.

### Task 5: Release only the handle owner generation
**Story:** Story 1 (criteria: S1.1, S1.2, S3.2, S3.3, S3.6)
**Story:** Story 3 (criteria: S1.1, S1.2, S3.2, S3.3, S3.6)
**Type:** happy-path, negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 4

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Update handle.release to use the same validated generation-aware claim lookup as acquisition. Keep exact owner metadata verification. Treat an unbound legacy recovery claim conservatively, honor current-owner recovery authority, and ignore only a valid record explicitly bound to a different owner. Add release fixtures for foreign-generation leftovers and legacy/current authority, plus the delayed claimant fixture from Task 4 completing the replacement owner release. Reuse readRecoveryClaim and existing directory cleanup; do not introduce a second cleanup channel.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: release only the handle owner generation`. Await every started contender before fixture cleanup.

**Done when:**
- handle.release verifies its exact owner and succeeds in the presence of a valid explicitly foreign-generation record, allowing a subsequent acquisition, including after a delayed old contender writes that record.
- handle.release refuses an applicable current-generation or unbound legacy recovery claim and refuses changed owner metadata without deleting the lease directory.

### Task 6: Refuse unverifiable and inconsistent recovery chains
**Story:** Story 2 (criteria: S2.3–S2.5)
**Type:** negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 2

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Exercise acquisition through valid roots followed by malformed, truncated, unsupported, owner-mismatched, predecessor-mismatched, and repeated-identity successors. Add a visited-identity guard; never infer safe recovery from age. Ensure processIsLive false is the only recovery permission, true preserves ownership, and probe exceptions return an explicit recovery refusal. Keep compatibility with the existing injected boolean probe. If the production probe cannot distinguish live from permission-denied/unknown, describe the blocker conservatively rather than invent a live observation.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: refuse unverifiable and inconsistent recovery chains`. Await every started contender before fixture cleanup.

**Done when:**
- The acquire traversal returns recovery_refused for malformed/truncated/unsupported records, owner or predecessor mismatch, and repeated recovery identity at either root or successor, with no successful handle or protected-state write.
- A claimant not proved dead retains ownership; probe exceptions produce a labelled unverifiable-liveness refusal, and neither record age nor timeout authorizes stealing.

### Task 7: Keep every traversal and race within one acquisition deadline
**Story:** Story 4 (criteria: S4.1, S4.4, S4.5)
**Type:** happy-path, negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 3, 4, 6

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Carry the acquire start/deadline through root selection, successor traversal, recovery retries, and owner-generation changes; check it before another traversal/retry step. Use the injected now/wait seam and deterministic time advances. Preserve initializing-owner behavior: absent owner metadata waits rather than spinning, and non-absence owner errors still refuse. Missing claim/directory during a race retries without mutation when authority was not used. Waiting interruption returns interrupted. Do not add cancellation of individual filesystem calls or reset the deadline after progress.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: keep every traversal and race within one acquisition deadline`. Await every started contender before fixture cleanup.

**Done when:**
- createConductStateLease.acquire uses one original deadline across successor traversal, EEXIST contention, disappearing paths, and generation changes; budget exhaustion returns timeout rather than restarting traversal indefinitely.
- An unheld vanished path can be reacquired within the remaining budget; an initializing owner still waits through the configured wait seam, and an interrupted wait returns interrupted with no handle.

### Task 8: Report the current acquisition blocker accurately
**Story:** Story 4 (criteria: S4.2, S4.3)
**Type:** happy-path, negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 6, 7

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Replace lastLiveOwnerPid as the sole timeout authority with a current-iteration blocker description. Distinguish owner contention, claimant contention, unknown liveness, initializing/vanished state, and changed-generation retries. Clear obsolete blocker data when the observed state changes. Preserve the configured store label and existing public failure kinds; keep ordinary live-owner wording where supported by evidence. Use deterministic transitions from observed owner to dead-owner/live-claimant and to no-current-owner to prove no stale pid leaks into the message.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: report the current acquisition blocker accurately`. Await every started contender before fixture cleanup.

**Done when:**
- Acquisition timeout reports the last observed owner, recovery claimant, or unresolved recovery state with the configured store label; it does not reuse a previous iteration blocker after a generation or observation change.
- A timeout behind a live recovery claimant identifies recovery contention and never describes the already-proved-dead owner as live; unverifiable liveness is not rendered as verified live.

### Task 9: Preserve ownership on claim filesystem failures
**Story:** Story 2 (criteria: S2.6)
**Type:** negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 6, 8

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Inject claim reads failing with EACCES and claim creation failing with EACCES or ENOSPC. Preserve ENOENT race handling from Task 7 and EEXIST election behavior from Tasks 2–3 as distinct outcomes. Implement named recovery failure returns without removing any canonical, successor, or replacement ownership state. Use the faithful injected filesystem, and assert no persistence through the Task 2 integration seam rather than launching a daemon.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: preserve ownership on claim filesystem failures`. Await every started contender before fixture cleanup.

**Done when:**
- Recovery claim read/creation EACCES or ENOSPC returns a labelled acquisition failure naming the failed recovery operation, with no handle, protected-state mutation, or replacement-lease cleanup.
- The claim operation error classifier keeps EEXIST as contention and ENOENT as a retryable pre-mutation race rather than reporting either as a permission/storage failure.

### Task 10: Validate quarantine identity before scoped cleanup
**Story:** Story 4 (criteria: S4.6)
**Type:** negative-path
**Files:** `src/conductor/src/engine/conduct-state-lease.ts`, `src/conductor/test/engine/conduct-state-lease.test.ts`
**Dependencies:** 4, 5, 9

**Steps:**
1. Add the scoped failing test(s) described below at the named entry point using the existing faithful filesystem/liveness/time fixture pattern; confirm RED through scoped-run.
2. Inject moveDirectory failure, quarantined owner/claim read failure or mismatch, and releaseDirectory failure on the quarantined path. Implement failure results that identify which recovery operation failed and never report an acquired handle. After a move, remove only the exact quarantine path whose owner and terminal claim were verified; leave inconsistent quarantined evidence intact and never use the current lease path as fallback cleanup. Keep recovery diagnostics on the existing callback and typed result path; callbacks cannot change authority.
3. Confirm the scoped tests pass through scoped-run and commit the behavior with message `fix: validate quarantine identity before scoped cleanup`. Await every started contender before fixture cleanup.

**Done when:**
- The quarantine recovery path confirms both the expected owner and terminal claim before releasing only that exact quarantine directory; mismatch or read failure leaves it intact and never targets a replacement current lease.
- Quarantine move, confirmation, or cleanup failure returns a labelled recovery failure naming the failed operation, emits no successful acquisition result, and leaves any replacement lease untouched.

## Task Dependency Graph

1 → 2 → 3 → 4 → 5
2 → 6
3, 4, 6 → 7 → 8
6, 8 → 9
4, 5, 9 → 10

These are behavioral dependencies, not authorization to run overlapping edits simultaneously. The source/test files overlap, so BUILD must serialize their edits even when two tasks are dependency-ready.

## Integration Points

Task 2 owns recovery admission through `createConductStateLease.acquire` into `createFilesystemConductStateStore.apply`: recovered writes persist, refusals do not write, and disjoint concurrent mutations serialize. Tasks 3–10 extend that same acquisition/release implementation and own branch-level proof. Task 5 owns the returned handle's generation-aware release behavior. There is no terminal catch-all validation task or new production adapter.

## Coverage Check

All criteria concern this diff's shared lease behavior with controlled local inputs through existing entry points. None requires an external service, a separate feature merge, or an operator action after implementation to become true; each disposition is diff-local. Test layers are identified below and use concrete assertions from the owning task. Existing behavior is explicitly retained where named; new regression fixtures prove the changed branch.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a dead lease owner and a valid recovery claim left by a dead process using the previous claim format, when another process acquires the lease, then acquisition succeeds without operator intervention and the acquired handle can release successfully. | 2, 5 | "createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires." | diff-local |
| Story 1 happy: Given a dead lease owner and several valid interrupted recovery attempts whose processes are all dead, when a caller acquires within its wait budget, then acquisition succeeds and subsequent release allows another caller to acquire. | 2, 5 | "createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires." | diff-local |
| Story 1 negative: Given a live lease owner and a dead recovery claimant, when another caller attempts acquisition, then it does not gain ownership or alter the live owner's protected state and returns a bounded failure if the owner remains live. | 3 | "A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine." | diff-local |
| Story 1 negative: Given a dead lease owner but a live recovery claimant, including one using the previous claim format, when a second caller attempts recovery, then it leaves that claimant's authority intact and returns a bounded failure while that claimant remains live. | 3 | "A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine." | diff-local |
| Story 2 happy: Given valid owner and recovery identities and successful probes proving both processes dead, when recovery is attempted, then the caller can acquire and release the lease. | 1, 2 | "createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires." | diff-local |
| Story 2 happy: Given a supported valid legacy claim without new-format owner binding, when its claimant and the current owner are both proved dead, then recovery remains available without a metadata migration. | 2 | "createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires." | diff-local |
| Story 2 negative: Given malformed, truncated, unsupported, or identity-inconsistent recovery metadata at any recovery stage, when a caller attempts acquisition, then recovery is refused with a message identifying invalid recovery metadata and the protected state is unchanged. | 1, 6 | "The acquire traversal returns recovery_refused for malformed/truncated/unsupported records, owner or predecessor mismatch, and repeated recovery identity at either root or successor, with no successful handle or protected-state write." | diff-local |
| Story 2 negative: Given recovery metadata that revisits a prior recovery identity, when acquisition evaluates it, then it refuses the invalid recovery state within the original wait budget rather than looping or granting ownership. | 6, 7 | "The acquire traversal returns recovery_refused for malformed/truncated/unsupported records, owner or predecessor mismatch, and repeated recovery identity at either root or successor, with no successful handle or protected-state write." | diff-local |
| Story 2 negative: Given a process probe that cannot establish a claimant's death, when acquisition attempts recovery, then it does not steal ownership; its failure identifies the blocking claimant or unverifiable liveness without asserting that an unverified process is live. | 6, 8 | "A claimant not proved dead retains ownership; probe exceptions produce a labelled unverifiable-liveness refusal, and neither record age nor timeout authorizes stealing." | diff-local |
| Story 2 negative: Given an unreadable claim or a claim-creation permission/storage failure, when recovery encounters that error, then acquisition returns a failure naming the failed recovery operation and performs no protected-state mutation or cleanup of a replacement lease. | 9 | "Recovery claim read/creation EACCES or ENOSPC returns a labelled acquisition failure naming the failed recovery operation, with no handle, protected-state mutation, or replacement-lease cleanup." | diff-local |
| Story 3 happy: Given two contenders observing the same dead owner and dead recoverer, when they attempt recovery concurrently, then at most one obtains a lease handle at a time, and after the winner releases the other can acquire within its remaining budget. | 3 | "Concurrent createConductStateLease.acquire calls over one dead predecessor produce at most one active handle; after release a waiting contender can acquire within its remaining budget." | diff-local |
| Story 3 happy: Given a current owner and a valid leftover recovery record explicitly belonging to a previous owner, when the current owner releases, then release succeeds and a subsequent caller can acquire. | 5 | "handle.release verifies its exact owner and succeeds in the presence of a valid explicitly foreign-generation record, allowing a subsequent acquisition, including after a delayed old contender writes that record." | diff-local |
| Story 3 negative: Given a contender paused after observing an old generation but before recording its recovery attempt, and a replacement owner that acquires meanwhile, when the paused contender resumes, then it neither releases nor quarantines the replacement lease and cannot prevent the replacement owner from releasing through the valid prior-generation record it creates. | 4, 5 | "handle.release verifies its exact owner and succeeds in the presence of a valid explicitly foreign-generation record, allowing a subsequent acquisition, including after a delayed old contender writes that record." | diff-local |
| Story 3 negative: Given a live elected recoverer paused before quarantine, when another contender attempts recovery, then the second contender cannot replace its recovery authority or obtain a simultaneous lease handle. | 3 | "A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine." | diff-local |
| Story 3 negative: Given an acquisition attempt whose owner or claim identity changes before authority is confirmed, when that attempt resumes, then it abandons the stale attempt and retries only within its original budget without modifying the replacement owner's state. | 4, 7 | "createConductStateLease.acquire revalidates owner and terminal-claim identities before quarantine; a changed owner or lost authority causes a bounded retry without moving or releasing the replacement generation." | diff-local |
| Story 3 negative: Given a current owner with an unbound legacy recovery record whose authority cannot safely be dismissed, when release is requested, then release refuses with a recovery diagnostic rather than deleting the lease as if the record belonged to another generation. | 5 | "handle.release refuses an applicable current-generation or unbound legacy recovery claim and refuses changed owner metadata without deleting the lease directory." | diff-local |
| Story 4 happy: Given the observed lease or recovery path disappears before the caller mutates it, when acquisition retries and the lease remains available, then the caller acquires within the original wait budget. | 7 | "An unheld vanished path can be reacquired within the remaining budget; an initializing owner still waits through the configured wait seam, and an interrupted wait returns interrupted with no handle." | diff-local |
| Story 4 happy: Given the blocker changes from an owner to a recovery claimant during one acquisition attempt, when the budget expires, then the timeout identifies the most recently observed blocking state and retains the configured store label. | 8 | "Acquisition timeout reports the last observed owner, recovery claimant, or unresolved recovery state with the configured store label; it does not reuse a previous iteration blocker after a generation or observation change." | diff-local |
| Story 4 negative: Given a dead owner and a live recovery claimant that outlasts the budget, when acquisition times out, then the result identifies recovery contention and never says the already-dead owner is live. | 8 | "A timeout behind a live recovery claimant identifies recovery contention and never describes the already-proved-dead owner as live; unverifiable liveness is not rendered as verified live." | diff-local |
| Story 4 negative: Given a recovery history or repeated generation changes that consume the acquisition budget, when the budget expires, then the call terminates with a timeout identifying the last observed recovery state instead of restarting its deadline or traversing indefinitely. | 7 | "createConductStateLease.acquire uses one original deadline across successor traversal, EEXIST contention, disappearing paths, and generation changes; budget exhaustion returns timeout rather than restarting traversal indefinitely." | diff-local |
| Story 4 negative: Given acquisition waiting is interrupted, when the interruption occurs, then it returns an interrupted result and no ownership handle or protected-state write. | 7 | "An unheld vanished path can be reacquired within the remaining budget; an initializing owner still waits through the configured wait seam, and an interrupted wait returns interrupted with no handle." | diff-local |
| Story 4 negative: Given quarantine, identity confirmation after quarantine, or quarantine cleanup fails, when acquisition receives the failure, then it returns a recovery failure identifying the failed operation and does not report successful acquisition or remove a replacement lease. | 10 | "Quarantine move, confirmation, or cleanup failure returns a labelled recovery failure naming the failed operation, emits no successful acquisition result, and leaves any replacement lease untouched." | diff-local |
| Story 5 happy: Given an existing filesystem-backed state store with known persisted fields and a recoverable dead claim, when a caller applies a valid field mutation through that store's normal API, then the mutation succeeds, the changed field persists, unrelated fields remain intact, and the lease is released for a later mutation. | 2 | "createFilesystemConductStateStore.apply reaches the repaired lease, persists the requested field while preserving unrelated fields after dead-claim recovery, and releases ownership for a subsequent mutation." | diff-local |
| Story 5 negative: Given the same store with a live recovery claimant or ambiguous claim metadata, when a caller applies the mutation, then it receives the lease failure and no persistence write occurs. | 2 | "Through createFilesystemConductStateStore.apply, live recovery claimants and invalid claim metadata return a lease failure with zero persistence writes." | diff-local |
| Story 5 negative: Given two store callers attempting valid disjoint mutations after interrupted recovery, when their operations contend, then both committed field changes survive and the stores never execute their protected persistence operations concurrently. | 2 | "Two disjoint createFilesystemConductStateStore.apply mutations after interrupted recovery preserve both committed values and observe maximum protected persistence concurrency of one." | diff-local |

## Lowest-sufficient test dispositions

- S1.1: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; also a fixture-owned production-filesystem acquire/release integration; Task(s) 2, 5; assert: createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires.
- S1.2: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 2, 5; assert: createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires.
- S1.3: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 3; assert: A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine.
- S1.4: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 3; assert: A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine.
- S2.1: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 1, 2; assert: createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires.
- S2.2: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 2; assert: createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires.
- S2.3: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 1, 6; assert: The acquire traversal returns recovery_refused for malformed/truncated/unsupported records, owner or predecessor mismatch, and repeated recovery identity at either root or successor, with no successful handle or protected-state write.
- S2.4: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 6, 7; assert: The acquire traversal returns recovery_refused for malformed/truncated/unsupported records, owner or predecessor mismatch, and repeated recovery identity at either root or successor, with no successful handle or protected-state write.
- S2.5: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 6, 8; assert: A claimant not proved dead retains ownership; probe exceptions produce a labelled unverifiable-liveness refusal, and neither record age nor timeout authorizes stealing.
- S2.6: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 9; assert: Recovery claim read/creation EACCES or ENOSPC returns a labelled acquisition failure naming the failed recovery operation, with no handle, protected-state mutation, or replacement-lease cleanup.
- S3.1: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 3; assert: Concurrent createConductStateLease.acquire calls over one dead predecessor produce at most one active handle; after release a waiting contender can acquire within its remaining budget.
- S3.2: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 5; assert: handle.release verifies its exact owner and succeeds in the presence of a valid explicitly foreign-generation record, allowing a subsequent acquisition, including after a delayed old contender writes that record.
- S3.3: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 4, 5; assert: handle.release verifies its exact owner and succeeds in the presence of a valid explicitly foreign-generation record, allowing a subsequent acquisition, including after a delayed old contender writes that record.
- S3.4: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 3; assert: A live owner or live legacy/new recovery claimant blocks the contender without claim replacement, lease quarantine, or protected-state mutation, including when the elected recoverer pauses before quarantine.
- S3.5: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 4, 7; assert: createConductStateLease.acquire revalidates owner and terminal-claim identities before quarantine; a changed owner or lost authority causes a bounded retry without moving or releasing the replacement generation.
- S3.6: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 5; assert: handle.release refuses an applicable current-generation or unbound legacy recovery claim and refuses changed owner metadata without deleting the lease directory.
- S4.1: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 7; assert: An unheld vanished path can be reacquired within the remaining budget; an initializing owner still waits through the configured wait seam, and an interrupted wait returns interrupted with no handle.
- S4.2: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 8; assert: Acquisition timeout reports the last observed owner, recovery claimant, or unresolved recovery state with the configured store label; it does not reuse a previous iteration blocker after a generation or observation change.
- S4.3: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 8; assert: A timeout behind a live recovery claimant identifies recovery contention and never describes the already-proved-dead owner as live; unverifiable liveness is not rendered as verified live.
- S4.4: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 7; assert: createConductStateLease.acquire uses one original deadline across successor traversal, EEXIST contention, disappearing paths, and generation changes; budget exhaustion returns timeout rather than restarting traversal indefinitely.
- S4.5: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 7; assert: An unheld vanished path can be reacquired within the remaining budget; an initializing owner still waits through the configured wait seam, and an interrupted wait returns interrupted with no handle.
- S4.6: Lease acquisition/release boundary test with a faithful injected filesystem and deterministic liveness/time; Task(s) 10; assert: Quarantine move, confirmation, or cleanup failure returns a labelled recovery failure naming the failed operation, emits no successful acquisition result, and leaves any replacement lease untouched.
- S5.1: Integration through the real persistent-store API with controlled lease/filesystem boundaries; Task(s) 2; assert: createFilesystemConductStateStore.apply reaches the repaired lease, persists the requested field while preserving unrelated fields after dead-claim recovery, and releases ownership for a subsequent mutation.
- S5.2: Integration through the real persistent-store API with controlled lease/filesystem boundaries; Task(s) 2; assert: Through createFilesystemConductStateStore.apply, live recovery claimants and invalid claim metadata return a lease failure with zero persistence writes.
- S5.3: Integration through the real persistent-store API with controlled lease/filesystem boundaries; Task(s) 2; assert: Two disjoint createFilesystemConductStateStore.apply mutations after interrupted recovery preserve both committed values and observe maximum protected persistence concurrency of one.

No distinct end-to-end daemon/LLM workflow is needed: the observable behavior is completely reachable through the lease and persistent-store boundaries. BUILD-entry acceptance planning should reuse these lower-layer dispositions rather than add duplicate suite-running acceptance flows. Tests use no real third-party service and never kill operator processes.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D1 | task | task-2, task-3 | createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires. |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D2 | task | task-1, task-4 | A delayed old-generation claimant cannot authorize recovery of a new owner; its valid foreign-generation record is retained without overwriting a current claim, and current-owner recovery uses only the deterministic owner-bound authority path. |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D3 | task | task-2, task-4, task-5 | createConductStateLease.acquire recovers valid legacy dead roots and multiple valid dead successor claims using exclusive creation without deleting or overwriting active claims, and its returned handle releases so a later caller acquires. |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D4 | task | task-3, task-4, task-10 | createConductStateLease.acquire revalidates owner and terminal-claim identities before quarantine; a changed owner or lost authority causes a bounded retry without moving or releasing the replacement generation. |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D5 | task | task-1, task-6, task-7, task-9, task-10 | createConductStateLease.acquire uses one original deadline across successor traversal, EEXIST contention, disappearing paths, and generation changes; budget exhaustion returns timeout rather than restarting traversal indefinitely. |
| adr-2026-09-11-immutable-state-lease-recovery-succession#D6 | task | task-5, task-6, task-8 | A timeout behind a live recovery claimant identifies recovery contention and never describes the already-proved-dead owner as live; unverifiable liveness is not rendered as verified live. |

## Verify-claims and completion boundaries

Verified from named source: the shared lease, filesystem methods, public result kinds, injected clocks/liveness, existing quarantine path, and persistent-store integration parameter. The approved ADR selects immutable succession and its compatibility/safety limits. The new parsing/slot/traversal logic is planned work, not claimed as existing behavior. No unconfirmed load-bearing assumption remains; verify-claims verdict CLEAR.

All 25 extracted criteria are mapped to task-owned checks. All six citable decisions have one architecture coverage row. Dependencies are acyclic. The plan delivers only the approved source behavior; it does not direct BUILD to rewrite any other feature's sealed artifact.
