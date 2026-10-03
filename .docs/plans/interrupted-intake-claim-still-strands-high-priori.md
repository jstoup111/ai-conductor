# Plan: Lease-guarded intake claim recovers stranded envelopes

**Date:** 2026-10-02
**Source:** jstoup111/ai-conductor#2733
**Stories:** .docs/stories/interrupted-intake-claim-still-strands-high-priori.md
**Complexity:** M
**Conflict check:** Clean as of 2026-10-02

## Summary

Seven tasks make `compose claim` hold an intake claim lease for its whole walk and, under that lease, return every `.claimed` envelope whose ledger entry is `pending` to the inbox before walking, so an interrupted claim never leaves pending intake unclaimable and overlapping claims never walk the same envelopes.

## Technical Approach

- **Decision source:** `adr-011-async-intake-queue-and-github-source` decision 6 (amended 2026-10-02). Scope is the operator-confirmed minimal boundary in `.docs/track/interrupted-intake-claim-still-strands-high-priori.md`: no change to `compose unclaim`, `compose requeue --stale`, `brain status`, or `.claimed` envelopes whose ledger entry is `done` or absent.
- **Claim lease (Task 1).** A second `createConductStateLease` instance, path `«engineer dir»/inbox` (lease directory `inbox.lease`), label `intake claim`, default wait bound `INTAKE_CLAIM_LEASE_WAIT_MS` = 5 minutes, sized to a full banded walk (one sequential label read per pending entry plus issue-state and dependency reads). Pattern: the ledger's `withLedgerLease` — preserve pid ownership, the transient owner-metadata retry, release in `finally`, fail closed on `recovery_refused`; allowed variation is the longer bound. Search hints: `withLedgerLease`, `createConductStateLease`.
- **Reconciliation (Tasks 2-3).** The file queue gains `listClaimed()` (typed `FileIntakeQueue`; the `IntakeQueue` port is unchanged). `reconcileStrandedClaims` reads the ledger once via `ledger.list()` (which fails closed on a corrupt ledger before any rename), then releases only pending-ledger `.claimed` envelopes through the queue's existing `release` mapping. Safety rests on two verified facts: a successful claim acks the winner before the ledger becomes `claimed`, and the claim walk is the only producer of `.claimed` files — so under the lease every pending/`.claimed` pair is a dead walk's strand.
- **Wiring (Task 4, integration owner).** The `claim` case of `engineer-cli.ts` runs lease → reconcile → existing delivery-guarded `claimUnblocked` walk → winner ack and ledger transition → lease release. `claimUnblocked`, the delivery guard and banding are unchanged. Lock order: the ledger lease is only ever taken inside the claim lease.
- **Negative coverage (Tasks 5-7)** drive the real `dispatchEngineer` claim path with fixture engineer dirs, an injected gh runner and real files; no real GitHub call, no `git stash`.

## Prerequisites

Approved amendments to `adr-011-async-intake-queue-and-github-source` and `adr-2026-07-10-intake-claim-priority-banding` are committed on this spec branch. Each task runs only its affected tests through `ai-conductor scoped-run`; `test_suite` owns aggregate evidence. Vitest runs set `TMPDIR` to a task-owned directory.

## Tasks

### Task 1: Add the intake claim lease wrapper

**Story:** 2
**Type:** infrastructure
**Files:** `src/conductor/src/engine/engineer/intake/claim-lease.ts`, `src/conductor/test/engine/engineer/intake/claim-lease.test.ts`
**Dependencies:** none

**Steps:**
1. Write failing unit tests in `claim-lease.test.ts` for the checks below, injecting `processIsLive`, a small `waitTimeoutMs`, and a body spy; run them and confirm RED.
2. Implement `withIntakeClaimLease(engineerDir, body, opts)` in `claim-lease.ts` following the ledger precedent (`ledger.ts` `withLedgerLease`): one `createConductStateLease(join(engineerDir, 'inbox'), { label: 'intake claim', waitTimeoutMs })` instance (lease directory `inbox.lease`, beside the inbox, never inside it), the same transient owner-metadata retry, release in `finally`. Export `INTAKE_CLAIM_LEASE_WAIT_MS = 300_000` as the default bound and `IntakeClaimInProgressError` for the occupied/timeout result. Allowed variation: the longer wait bound. Search hints: `withLedgerLease`, `isTransientLeaseOwnerMetadataFailure`.
3. Run the tests to GREEN and commit.

**Done when:**
- `withIntakeClaimLease` acquires a `createConductStateLease` on the inbox path labelled `intake claim`, runs the body, and releases the lease in `finally` whether the body returns or throws, as asserted by the lease-release unit tests.
- When a live owner holds the lease past the injected wait bound, `withIntakeClaimLease` rejects with `IntakeClaimInProgressError` whose message contains `claim in progress` and the owner pid, and the body spy records zero calls.
- When `acquire` returns `recovery_refused` for invalid or ambiguous owner metadata, `withIntakeClaimLease` rejects with an error naming the intake claim lease problem and the body spy records zero calls.
- A lease whose owner pid is not live (injected `processIsLive` returns false) is recovered and the body runs once.
- `claim-lease.ts` imports `createConductStateLease` from `conduct-state-lease.ts` and does not import `daemon-lock.ts`.

### Task 2: List claimed envelopes from the file queue

**Story:** 1
**Type:** infrastructure
**Files:** `src/conductor/src/engine/engineer/intake/queue.ts`, `src/conductor/test/engine/engineer/intake/queue.test.ts`
**Dependencies:** none

**Steps:**
1. Write failing tests in `queue.test.ts` for `listClaimed()`; confirm RED.
2. Add `listClaimed()` to the object `createFileQueue` returns, typed as a `FileIntakeQueue` that extends `IntakeQueue` so the port interface (enqueue/claim/ack/release) is unchanged. Mirror `list()`: filter `.claimed`, sort, tolerate a file vanishing between `readdir` and `readFile`. Do not change `claim`, `ack`, `release`, `list` or the filename mapping.
3. Run the tests to GREEN and commit.

**Done when:**
- `createFileQueue(dir).listClaimed()` returns the parsed envelope of every `.claimed` file in the inbox and none of the `.json` files, as asserted by the queue unit test.
- `listClaimed()` skips a `.claimed` file deleted between `readdir` and `readFile` instead of throwing.
- The `IntakeQueue` port type is unchanged and the existing queue unit and acceptance tests pass unmodified.

### Task 3: Reconcile stranded claims against the ledger

**Story:** 3
**Type:** infrastructure
**Files:** `src/conductor/src/engine/engineer/intake/reconcile-strands.ts`, `src/conductor/test/engine/engineer/intake/reconcile-strands.test.ts`
**Dependencies:** Task 2

**Steps:**
1. Write failing unit tests in `reconcile-strands.test.ts` with a real file queue in a temp inbox and a real ledger file; confirm RED.
2. Implement `reconcileStrandedClaims({ queue, ledger })`: call `ledger.list()` once before any rename, build the set of `pending` keys, then for each `queue.listClaimed()` envelope whose `(source, sourceRef)` is pending call `queue.release(envelope)`. Treat an `ENOENT` release as already handled; rethrow any other error wrapped with the envelope sourceRef and file name. Return `{ released: string[] }`. Never write the ledger.
3. Run the tests to GREEN and commit.

**Done when:**
- `reconcileStrandedClaims` calls `ledger.list()` once before any rename and calls `queue.release` only for `.claimed` envelopes whose ledger entry is `pending`, returning their sourceRefs, as asserted with pending, claimed, done and absent fixtures.
- A `queue.release` failure with code `ENOENT` is skipped and the remaining strands are still released; any other release error rejects with an error naming the envelope sourceRef and file.
- A `CorruptLedgerError` from `ledger.list()` propagates before any `queue.release` call, as asserted by a release spy with zero calls.
- The helper performs no ledger mutation: the fixture `ledger.json` is byte-identical before and after reconciliation.

### Task 4: Run the claim walk under the lease after reconciling strands

**Story:** 1
**Type:** happy-path
**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/engine/engineer/engineer-cli-claim-strand-recovery.test.ts`
**Dependencies:** Tasks 1, 3

**Steps:**
1. Write failing tests in `engineer-cli-claim-strand-recovery.test.ts` driving `dispatchEngineer` `claim` with a fixture engineer dir and an injected gh runner (follow `engineer-cli-claim-delivery-guard.test.ts` for fixture shape); confirm RED.
2. In the `claim` case of `engineer-cli.ts`, wrap everything from reconciliation through the winner ack and ledger transition in `withIntakeClaimLease(engDir, ...)`. Inside it, run `reconcileStrandedClaims` over the raw file queue and the ledger before building the delivery-guarded queue, print one stderr line `released N stranded intake claim(s)` when N > 0, then run the existing `claimUnblocked` walk unchanged. Add an optional `intakeClaimLeaseWaitMs` test seam to `DispatchEngineerOpts`; production uses `INTAKE_CLAIM_LEASE_WAIT_MS`. The ledger lease must never be held while acquiring the claim lease.
3. Run the tests to GREEN and commit.

**Done when:**
- Driving `dispatchEngineer` `claim` over an inbox whose pending-ledger envelopes are all `.claimed` (a killed drain) with a `priority: critical` strand and a claimable `priority: low` entry, every recovered sourceRef is among the refs passed to the label read and the claim JSON names the critical sourceRef.
- With strands and no `inbox.lease` directory ever created, the first `claim` recovers every strand with no manual rename, and each recovered entry other than the claimed winner keeps ledger status `pending` with `attempts` unchanged.
- With an `inbox.lease` owned by a non-live pid plus strands, `claim` recovers the lease and the strands without operator action and exits 0 with a claim.
- When strands were recovered, stderr carries exactly one line `released N stranded intake claim(s)` with N equal to the recovered count.
- With no strands in the inbox, the inbox listing after `claim` equals the seeded listing minus the claimed winner and stderr carries no `stranded` line.

### Task 5: Serialize overlapping claims on the lease

**Story:** 2
**Type:** negative-path
**Files:** `src/conductor/test/engine/engineer/engineer-cli-claim-lease-contention.test.ts`
**Dependencies:** Task 4

**Steps:**
1. Write tests in `engineer-cli-claim-lease-contention.test.ts`: the test acquires the claim lease in-process via `createConductStateLease` on the fixture inbox path to simulate claim A, drains and restores A's envelopes itself, and drives claim B through `dispatchEngineer` with a small `intakeClaimLeaseWaitMs`. Confirm the contention tests fail against Task 4 with the lease wrapper bypassed (RED via `git show` of the pre-Task-4 claim case, never `git stash`).
2. Fix any behavior gap in the `claim` case the tests reveal; no new production surface.
3. Run the tests to GREEN and commit.

**Done when:**
- While the test holds the intake claim lease from a live owner, a concurrent `claim` stays pending, renames no inbox file, writes no ledger byte, and the injected gh runner receives no call during the hold.
- When the holder finishes its claim and releases the lease within the waiting claim's bound, the waiting `claim` acquires it, reports zero recovered strands, and claims a different sourceRef than the holder.
- When the hold outlasts the injected wait bound, `claim` exits 1, stderr contains `claim in progress` and the holder pid, and the inbox listing and ledger bytes are unchanged.
- After `claim` returns a claim, `empty` or `all-blocked`, and after the walk throws an injected resolver error, the `inbox.lease` directory is absent and a following `claim` acquires without waiting.
- After the injected walk error, every envelope the walk drained is a `.json` file in the inbox again.

### Task 6: Fail closed on recovery faults

**Story:** 1
**Story:** 2
**Story:** 3
**Type:** negative-path
**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/engine/engineer/engineer-cli-claim-strand-faults.test.ts`
**Dependencies:** Task 4

**Steps:**
1. Write tests in `engineer-cli-claim-strand-faults.test.ts`; confirm RED for the vanish and rename-fault cases.
2. Add an optional `intakeFileQueue` test seam to `DispatchEngineerOpts` (production uses `createFileQueue`) so a test can delete a `.claimed` file between listing and release. Ensure a reconciliation error or a lease refusal returns exit 1 with the error on stderr before `claimUnblocked` runs.
3. Run the tests to GREEN and commit.

**Done when:**
- With a strand plus a same-named claimable `.json` copy, `claim` hands that sourceRef out once and afterwards no claimable envelope for it remains in the inbox.
- When one strand's recovery rename fails with a non-ENOENT error (its target `.json` path is a non-empty directory), `claim` exits 1 naming that envelope, the injected gh runner receives no call, and a second `claim` after removing the obstruction recovers every other strand.
- When a strand's `.claimed` file is deleted between listing and release through the `intakeFileQueue` seam, `claim` skips it and recovers the remaining strands.
- When `inbox.lease` holds invalid owner metadata, `claim` exits 1 with stderr naming the intake claim lease problem, the injected gh runner receives no call, and no inbox file is renamed.
- With an unparseable `ledger.json` and seeded strands, `claim` exits non-zero with the existing corrupt-ledger error and every seeded `.claimed` file is still `.claimed`.

### Task 7: Limit recovery to pending-ledger strands

**Story:** 3
**Type:** negative-path
**Files:** `src/conductor/test/engine/engineer/engineer-cli-claim-strand-scope.test.ts`
**Dependencies:** Task 4

**Steps:**
1. Write tests in `engineer-cli-claim-strand-scope.test.ts` driving `dispatchEngineer` `claim`; confirm the scope tests fail when reconciliation releases every `.claimed` file (RED via a temporary local edit reverted before commit).
2. Fix any behavior gap the tests reveal; no new production surface.
3. Run the tests to GREEN and commit.

**Done when:**
- Seeding `.claimed` envelopes with `pending`, `claimed`, `done` and absent ledger entries, `claim` returns only the `pending` one to `.json`, and the `claimed`, `done` and absent envelopes remain byte-identical `.claimed` files.
- The `claimed`- and `done`-ledger envelopes' sourceRefs never appear in the claim JSON or in the refs passed to the label read.
- When a claim run's only effects are recovery and an `empty` or `all-blocked` outcome, `ledger.json` is byte-identical before and after the claim.
- Stale-claim reaping of `claimed` ledger entries is unchanged: `engineer-cli-claim-stale-reap.acceptance.test.ts` passes unmodified.

## Task Dependency Graph

Independent starts: Task 1, Task 2. Task 2 → Task 3. Tasks 1 + 3 → Task 4. Task 4 → Tasks 5, 6, 7 (Task 6 also edits `engineer-cli.ts`, so it serializes after Task 4's change; Tasks 5 and 7 are test-only and can run concurrently).

## Integration ownership

Task 4 is the sole owner of the changed boundary `compose claim` dispatch → claim lease → reconciliation → existing walk; Tasks 5-7 prove its negative paths through the same entry point.

## Coverage Check

All rows are diff-local: fixtures supply the inbox, ledger, lease directory and gh results, so no commit outside this diff changes their truth.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a prior claim process was killed after draining the inbox so that every pending envelope is left claimed while its ledger entry stays `pending`, when the operator runs `compose claim`, then every one of those envelopes is returned to the claimable state before the walk and the walk considers them as candidates | 4 | Driving `dispatchEngineer` `claim` over an inbox whose pending-ledger envelopes are all `.claimed` (a killed drain) with a `priority: critical` strand and a claimable `priority: low` entry, every recovered sourceRef is among the refs passed to the label read and the claim JSON names the critical sourceRef. | diff-local |
| Story 1 happy: Given strands from that killed claim include a `priority: critical` entry and the claimable inbox holds only a `priority: low` entry, when the operator runs `compose claim`, then the critical entry is the one claimed | 4 | Driving `dispatchEngineer` `claim` over an inbox whose pending-ledger envelopes are all `.claimed` (a killed drain) with a `priority: critical` strand and a claimable `priority: low` entry, every recovered sourceRef is among the refs passed to the label read and the claim JSON names the critical sourceRef. | diff-local |
| Story 1 happy: Given strands that already existed before this change shipped (no claim lease was ever written for them), when the operator runs the first `compose claim` after upgrading, then those strands are recovered the same way without any manual file rename | 4 | With strands and no `inbox.lease` directory ever created, the first `claim` recovers every strand with no manual rename, and each recovered entry other than the claimed winner keeps ledger status `pending` with `attempts` unchanged. | diff-local |
| Story 1 happy: Given the prior claim process died while holding the claim lease, when the next `compose claim` starts, then it recovers the dead owner's lease and proceeds without operator action | 4 | With an `inbox.lease` owned by a non-live pid plus strands, `claim` recovers the lease and the strands without operator action and exits 0 with a claim. | diff-local |
| Story 1 happy: Given strands were recovered, when the claim completes, then stderr carries one line stating how many strands were released back to the inbox | 4 | When strands were recovered, stderr carries exactly one line `released N stranded intake claim(s)` with N equal to the recovered count. | diff-local |
| Story 1 negative: Given a strand whose envelope has a same-named claimable copy already present in the inbox, when the claim recovers strands, then exactly one claimable envelope remains for that entry and the claim never hands the entry out twice | 6 | With a strand plus a same-named claimable `.json` copy, `claim` hands that sourceRef out once and afterwards no claimable envelope for it remains in the inbox. | diff-local |
| Story 1 negative: Given the inbox holds no strands, when the operator runs `compose claim`, then no file in the inbox is renamed before the walk and no recovery line is printed | 4 | With no strands in the inbox, the inbox listing after `claim` equals the seeded listing minus the claimed winner and stderr carries no `stranded` line. | diff-local |
| Story 1 negative: Given recovering one strand fails with a filesystem error other than the file having already vanished, when the claim runs, then the claim exits non-zero naming the failing envelope and performs no walk, leaving every other envelope in a state the next claim can recover | 6 | When one strand's recovery rename fails with a non-ENOENT error (its target `.json` path is a non-empty directory), `claim` exits 1 naming that envelope, the injected gh runner receives no call, and a second `claim` after removing the obstruction recovers every other strand. | diff-local |
| Story 1 negative: Given a strand's envelope disappears between listing and recovery, when the claim runs, then that envelope is skipped as already handled and recovery of the rest continues | 6 | When a strand's `.claimed` file is deleted between listing and release through the `intakeFileQueue` seam, `claim` skips it and recovers the remaining strands. | diff-local |
| Story 2 happy: Given claim A is mid-walk holding the claim lease and the drained envelopes, when claim B starts, then claim B waits for the lease and does not recover, rename or walk any envelope while A holds it | 5 | While the test holds the intake claim lease from a live owner, a concurrent `claim` stays pending, renames no inbox file, writes no ledger byte, and the injected gh runner receives no call during the hold. | diff-local |
| Story 2 happy: Given claim A finishes and releases the lease within claim B's wait bound, when claim B acquires the lease, then B finds no strands from A and claims a different entry than A | 5 | When the holder finishes its claim and releases the lease within the waiting claim's bound, the waiting `claim` acquires it, reports zero recovered strands, and claims a different sourceRef than the holder. | diff-local |
| Story 2 happy: Given a claim finishes by claiming an entry, returning `empty`, or returning `all-blocked`, when it returns, then the claim lease has been released | 5 | After `claim` returns a claim, `empty` or `all-blocked`, and after the walk throws an injected resolver error, the `inbox.lease` directory is absent and a following `claim` acquires without waiting. | diff-local |
| Story 2 negative: Given claim A holds the claim lease longer than claim B's wait bound (for example a hung process), when claim B's wait expires, then claim B exits non-zero with a message stating a claim is in progress and naming A's pid, and makes no change to the inbox or ledger | 5 | When the hold outlasts the injected wait bound, `claim` exits 1, stderr contains `claim in progress` and the holder pid, and the inbox listing and ledger bytes are unchanged. | diff-local |
| Story 2 negative: Given the claim walk throws an unexpected error after acquiring the lease, when the process exits, then the claim lease is released and every held envelope is released back to the inbox | 5 | After the injected walk error, every envelope the walk drained is a `.json` file in the inbox again. | diff-local |
| Story 2 negative: Given the claim lease cannot be acquired because its owner metadata is invalid or ambiguous, when the operator runs `compose claim`, then the claim fails closed with a non-zero exit naming the lease problem and never walks without the lease | 6 | When `inbox.lease` holds invalid owner metadata, `claim` exits 1 with stderr naming the intake claim lease problem, the injected gh runner receives no call, and no inbox file is renamed. | diff-local |
| Story 3 happy: Given an inbox holding a claimed envelope with a `pending` ledger entry, one with a `done` ledger entry, and one with no ledger entry, when the operator runs `compose claim`, then only the `pending` one returns to the claimable state and the other two stay claimed byte-for-byte | 7 | Seeding `.claimed` envelopes with `pending`, `claimed`, `done` and absent ledger entries, `claim` returns only the `pending` one to `.json`, and the `claimed`, `done` and absent envelopes remain byte-identical `.claimed` files. | diff-local |
| Story 3 happy: Given recovery runs, when it inspects ledger state, then it reads ledger entries without changing any entry's status, attempts or timestamps | 7 | When a claim run's only effects are recovery and an `empty` or `all-blocked` outcome, `ledger.json` is byte-identical before and after the claim. | diff-local |
| Story 3 negative: Given a claimed envelope whose ledger entry is `claimed` (a session already holds it), when the operator runs `compose claim`, then that envelope is not recovered by strand reconciliation and stale-claim reaping of `claimed` entries behaves exactly as before | 7 | Stale-claim reaping of `claimed` ledger entries is unchanged: `engineer-cli-claim-stale-reap.acceptance.test.ts` passes unmodified. | diff-local |
| Story 3 negative: Given a claimed envelope whose ledger entry is `done`, when the operator runs `compose claim`, then it is neither recovered nor handed out | 7 | The `claimed`- and `done`-ledger envelopes' sourceRefs never appear in the claim JSON or in the refs passed to the label read. | diff-local |
| Story 3 negative: Given the intake ledger is corrupt, when the operator runs `compose claim`, then the claim fails closed with the existing corrupt-ledger error before any envelope is recovered or renamed | 6 | With an unparseable `ledger.json` and seeded strands, `claim` exits non-zero with the existing corrupt-ledger error and every seeded `.claimed` file is still `.claimed`. | diff-local |

## Architecture Obligation Coverage

All ten citable decisions of the two amended ADRs are dispositioned.

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-011-async-intake-queue-and-github-source#D1 | no-change | none | The IntakeSource capture interface and poll() are untouched; reconciliation and the claim lease live entirely on the claim path. |
| adr-011-async-intake-queue-and-github-source#D2 | no-change | none | The github-issues adapter, its gh issue list polling and Envelope shape are untouched. |
| adr-011-async-intake-queue-and-github-source#D3 | task | task-2 | The `IntakeQueue` port type is unchanged and the existing queue unit and acceptance tests pass unmodified. |
| adr-011-async-intake-queue-and-github-source#D4 | task | task-1 | `claim-lease.ts` imports `createConductStateLease` from `conduct-state-lease.ts` and does not import `daemon-lock.ts`. |
| adr-011-async-intake-queue-and-github-source#D5 | no-change | none | Poll-on-launch and the standalone poll subcommand are untouched; only the claim command changes. |
| adr-011-async-intake-queue-and-github-source#D6 | task | task-4, task-5 | When the hold outlasts the injected wait bound, `claim` exits 1, stderr contains `claim in progress` and the holder pid |
| adr-2026-07-10-intake-claim-priority-banding#D1 | no-change | none | claimUnblocked ordering inside the walk is unchanged; the walk now merely runs after reconciliation under the claim lease. |
| adr-2026-07-10-intake-claim-priority-banding#D2 | no-change | none | Claim-time band resolution from issue labels via resolveClaimBands is unchanged. |
| adr-2026-07-10-intake-claim-priority-banding#D3 | no-change | none | Fail-open to receivedAt FIFO on a label-reader throw is unchanged. |
| adr-2026-07-10-intake-claim-priority-banding#D4 | no-change | none | The shared backlog-priority.ts band vocabulary is unchanged. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
