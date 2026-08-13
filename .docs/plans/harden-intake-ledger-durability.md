# Implementation Plan: Harden the intake ledger against corrupt-read wipe and concurrent write loss

**Date:** 2026-08-12
**Stories:** .docs/stories/harden-intake-ledger-durability.md
**Conflict check:** Clean as of 2026-08-12

## Summary

Makes `intake/ledger.ts` distinguish an absent ledger from an unparseable one, refuse rather than
overwrite on the latter while preserving the original bytes, and serialize every read-modify-write
with the existing `conduct-state-lease` primitive. 18 tasks.

## Technical Approach

Two independent properties of one file, both landing behind an unchanged `Ledger` interface.

**The load discriminator (Tasks 1–6).** `loadStore` (`intake/ledger.ts:94-102`) today catches every
error and returns `{}`. It is replaced by a function returning a discriminated result —
`{kind:'absent'} | {kind:'ok', store} | {kind:'corrupt', bytes, reason}` — where `absent` is the
`ENOENT` case only. Everything else that fails to yield a ledger-shaped object is `corrupt`:
`JSON.parse` throwing, and also parses that *succeed* into a non-object (`[]`, `"text"`, `42`,
`null`) or an object whose values are not ledger entries. That shape check matters because
`JSON.parse('[]')` succeeds and `'0' in []` is `false`, so an array ledger would read as a valid
empty store and be persisted over — the wipe by a second route.

A `corrupt` result is never converted into an empty store. It is raised as a typed
`CorruptLedgerError` carrying both paths, so `saveStore` is structurally unreachable on that path.

**Quarantine by copy, keyed to the episode (Tasks 4–6).** On the first `corrupt` result the raw
bytes are copied — not renamed — to `«ledgerPath».corrupt-«timestamp»`, leaving `ledger.json` in
place so a racing process still sees a present-but-corrupt file rather than taking the absent
branch. Repeated encounters of the *same* corrupt bytes reuse the existing copy (conflict-check
resolution A): the episode key is a digest of the corrupt bytes, recorded alongside the quarantine
path, so a poll loop cannot accumulate one file per interval. A quarantine write that itself fails
must not mask the corruption — the refusal still happens and both failures are reported.

**The lease (Tasks 7–15).** `conduct-state-lease.ts` is already generic over a path
(`«statePath».lease`, mkdir-atomic, owner metadata, liveness probe, stale-owner recovery) and is
imported by exactly one consumer. It gains a caller-supplied label so its diagnostics name the
store they guard — reused verbatim it would tell an operator that a *conduct-state* lease failed
when the intake ledger is what failed. Its existing consumer keeps today's wording.

A `withLedgerLease` wrapper then brackets acquire → load → mutate → save → release, mirroring
`filesystem-conduct-state-store.ts:133-143`. **All eight** `Ledger` methods route through it,
reads included (ADR D5, affirmed by conflict-check resolution B), so no caller observes a torn
state. An unacquirable or unrecoverable lease fails the operation rather than proceeding
unguarded, matching `adr-2026-08-01-conduct-state-mutation-port`.

**Call-site behavior (Tasks 16–18).** The `Ledger` method signatures do not change, so the 7
`createLedger` sites in `engineer-cli.ts` need no rewiring — only their failure surface is
verified: stderr carries the warning, stdout stays clean of a success-shaped payload, exit is
non-zero. `engineer/loop.ts:258-267` is the one place that must change: its bare `catch {}` is
scoped to genuinely per-envelope failures so a `CorruptLedgerError` escapes and is reported once
per episode, and no idea is dispatched to DECIDE while the dedup authority is unreadable.

**Sequencing.** Tasks 1–6 and Task 7 are independent and can proceed in parallel; Task 8 needs
both. Everything after Task 9 depends on the wrapper existing.

**Not in this plan.** The operator recovery runbook required by architecture-review Condition 1 is
documentation and is therefore excluded from plan tasks by the plan skill's documentation
boundary; this repository's `maintain-documentation` custom step owns it, and CLAUDE.md requires
it to land in the same PR. Review Condition 5 was withdrawn during DECIDE — the engineer directory
is `~/.ai-conductor/engineer/`, outside any working tree, so no ignore rule applies.

## Prerequisites

- None. No migration, no new dependency, no config key. The on-disk ledger format is unchanged.

## Tasks

### Task 1: Introduce the typed corrupt-ledger error
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: `CorruptLedgerError` is an `Error` subclass exposing `ledgerPath` and a
   non-empty `reason`, and is distinguishable from a plain `Error` by an `instanceof` check.
2. Verify test fails (RED)
3. Implement: declare and export `CorruptLedgerError` in `intake/ledger.ts`.
4. Verify test passes (GREEN)
5. Commit with message: "add typed CorruptLedgerError for the intake ledger"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — new error class
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — error shape test

**Dependencies:** none

### Task 2: Separate an absent ledger from an unreadable one
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: the load helper returns `{kind:'absent'}` for a nonexistent path and
   `{kind:'ok'}` with the parsed store for a valid one, including a `{}` file which is validly
   empty rather than corrupt; an absent ledger produces no quarantine file and no stderr warning;
   and a read failure that is not `ENOENT` (an unreadable parent directory) rejects rather than
   silently yielding an empty store.
2. Verify test fails (RED)
3. Implement: replace `loadStore`'s blanket `catch` with an `ENOENT` check that yields `absent`;
   every other read failure and every parse failure yields `corrupt`.
4. Verify test passes (GREEN)
5. Commit with message: "distinguish absent from unreadable in the intake ledger load path"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — discriminated load result
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — absent/ok cases

**Dependencies:** Task 1

### Task 3: Treat a valid-JSON non-store as corrupt
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: each of `[]`, `"text"`, `42`, `null`, and `{"k":{"no":"entry"}}` yields a
   `corrupt` load result rather than an empty or coerced store.
2. Verify test fails (RED)
3. Implement: add a ledger-shape predicate after `JSON.parse` — the value must be a non-null,
   non-array object whose values carry the required `LedgerEntry` fields.
4. Verify test passes (GREEN)
5. Commit with message: "reject valid-JSON non-store ledger contents as corrupt"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — shape predicate
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — malformed-shape cases

**Dependencies:** Task 2

### Task 4: Copy the corrupt bytes aside, leaving the ledger in place
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: after a corrupt load, a `«ledger».corrupt-«timestamp»` file exists whose
   bytes equal the original, and `ledger.json` still exists with unchanged bytes.
2. Verify test fails (RED)
3. Implement: on a `corrupt` result, copy (never rename) the raw bytes to a timestamped sibling
   path in the ledger's own directory before raising `CorruptLedgerError`.
4. Verify test passes (GREEN)
5. Commit with message: "quarantine corrupt intake ledger bytes by copy"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — quarantine copy
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — quarantine assertions

**Dependencies:** Task 3

### Task 5: Reuse the quarantine for an unchanged corruption episode
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: three consecutive operations against the same corrupt bytes produce exactly
   one quarantine file; a subsequent *different* corruption produces a second, distinct one.
2. Verify test fails (RED)
3. Implement: key the quarantine on a digest of the corrupt bytes and skip the copy when a
   quarantine for that digest already exists.
4. Verify test passes (GREEN)
5. Commit with message: "key intake ledger quarantine to the corruption episode"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — episode keying
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — episode reuse cases

**Dependencies:** Task 4

### Task 6: Report a failed quarantine without masking the corruption
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: when the quarantine copy cannot be written, the operation still rejects with
   a `CorruptLedgerError` whose message names both the corruption and the quarantine failure, and
   `ledger.json` is untouched.
2. Verify test fails (RED)
3. Implement: wrap the quarantine copy so its failure is attached to the corruption error rather
   than replacing or suppressing it.
4. Verify test passes (GREEN)
5. Commit with message: "surface quarantine failures alongside ledger corruption"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — quarantine error composition
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — unwritable-directory case

**Dependencies:** Task 5

### Task 7: Let the lease name the store it guards
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing test: a lease created with a store label emits that label in its acquire-failure
   and stale-recovery messages; a lease created without one keeps today's conduct-state wording.
2. Verify test fails (RED)
3. Implement: add an optional store-label option to `createConductStateLease` and interpolate it
   into the failure and diagnostic messages, defaulting to the current text.
4. Verify test passes (GREEN)
5. Commit with message: "let the conduct-state lease identify the store it guards"

**Files likely touched:**
- `src/conductor/src/engine/conduct-state-lease.ts` — optional store label
- `src/conductor/test/engine/conduct-state-lease.test.ts` — labelled and default messages

**Dependencies:** none

### Task 8: Add the lease-bracketed mutation wrapper
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing test: the wrapper acquires before the load, releases after the save, and releases
   even when the wrapped body throws.
2. Verify test fails (RED)
3. Implement: add `withLedgerLease` to `intake/ledger.ts`, taking the lease as an injectable
   dependency defaulting to `createConductStateLease(ledgerPath, {label})`.
4. Verify test passes (GREEN)
5. Commit with message: "add the lease-bracketed wrapper for intake ledger access"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — wrapper and lease injection
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — acquire/release ordering

**Dependencies:** Task 2, Task 7

### Task 9: Route the five mutating methods through the wrapper
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: for each of `record`, `transition`, `forget`, `reopen`, `requeueClaimed`, a
   corrupt ledger causes rejection and a byte-identical file afterward (hash before and after).
2. Verify test fails (RED)
3. Implement: wrap each mutating method body in `withLedgerLease` and let `CorruptLedgerError`
   propagate so `saveStore` is unreachable.
4. Verify test passes (GREEN)
5. Commit with message: "route intake ledger mutations through the lease wrapper"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — mutating methods
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — per-method refusal tests

**Dependencies:** Task 8

### Task 10: Leave no temp-file residue behind a refused mutation
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: after a refused mutation no `ledger.json.tmp.*` file remains, and a
   repair-then-retry succeeds with no residual state from the failed attempts.
2. Verify test fails (RED)
3. Implement: confirm the corrupt path returns before `saveStore`; add cleanup if any temp path is
   reachable.
4. Verify test passes (GREEN)
5. Commit with message: "assert no temp residue after a refused ledger mutation"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — refusal ordering
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — residue and retry cases

**Dependencies:** Task 9

### Task 11: Route the three read methods through the wrapper
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: `known`, `get`, and `list` each refuse on a corrupt ledger rather than
   returning `false`/`undefined`/`[]`; each releases the lease so a following mutation acquires
   immediately; a mutation attempted while a read holds the lease **waits** rather than failing
   immediately; and a `list()` issued during a concurrent write returns a complete state, never a
   mixture of pre- and post-write entries.
2. Verify test fails (RED)
3. Implement: wrap the three read methods in `withLedgerLease`.
4. Verify test passes (GREEN)
5. Commit with message: "serialize intake ledger reads under the lease"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — read methods
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — read refusal and release

**Dependencies:** Task 9

### Task 12: Fail closed when the lease cannot be acquired
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: with a lease stub that refuses to acquire, a mutation rejects with a lease
   error naming the intake ledger and `ledger.json` is unmodified; a read fails the same way rather
   than falling back to an unguarded read.
2. Verify test fails (RED)
3. Implement: convert an unsuccessful acquire into a thrown lease error before any file access.
4. Verify test passes (GREEN)
5. Commit with message: "fail closed when the intake ledger lease is unavailable"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — acquire failure path
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — refusing-lease stub

**Dependencies:** Task 11

### Task 13: Recover a dead owner's lease and report a live one
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a lease whose recorded owner pid is not live is recovered and the mutation
   proceeds; a lease held by a live owner past the acquire timeout yields a timeout error naming
   that pid.
2. Verify test fails (RED)
3. Implement: pass the ledger's lease through the primitive's existing recovery path and surface
   the owner pid in the timeout message.
4. Verify test passes (GREEN)
5. Commit with message: "recover stale intake ledger leases and name live holders"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — recovery wiring
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — dead and live owner cases

**Dependencies:** Task 12

### Task 14: Derive the lease and quarantine paths from the ledger path
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing test: with `AI_CONDUCTOR_ENGINEER_DIR` pointed at a temp directory, both the lease
   directory and the quarantine copy are created there and not under the default engineer
   directory; a target directory that does not yet exist is created rather than failing or falling
   back to the default; an empty or whitespace-only `AI_CONDUCTOR_ENGINEER_DIR` still resolves to
   the default, matching existing `resolveEngineerDir` behavior; and two distinct engineer
   directories do not contend on one another's lease.
2. Verify test fails (RED)
3. Implement: derive both artifact paths from the ledger path already passed to `createLedger`,
   with no reference to a fixed location.
4. Verify test passes (GREEN)
5. Commit with message: "derive intake ledger lease and quarantine paths from the ledger path"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — path derivation
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — custom engineer directory

**Dependencies:** Task 13

### Task 15: Prove concurrent mutations are additive across processes
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: an integration test spawning three or more concurrent processes, each
   recording a distinct `(source, sourceRef)` against one ledger path, leaves all entries present;
   concurrent same-ref `record()` leaves exactly one entry with a stable `capturedAt`.
2. Verify test fails (RED)
3. Implement: no new production code expected — the wrapper from Task 8 should satisfy this; add
   only what the test proves missing.
4. Verify test passes (GREEN)
5. Commit with message: "prove concurrent intake ledger writes do not clobber each other"

**Files likely touched:**
- `src/conductor/test/engine/engineer/intake/ledger.acceptance.test.ts` — multi-process test
- `src/conductor/src/engine/engineer/intake/ledger.ts` — only if the test proves a gap

**Dependencies:** Task 14

### Task 16: Surface a corrupt ledger on the failing CLI verb
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: with a corrupt ledger, a ledger-touching `engineer` verb writes a stderr
   warning naming both the ledger and quarantine paths, exits non-zero, prints no
   success-shaped `{"kind":"claim"` payload on stdout, and includes no ledger entry content in the
   message.
2. Verify test fails (RED)
3. Implement: map `CorruptLedgerError` to a stderr diagnostic and a non-zero exit in the engineer
   CLI's error path, keeping stdout reserved for the verbs' JSON contracts.
4. Verify test passes (GREEN)
5. Commit with message: "report a corrupt intake ledger on the failing engineer verb"

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — corrupt-ledger error path
- `src/conductor/test/engine/engineer/engineer-cli-corrupt-ledger.test.ts` — stderr, stdout, and exit-code assertions

**Dependencies:** Task 11

### Task 17: Let a corrupt ledger escape the loop's per-envelope catch
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: with a corrupt ledger, the intake loop reports the condition instead of
   absorbing it, and enqueues no envelope whose `record()` did not succeed; with a healthy ledger
   and one failing envelope, the other envelopes are still recorded and enqueued.
2. Verify test fails (RED)
3. Implement: narrow the `catch {}` at `engineer/loop.ts:258-267` so it absorbs only per-envelope
   failures and rethrows or reports `CorruptLedgerError`; move the enqueue so it cannot run when
   the record failed.
4. Verify test passes (GREEN)
5. Commit with message: "stop the intake loop from swallowing a corrupt ledger"

**Files likely touched:**
- `src/conductor/src/engine/engineer/loop.ts` — capture-phase error handling
- `src/conductor/test/engine/engineer/loop.test.ts` — corrupt and per-envelope cases

**Dependencies:** Task 16

### Task 18: Report the loop's corruption once per episode and stop dispatching
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: repeated poll cycles against the same corrupt ledger warn once, produce no
   additional quarantine files, and dispatch no idea to DECIDE; after the ledger is repaired the
   next cycle resumes normally, and a later distinct corruption warns again as a new episode.
2. Verify test fails (RED)
3. Implement: track the reported episode key for the loop's lifetime, suppress a repeat warning for
   the same key, and skip the claim/dispatch phase while the ledger is unreadable.
4. Verify test passes (GREEN)
5. Commit with message: "report intake ledger corruption once per episode and hold dispatch"

**Files likely touched:**
- `src/conductor/src/engine/engineer/loop.ts` — episode suppression and dispatch hold
- `src/conductor/test/engine/engineer/loop.test.ts` — repeat-poll and repair-resume cases

**Dependencies:** Task 17

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 4 ──▶ Task 5 ──▶ Task 6
              │
Task 7 ───────┴──────▶ Task 8 ──▶ Task 9 ──┬──▶ Task 10
                                            │
                                            └──▶ Task 11 ──▶ Task 12 ──▶ Task 13 ──▶ Task 14 ──▶ Task 15
                                                     │
                                                     └──▶ Task 16 ──▶ Task 17 ──▶ Task 18
```

Tasks 1–6 (the load discriminator and quarantine) and Task 7 (the lease label) are independent
tracks that both feed Task 8.

## Integration Points

- **After Task 9:** a corrupt ledger can be proven, end to end, to leave the file byte-identical —
  the core data-loss defect is closed and independently verifiable.
- **After Task 11:** the full `Ledger` surface is lease-guarded; the interface contract is complete
  and every downstream caller inherits it without change.
- **After Task 15:** the multi-process property the source issue asks for is demonstrable against
  real concurrent processes rather than stubs.
- **After Task 18:** the long-running loop — the one caller that could hide all of this — is
  correct, and the feature is behaviorally complete.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
