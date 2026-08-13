# Stories: Harden Intake Ledger Durability

**Status:** Accepted

**Source:** intake jstoup111/ai-conductor#1476
**Track:** technical — no PRD; acceptance criteria live here. The `**Requirement:**` tag on each
story cites the decision clause of `adr-2026-08-12-fail-closed-intake-ledger-durability`
(`ADR-D1`…`ADR-D7`) or a condition of
`architecture-review-2026-08-12-harden-intake-ledger-durability` (`AR-C2`…`AR-C5`) it derives
from, plus the desired outcome from the source issue (`O1`…`O5`) it serves.

**Desired outcomes from the source issue:**

- **O1** — A ledger file that exists but does not parse is never treated as an empty ledger, and
  never overwritten by the next mutation.
- **O2** — After an unparseable ledger is encountered, the original bytes are still recoverable.
- **O3** — The operator learns that a corrupt ledger was encountered, at the time it is
  encountered, rather than inferring it later from duplicate work.
- **O4** — Concurrent mutations from separate processes do not lose each other's writes: with N
  processes each adding a distinct entry, all N entries are present afterward.
- **O5** — A legitimately absent ledger (first run) still starts empty with no warning and no
  error.

---

## Story 1: An absent ledger still starts empty and silent

**Requirement:** ADR-D1 (O5)

As an operator running the engineer for the first time in a fresh repository, I want an absent
`ledger.json` to be treated as an empty ledger with no warning and no error, so that hardening the
corrupt case does not turn ordinary first-run into a failure.

### Acceptance Criteria

#### Happy Path
- Given `.engineer/ledger.json` does not exist, when `known(source, ref)` is called, then it
  resolves `false` and nothing is written to stderr.
- Given `.engineer/ledger.json` does not exist, when `list()` is called, then it resolves to an
  empty array and the process exit code is unaffected.
- Given `.engineer/ledger.json` does not exist, when `record({source, ref})` is called, then the
  file is created containing exactly that one entry with `status: 'pending'` and `attempts: 0`.
- Given `.engineer/` itself does not exist, when `record(...)` is called, then the parent directory
  is created and the write succeeds.

#### Negative Paths
- Given `.engineer/ledger.json` does not exist, when any ledger method is called, then **no**
  `ledger.json.corrupt-*` file is created — absence must not be mistaken for corruption.
- Given `.engineer/ledger.json` does not exist, when any ledger method is called, then stderr
  receives no corrupt-ledger warning text.
- Given `.engineer/ledger.json` exists and contains the two bytes `{}`, when `list()` is called,
  then it resolves to an empty array with no warning — a validly-empty ledger is not corruption.
- Given the parent directory exists but is read-only, when `record(...)` is called, then the
  operation rejects with the underlying filesystem error and no partial or zero-length
  `ledger.json` is left behind.

### Done When
- [ ] A test asserts `list()` on a nonexistent path resolves `[]` with an empty captured stderr.
- [ ] A test asserts no file matching `ledger.json.corrupt-*` exists in the directory after any
      method is called against a nonexistent ledger.
- [ ] A test asserts a `{}` ledger file is read as empty and produces no warning.
- [ ] A test asserts a read-only parent directory causes a rejection and leaves no `ledger.json`.

---

## Story 2: An unparseable ledger refuses the mutation instead of overwriting it

**Requirement:** ADR-D1, ADR-D2 (O1)

As an operator whose `ledger.json` was truncated by a crash, I want the next mutating operation to
refuse rather than to succeed against an empty store, so that the intake dedup authority is never
durably replaced with `{}`.

### Acceptance Criteria

#### Happy Path
- Given `ledger.json` contains bytes that are not valid JSON, when `record({source, ref})` is
  called, then the returned promise rejects, and `ledger.json`'s bytes are byte-for-byte identical
  to what they were before the call.
- Given the same, when `transition(...)` is called, then it rejects and `ledger.json` is unchanged.
- Given the same, when `forget(...)`, `reopen(...)`, or `requeueClaimed(...)` is called, then each
  rejects and `ledger.json` is unchanged.
- Given the same, when the mutation is retried a second and third time, then each attempt rejects
  identically and `ledger.json` is still unchanged — the refusal is idempotent.

#### Negative Paths
- Given `ledger.json` contains valid JSON that is not an object (e.g. `[]`, `"text"`, `42`, `null`),
  when a mutation is attempted, then it is treated as corrupt and refused — parsing successfully is
  not sufficient, the shape must be a ledger store.
- Given `ledger.json` contains a valid object whose values are not ledger entries, when a mutation
  is attempted, then it is refused rather than silently coercing or dropping the malformed values.
- Given `ledger.json` is corrupt, when the mutation is refused, then **no** `ledger.json.tmp.*`
  file remains in the directory — the atomic-write temp path is never entered.
- Given `ledger.json` is corrupt and a mutation has just been refused, when the operator repairs
  the file to valid JSON and retries, then the mutation succeeds normally with no residual state
  from the failed attempts.

### Done When
- [ ] A test asserts that for each of the five mutating methods, a corrupt ledger causes rejection
      and a byte-identical file afterward (compare a hash taken before and after).
- [ ] A test asserts each of `[]`, `"text"`, `42`, `null`, and a wrong-shaped object is refused.
- [ ] A test asserts no `ledger.json.tmp.*` residue exists after a refused mutation.
- [ ] A test asserts a repair-then-retry succeeds.

---

## Story 3: The original bytes survive as a quarantine copy

**Requirement:** ADR-D3 (O2)

As an operator recovering from a corrupt ledger, I want the original bytes preserved beside the
ledger, so that I can inspect or salvage the lost entries rather than losing them permanently.

### Acceptance Criteria

#### Happy Path
- Given `ledger.json` contains corrupt bytes, when a mutation encounters it, then a file named
  `ledger.json.corrupt-<timestamp>` exists in the same directory whose contents are byte-for-byte
  identical to the corrupt `ledger.json`.
- Given the same, when the quarantine copy is written, then `ledger.json` **still exists** at its
  original path with its original bytes — the quarantine is a copy, not a rename.
- Given a corrupt ledger has already been quarantined and its bytes are unchanged, when a further
  operation encounters the same corrupt state, then it still refuses, but reuses the existing
  quarantine rather than writing another copy.
- Given a ledger is repaired and then becomes corrupt again with **different** bytes, when the new
  corruption is encountered, then a new, distinctly-named quarantine file is written and the
  earlier one is not overwritten.

> **Amended 2026-08-12 by #1476 (conflict-check resolution A):** the original criterion here read
> *"Given a corrupt ledger is encountered twice at distinguishable times, when both encounters
> complete, then two distinctly-named quarantine files exist and neither has overwritten the
> other."* That is preserved above in its corrected form. Taken literally it degraded Story 5's
> requirement that the intake loop not accumulate quarantine files on every poll interval: a
> long-running loop encounters the same corrupt state repeatedly, and one quarantine per encounter
> is unbounded. The resolution is **once per corruption episode** — quarantine is keyed to the
> corrupt byte-state, so re-encountering the *same* corruption reuses the existing copy while a
> *new* corruption still gets its own. Nothing about the refusal itself is relaxed.

#### Negative Paths
- Given a corrupt ledger, when a second process encounters it immediately after the first, then
  that second process also finds `ledger.json` present (not absent) and refuses — it must not take
  the first-run path of Story 1 and start from an empty store.
- Given a corrupt ledger and a quarantine file that already exists for the same timestamp, when a
  new encounter occurs, then the existing quarantine file is not truncated or overwritten; a
  distinct name is used.
- Given a corrupt ledger and a directory that cannot be written to, when the quarantine copy fails,
  then the mutation still refuses (it never falls through to succeeding), and the quarantine
  failure is reported alongside the corruption rather than masking it.
- Given a corrupt ledger of non-trivial size, when it is quarantined, then the copy is complete —
  no truncated partial copy is left if the process is interrupted mid-copy.

### Done When
- [ ] A test asserts the quarantine file's bytes equal the original corrupt bytes.
- [ ] A test asserts `ledger.json` still exists with unchanged bytes after quarantine.
- [ ] A test asserts two encounters produce two distinct quarantine files.
- [ ] A test asserts a second reader sees `ledger.json` present and refuses rather than starting
      empty.
- [ ] A test asserts an unwritable directory yields a refusal that reports both the corruption and
      the quarantine failure.

---

## Story 4: The operator is told at the moment of the corrupt read

**Requirement:** ADR-D4 (O3)

As an operator, I want a corrupt ledger to announce itself on the failing command, so that I act on
it immediately instead of inferring it days later from duplicate spec PRs.

### Acceptance Criteria

#### Happy Path
- Given a corrupt `ledger.json`, when any `conduct-ts engineer` verb that mutates the ledger is
  run, then stderr contains a warning naming **both** the ledger path and the quarantine path.
- Given the same, when the verb completes, then its process exit code is non-zero.
- Given the same, when the warning is emitted, then it states that the ledger was not modified, so
  the operator knows no data was destroyed by the refusal itself.

#### Negative Paths
- Given a corrupt ledger, when the failing verb writes its warning, then the warning goes to
  **stderr**, not stdout — the JSON-emitting verbs (`claim`, `worktree`, `land`, `handoff`) must
  keep stdout parseable for their callers.
- Given a corrupt ledger, when `conduct-ts engineer claim` is run, then it does **not** print a
  success-shaped `{"kind":"claim",...}` payload on stdout — a caller must not be able to mistake a
  corrupt-ledger failure for an empty queue.
- Given a corrupt ledger, when a verb fails, then the message contains no issue body text or other
  untrusted content copied verbatim from the ledger — the diagnostic names paths, not payloads.
- Given a healthy ledger, when any verb runs, then no corrupt-ledger warning appears on stderr —
  the warning must not be emitted speculatively.

### Done When
- [ ] A test asserts the stderr warning contains both the ledger path and the quarantine path.
- [ ] A test asserts a non-zero exit code from a ledger-mutating verb against a corrupt ledger.
- [ ] A test asserts stdout carries no `{"kind":"claim"` payload when the ledger is corrupt.
- [ ] A test asserts the warning text contains no ledger entry content.

---

## Story 5: A corrupt ledger escapes the intake loop's per-envelope error isolation

**Requirement:** ADR-D4, AR-C3 (O3)

As an operator running the long-lived engineer intake loop, I want a corrupt-ledger failure to
surface rather than be swallowed by the per-envelope catch, while a genuinely malformed single
envelope still stays isolated, so that the loop keeps its resilience without hiding data loss.

### Acceptance Criteria

#### Happy Path
- Given the intake loop polls a source that returns three well-formed envelopes and the ledger is
  corrupt, when the loop processes them, then the corrupt-ledger condition is reported to the
  operator rather than silently absorbed.
- Given the intake loop polls a source returning three envelopes, one of which fails to enqueue for
  a reason unrelated to the ledger, when the loop processes them, then the other two are still
  recorded and enqueued — per-envelope isolation is preserved.
- Given a healthy ledger, when the loop runs a full poll cycle, then behavior is unchanged from
  before this feature.

#### Negative Paths
- Given a corrupt ledger, when the loop's capture phase encounters it, then the loop does **not**
  continue silently enqueueing envelopes whose ledger entries were never recorded — a queued
  envelope with no ledger entry is the duplicate-processing bug this whole feature exists to
  prevent.
- Given a corrupt ledger, when the loop reports it, then the loop does not enter a tight retry
  spin re-encountering and re-quarantining the same corrupt file on every poll interval: the
  operator-facing warning is emitted **once per corruption episode**, not once per poll, and the
  quarantine copy is reused per Story 3.
- Given the loop has reported a corruption episode and the ledger is subsequently repaired, when
  the next poll runs, then normal operation resumes without operator intervention and a later,
  distinct corruption is reported as a new episode.
- Given a source whose `poll()` throws, when the loop runs, then that source's failure is still
  isolated and reported without being confused for a ledger failure.
- Given a corrupt ledger, when the loop's claim phase would otherwise dispatch an idea to DECIDE,
  then no idea is dispatched — dispatching against an unknown dedup state risks a duplicate spec PR.

### Done When
- [ ] A test asserts a corrupt ledger during the capture phase produces an operator-visible report
      and is not absorbed by the per-envelope catch.
- [ ] A test asserts a single failing envelope leaves the other envelopes recorded and enqueued.
- [ ] A test asserts no envelope is enqueued whose ledger `record()` did not succeed.
- [ ] A test asserts no idea is dispatched to DECIDE while the ledger is corrupt.
- [ ] A test asserts a repeated poll against a still-corrupt ledger does not produce unbounded
      quarantine files or a spin.

---

## Story 6: Concurrent mutations from separate processes are additive

**Requirement:** ADR-D5 (O4)

As an operator running CLI verbs while the intake loop is live, I want each process's ledger write
to survive the others, so that a claim, a write-back, and a capture happening together do not
silently erase one another.

> **Scope note (verified 2026-08-12):** the ledger is **not** per-project. `resolveEngineerDir`
> (`src/conductor/src/engine/engineer-store.ts:185-193`) resolves to `$AI_CONDUCTOR_ENGINEER_DIR`,
> defaulting to `~/.ai-conductor/engineer/`. Every registered project's engineer verbs and every
> engineer loop on the machine therefore contend on **one** `ledger.json`. Tests for this story
> must not assume a single project's process set.

### Acceptance Criteria

#### Happy Path
- Given N separate processes each calling `record()` for a distinct `(source, sourceRef)` against
  the same ledger path concurrently, when all N have completed, then all N entries are present in
  `ledger.json`.
- Given two processes concurrently calling `transition()` on two different entries, when both
  complete, then both transitions are reflected and neither entry has been reverted.
- Given one process holding the lease mid-mutation, when a second process begins a mutation, then
  the second waits and then observes the first's committed state as its starting point.
- Given a mutation completes, when it returns, then the lease it held has been released and a
  subsequent operation acquires without delay.

#### Negative Paths
- Given a process is killed while holding the lease, when a later process attempts a mutation, then
  the stale lease is recovered after the owner is confirmed dead and the mutation proceeds — a
  crash must not wedge intake permanently.
- Given a lease whose owner process is **still alive** and holding it beyond the acquire timeout,
  when another process attempts a mutation, then that process fails with a clear lease-timeout
  message naming the owning pid, rather than proceeding unguarded or hanging indefinitely.
- Given a lease cannot be acquired, when the mutation fails, then `ledger.json` is not written at
  all — failing closed, per the precedent in `adr-2026-08-01-conduct-state-mutation-port`.
- Given two processes concurrently calling `record()` for the **same** `(source, sourceRef)`, when
  both complete, then exactly one entry exists and its `capturedAt` is not overwritten by the
  second — `record` remains idempotent under concurrency.
- Given a process crashes between acquiring the lease and writing, when recovery occurs, then
  `ledger.json` holds the last fully-written state — no torn or partially-written ledger is
  observable.

### Done When
- [ ] A test spawns N ≥ 3 concurrent mutations for distinct refs and asserts all N entries exist.
- [ ] A test asserts a second mutator observes the first's committed state, not a stale snapshot.
- [ ] A test asserts a dead lease owner is recovered and the mutation proceeds.
- [ ] A test asserts a live lease owner past timeout yields a lease-timeout failure naming the pid,
      and that `ledger.json` is unmodified.
- [ ] A test asserts concurrent same-ref `record()` produces exactly one entry with a stable
      `capturedAt`.

---

## Story 7: Read-only ledger methods never observe a torn state

**Requirement:** ADR-D5

As a caller of `known`, `get`, or `list`, I want reads to be serialized against writes, so that a
dedup decision is never made against a half-written ledger.

> **Contention note (conflict-check resolution B, 2026-08-12):** `known()` sits on the intake
> poll hot path, and the ledger is a machine-wide cross-repo singleton (see Story 6's scope note),
> so lock-acquiring reads serialize the loop against every engineer CLI verb on the host. The
> operator accepted this cost: ledger operations are per-idea rather than per-request, so the
> contention is bounded, and a torn read of the dedup authority is the worse failure. The
> alternative considered and rejected was lock-free reads relying on `saveStore`'s atomic
> tmp+rename; it would have required amending `ADR-D5`.

### Acceptance Criteria

#### Happy Path
- Given a write is in progress under the lease, when `list()` is called from another process, then
  it returns either the complete pre-write state or the complete post-write state, never a mixture.
- Given no write is in progress, when `get()` is called, then it returns the entry without
  measurable added latency beyond lease acquisition.
- Given a read completes, when it returns, then the lease is released — a read must not leave the
  lease held.

#### Negative Paths
- Given a corrupt ledger, when `list()` or `get()` is called, then it refuses in the same way a
  mutation does rather than returning an empty result that a caller would read as "no entries".
- Given a read is refused for corruption, when it refuses, then no quarantine-plus-write side
  effect makes the read behave like a mutation on disk beyond the quarantine copy itself.
- Given a lease cannot be acquired within the timeout, when `list()` is called, then it fails with
  the lease error rather than falling back to an unguarded read — an operator inspecting a wedged
  system gets a truthful error, not a possibly-torn listing.
- Given the read-only path holds the lease, when a mutation is attempted concurrently, then the
  mutation waits rather than failing immediately, so inspection does not spuriously break intake.

### Done When
- [ ] A test asserts `list()` under a concurrent write returns a complete state, never a mixture.
- [ ] A test asserts `list()` and `get()` refuse on a corrupt ledger rather than returning empty.
- [ ] A test asserts a read releases its lease (a following mutation acquires immediately).
- [ ] A test asserts a lease timeout on a read surfaces as a lease error.

---

## Story 8: Lease diagnostics identify the store they guard

**Requirement:** AR-C2

As an operator reading a lease failure, I want the message to name the intake ledger when the
intake ledger is what failed, so that I am not sent to look at conduct-state.

### Acceptance Criteria

#### Happy Path
- Given the intake ledger's lease cannot be acquired, when the failure message is produced, then it
  identifies the intake ledger (by path or by store name) and does not describe itself as a
  conduct-state lease.
- Given the conduct-state store's lease cannot be acquired, when the failure message is produced,
  then it still identifies conduct-state exactly as it does today — the existing consumer's
  diagnostics do not regress.
- Given a stale-owner recovery occurs, when its diagnostic is emitted, then it names which store's
  lease was recovered.

#### Negative Paths
- Given the primitive is generalized, when the existing `filesystem-conduct-state-store` tests run,
  then they pass unchanged in behavior — generalization must not be a breaking change to the
  current consumer.
- Given a lease error message is constructed, when it is emitted, then it contains no ledger entry
  content or issue text — paths and store identity only.
- Given both stores are in use in the same process, when both emit lease diagnostics, then the two
  are distinguishable from each other in the output.

### Done When
- [ ] A test asserts an intake-ledger lease failure message names the intake ledger and not
      conduct-state.
- [ ] A test asserts the conduct-state lease failure message is unchanged.
- [ ] The existing `conduct-state-lease` and `filesystem-conduct-state-store` test suites pass.

---

## Story 9: Ledger artifacts resolve to the configured engineer directory

**Requirement:** ADR-D3, ADR-D6

As an operator who has pointed `AI_CONDUCTOR_ENGINEER_DIR` somewhere non-default, I want the lease
and quarantine artifacts to follow the ledger to that directory, so that hardening does not scatter
lock or recovery state into an unexpected location.

> This story replaces an earlier one that asserted git-ignore rules for these artifacts. That
> story rested on a false premise — the engineer directory is user-global
> (`~/.ai-conductor/engineer/` by default), not repo-relative, so no ignore rule is applicable.
> See the withdrawn Condition 5 in
> `.docs/decisions/architecture-review-2026-08-12-harden-intake-ledger-durability.md`.

### Acceptance Criteria

#### Happy Path
- Given `AI_CONDUCTOR_ENGINEER_DIR` is set to a temporary directory, when a mutation acquires the
  lease, then the lease directory is created inside that same directory, adjacent to `ledger.json`.
- Given the same, when a corrupt ledger is quarantined, then the quarantine copy is written to that
  same directory and not to the default `~/.ai-conductor/engineer/`.
- Given `AI_CONDUCTOR_ENGINEER_DIR` is unset, when a mutation runs, then the artifacts resolve
  beneath `~/.ai-conductor/engineer/`, matching the ledger's own resolution.

#### Negative Paths
- Given `AI_CONDUCTOR_ENGINEER_DIR` is set to a path that does not yet exist, when a mutation runs,
  then the directory is created (as the ledger's own write path already does) rather than the
  operation failing or silently falling back to the default location.
- Given `AI_CONDUCTOR_ENGINEER_DIR` is set to an empty or whitespace-only string, when the
  directory is resolved, then the default is used — matching the existing `resolveEngineerDir`
  behavior, which must not regress.
- Given two test runs use two different `AI_CONDUCTOR_ENGINEER_DIR` values concurrently, when both
  mutate their own ledgers, then neither contends on the other's lease — the lease path must be
  derived from the ledger path, never from a fixed global location.

### Done When
- [ ] A test asserts the lease directory is created adjacent to the ledger under a custom
      `AI_CONDUCTOR_ENGINEER_DIR`.
- [ ] A test asserts the quarantine copy lands in the custom directory, not the default.
- [ ] A test asserts two distinct engineer directories do not contend on one another's lease.
- [ ] A test asserts an empty `AI_CONDUCTOR_ENGINEER_DIR` still falls back to the default.
