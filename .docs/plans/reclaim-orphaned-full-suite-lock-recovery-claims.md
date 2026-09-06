# Implementation Plan: Reclaim orphaned full-suite lock recovery claims

**Date:** 2026-09-06
**Stories:** .docs/stories/reclaim-orphaned-full-suite-lock-recovery-claims.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing lock contract — exclusive claim creation stays the arbiter, quarantine and release revalidation are unchanged, and recovery still only happens after the owner is already proven stale.

## Summary

Four bounded tasks deliver #2171 inside the recovery-claim branch of the full-suite verification lock. A claim left behind by a crashed recoverer becomes reclaimable when its recorded process is not live, or when the claim cannot be parsed and is older than the unowned-stale threshold; every other claim keeps the lock occupied exactly as today. Owner liveness rules, the quarantine and release sequences, the acquisition timeout budget, the timeout message wording, the claim record format, evidence handling, and the separate conduct state lease are all outside this slice.

## Technical Approach

Add a claim guard and parser beside the existing owner guard and parser in `full-suite-verifier.ts`, matching their shape: a `version === 1` structural check over `pid`, `token`, and `claimedAt`, and a parser that returns `null` for unparseable bytes rather than throwing. The record type already exists and is unchanged; nothing today reads it back.

Add one classification helper that answers a single question about an existing claim file: is it orphaned. It reads the claim bytes, and reports `VANISHED` when the file is already gone. When the bytes parse and the injected `processIsLive` reports the recorded pid live, and when the bytes do not parse at all, the claim is not provably orphaned, so the helper falls back to the same age rule the module already applies to an unowned lock — `clock()` minus the claim file's `mtimeMs` against `unownedStaleMs` — and reports `OCCUPIED` while the claim is younger than that threshold. A claim whose recorded process is not live is orphaned immediately, with no age wait. This deliberately reuses the existing owner-path shape (liveness first, age as the conservative fallback) so a claim written by an older engine needs no format change, and so a claim whose pid was reused by an unrelated process still clears once it is provably ancient.

Reclaim by stealing, not by deleting in place. The helper renames the claim to a unique sibling path inside the lock directory built from the process id and a fresh UUID, then removes that path best-effort. Rename is the atomic arbiter: when two acquirers classify the same orphan, only one rename can find the source, and the loser sees `ENOENT` and treats the claim as vanished. An unremoved steal residue is harmless because nothing enumerates the lock directory and the whole directory is removed recursively when recovery completes.

Wire the classification into `quarantineClaimedStaleLock` as a bounded second chance. The exclusive `wx` write stays the arbiter and is attempted first, unchanged. On `EEXIST` the function classifies the existing claim once: `OCCUPIED` is returned as today, a `FAILED` classification is returned with a message naming the recovery claim, and a reclaimed or vanished claim earns exactly one retry of the same `wx` write. A second `EEXIST` returns `OCCUPIED`, so the acquire loop's existing backoff and timeout remain the only retry budget and the function cannot spin. Because `quarantineClaimedStaleLock` now needs liveness and the stale threshold, replace its trailing `clock` argument with an options object carrying `clock`, `processIsLive`, and `unownedStaleMs`; its single caller already resolves all three.

Everything downstream is untouched. After a successful claim the function still revalidates owner and claim bytes before renaming the lock aside, still revalidates them inside the quarantine, and still releases its own claim through `removeOwnedRecoveryClaim` on every failure path. A reclaiming acquirer that loses the lock to a replacement owner therefore still fails with the existing ownership-changed message rather than displacing it.

Tests use the lock fixtures already established in `full-suite-verifier.test.ts`: a configured temporary project, hand-written `owner.json` and `recovery.json` bytes, an injected `execute` that counts suite executions, and `lock` options supplying `waitTimeoutMs`, `unownedStaleMs`, `clock`, and a `processIsLive` keyed by pid so the owner and the claim can be given independent liveness. The race and vanish cases reuse the file's established pattern of an injected probe with a deliberate filesystem side effect. Pure guard, parser, and classification cases stay at unit level against a temporary directory; the observable recovery outcome is proven through `ensure()`. No provider, network, GitHub, or LLM boundary is involved, so no new fake is introduced.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, liveness-plus-age classification over a claim identity token, and both stories on 2026-09-06 (delegated).
- Verified: `quarantineClaimedStaleLock` writes the claim with `flag: 'wx'` and maps `EEXIST` directly to `OCCUPIED`; no code path parses or liveness-checks an existing claim.
- Verified: `FullSuiteLockRecoveryClaim` already carries `version`, `pid`, `token`, and `claimedAt`, so classification needs no record change.
- Verified: `recoverLockIfProvablyStale` is the only caller of `quarantineClaimedStaleLock` and already holds `clock`, `processIsLive`, and `unownedStaleMs`.
- Verified: the owner path already pairs a liveness probe with an `unownedStaleMs` age fallback measured from `mtimeMs`, which this change mirrors for the claim.
- Verified: `isLockOwner` and `parseLockOwner` establish the guard-plus-parser shape the claim guard copies, and `defaultProcessIsLive` is already injectable through `FullSuiteLockOptions.processIsLive`.
- Verified: the acquire loop retries `OCCUPIED` until `waitTimeoutMs`, whose default is 30 seconds, which is the stall the issue reports.
- Verified: the existing lock tests already inject `processIsLive` with a filesystem side effect to drive a race, so the negative-path fixtures need no new mechanism.
- Verified: no documentation page, runbook, or approved decision record describes the full-suite lock's recovery-claim behavior, so no documentation or decision-record amendment is owed.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree copy of the engine module and its test file; no unconfirmed assumption changes the approach.

## Tasks

### Task 1: Classify an existing recovery claim as orphaned or occupied
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/full-suite-verifier.ts, src/conductor/test/engine/full-suite-verifier.test.ts
**Dependencies:** none

**Steps:**
1. Write unit tests over a temporary lock directory for the claim guard, parser, and classification: a well-formed claim with a live pid, a well-formed claim with a dead pid, unparseable bytes newer than the threshold, unparseable bytes older than the threshold, a missing claim file, and a structurally invalid but parseable object.
2. Establish RED, then add the claim guard and parser beside the existing owner guard and parser, checking `version === 1`, a positive integer `pid`, a non-empty `token`, and a parseable `claimedAt`.
3. Implement the classification helper: read the claim, report vanished on absence, report orphaned when the parsed pid is not live, otherwise compare the claim file age from the injected clock against the stale threshold and report occupied while it is younger.
4. Return an explicit failure carrying the underlying filesystem message for any read, liveness, or age probe error other than absence, and never report orphaned from a failed probe.
5. Run the focused test file through the repository's scoped test invocation, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A claim whose recorded process is not live classifies as orphaned regardless of its age.
2. A claim whose recorded process is live classifies as occupied while it is younger than the injected stale threshold.
3. Unparseable claim bytes classify as occupied while fresh and as orphaned once older than the injected stale threshold.
4. An absent claim classifies as vanished, and a read, liveness, or age probe error classifies as a failure whose message names the recovery claim.

### Task 2: Reclaim the orphan during stale recovery
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/full-suite-verifier.ts, src/conductor/test/engine/full-suite-verifier.test.ts
**Dependencies:** 1

**Steps:**
1. Write an integration fixture that seeds a lock directory with a dead owner and a claim recording a second dead pid, injects a pid-keyed liveness probe and a counting suite executor, and asserts through `ensure()` that the suite runs once. Establish RED against the current occupied-on-EEXIST behavior.
2. Add a steal step that renames the classified orphan to a unique sibling path inside the lock directory built from the process id and a fresh UUID, removes that path best-effort, and treats a rename `ENOENT` as a vanished claim.
3. Replace the trailing clock argument of the quarantine function with an options object carrying the clock, the liveness probe, and the stale threshold, and pass the values its single caller already resolves.
4. On `EEXIST` from the exclusive claim write, classify once and retry that same write exactly once for an orphaned or vanished claim; return occupied on a second `EEXIST` so the acquire loop keeps its existing backoff and timeout as the only retry budget.
5. Add a second integration case proving an unparseable claim older than the injected stale threshold reaches the same recovery outcome, and assert the lock directory is gone afterwards.
6. Run the focused test file through the repository's scoped test invocation, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A lock holding a dead owner and a dead-process claim recovers within one acquisition and executes the suite exactly once.
2. An unparseable claim older than the injected stale threshold reaches the same recovery outcome, and the lock directory no longer exists after the run.
3. The exclusive claim write is retried at most once per recovery attempt, and a second collision returns occupied rather than looping.
4. Owner and claim revalidation before and inside the quarantine are unchanged, and the existing ownership-changed refusal still fires when a replacement owner appears.

### Task 3: Fail closed when a claim cannot be proven orphaned
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/full-suite-verifier.ts, src/conductor/test/engine/full-suite-verifier.test.ts
**Dependencies:** 2

**Steps:**
1. Add an integration case where the injected liveness probe removes the claim file as its side effect, proving the bounded retry either takes the claim once or reports the lock occupied, and never reports a successful acquisition while a claim exists.
2. Add an integration case where the classification probe fails for a reason other than absence, asserting acquisition fails with a message naming the recovery claim rather than proceeding as if the lock were free.
3. Assert that no failure path leaves this acquirer's own claim behind, reusing the existing owned-claim release helper on every early return.
4. Run the focused test file through the repository's scoped test invocation, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A claim removed during classification produces no double reclaim and no false acquisition.
2. A non-absence probe failure fails acquisition with a message naming the recovery claim.
3. No failure path leaves this acquirer's own claim file behind in the lock directory.

### Task 4: Keep a live recoverer's claim exclusive
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/full-suite-verifier.test.ts
**Dependencies:** 2

**Steps:**
1. Add an integration case seeding a dead owner and a fresh claim whose recorded pid the injected probe reports live, and assert acquisition times out as occupied, runs no suite, and leaves the claim bytes identical.
2. Add an integration case seeding a fresh unparseable claim under a non-zero stale threshold, and assert acquisition times out as occupied and the claim file is neither renamed nor removed.
3. Add a contention case running two verifiers concurrently over one orphaned lock and assert exactly one suite execution across both, mirroring the file's existing concurrent acquisition fixture.
4. Run the focused test file through the repository's scoped test invocation, run the typecheck target that covers test files, then run the configured aggregate test command before handoff and commit.

**Done when:**
1. A live-process claim keeps acquisition occupied until its timeout and the claim file is byte-identical afterwards.
2. A fresh unparseable claim keeps acquisition occupied and is neither renamed nor removed.
3. Two concurrent acquirers over one orphaned lock produce exactly one suite execution.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the full-suite lock holds a dead owner and a recovery claim whose recorded process is not live, when a verifier acquires the lock, then the orphaned claim is reclaimed, the stale lock is removed, and the suite runs without any operator deleting the lock directory. | 1, 2 | "A lock holding a dead owner and a dead-process claim recovers within one acquisition and executes the suite exactly once." | diff-local |
| Story 1 happy: Given a recovery claim that cannot be parsed and is older than the unowned-stale threshold, when a verifier acquires the lock, then the claim is treated as orphaned and acquisition proceeds by the same reclaim path. | 1, 2 | "An unparseable claim older than the injected stale threshold reaches the same recovery outcome, and the lock directory no longer exists after the run." | diff-local |
| Story 1 negative: Given an orphaned claim disappears between the classification and the reclaiming rename, when the acquirer makes its one bounded retry of the exclusive claim write, then acquisition either takes the claim once or reports the lock occupied, and never reports success while another claim exists. | 3 | "A claim removed during classification produces no double reclaim and no false acquisition." | diff-local |
| Story 1 negative: Given the claim cannot be read, classified, or reclaimed for a reason other than absence, when acquisition runs, then it fails with a message naming the recovery claim rather than treating the lock as free. | 1, 3 | "A non-absence probe failure fails acquisition with a message naming the recovery claim." | diff-local |
| Story 2 happy: Given a recovery claim whose recorded process is live and which is newer than the unowned-stale threshold, when a second verifier attempts stale recovery, then it reports the lock occupied, leaves the claim and lock directory untouched, and runs no suite. | 1, 4 | "A live-process claim keeps acquisition occupied until its timeout and the claim file is byte-identical afterwards." | diff-local |
| Story 2 negative: Given an unparseable recovery claim newer than the unowned-stale threshold, when a verifier attempts stale recovery, then it reports the lock occupied and preserves the claim bytes rather than stealing a claim it cannot prove is orphaned. | 1, 4 | "A fresh unparseable claim keeps acquisition occupied and is neither renamed nor removed." | diff-local |
| Story 2 negative: Given two acquirers contend for the same orphaned lock, when both run to completion, then exactly one of them executes the suite and neither reports a successful acquisition it did not hold. | 4 | "Two concurrent acquirers over one orphaned lock produce exactly one suite execution." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled temporary-project fixtures. Task 1 owns the unit-level guard, parser, and classification cases. Task 2 owns the recovery integration through the verifier's public acquisition path for both Story 1 happy criteria. Task 3 owns the Story 1 negative integration cases for the vanish race and probe failure. Task 4 owns the Story 2 exclusion and contention integration cases. The existing lock tests remain authoritative for owner liveness, process-identity mismatch, quarantine displacement refusal, and release semantics; none of them is rewritten. No third-party boundary participates, so no new fake is added, and no smoke test is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 2 -> Task 4
