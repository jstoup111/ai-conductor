# Implementation Plan: intake claim closed-issue guard + brain reconciliation sweep

**Date:** 2026-07-22
**Design:** `.docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md`
**Stories:** `.docs/stories/intake-claim-closed-issue-guard-and-brain-sweep.md` (TR-1..TR-10)
**Conflict check:** Clean as of 2026-07-22
**Complexity:** M (`.docs/complexity/intake-claim-closed-issue-guard-and-brain-sweep.md`)

## Summary

Stop `engineer claim` from ever handing out a CLOSED GitHub issue (synchronous claim-time
guard) and have the brain periodically reconcile closed issues out of the intake ledger + inbox
(asynchronous sweep). Disposition is `forget` (existing primitive; no new `LedgerStatus`).
18 tasks.

## Technical Approach

Two control points over the shared intake stores (`ledger.json`, `inbox/*.json`):

1. **Claim guard** — `createDeliveryGuardedQueue` (`delivery-guard.ts`) currently returns a
   `pending` candidate via a healthy passthrough at line 136 with **no probe** — the #538 seam.
   Intercept that: for a `github-issues` envelope, parse `sourceRef`, probe issue state via the
   guard's existing `GhRunner` (`gh issue view <n> --json state -q .state`, parsed like
   `verifyPrState`). `closed` → `ledger.forget` + `queue.ack` (drop) + `return this.claim()`
   (continue scan). `open`/`null`/throw → fall through to normal delivery (**fail-safe**: only an
   explicit `closed` drops). Non-`github-issues` or un-parseable `sourceRef` → skip the probe
   entirely.

2. **Brain sweep** — a new `reconcileClosedIssues(deps, { dryRun })`
   (`reconcile-closed-issues.ts`) modeled on `halt-issues/sweep.ts`: enumerate **`pending`**
   `github-issues` ledger entries, per-entry try/catch `getIssueState`, on `closed` →
   `ledger.forget` + drop the matching inbox envelope, accumulate summary counts, no writes under
   `dryRun`. It is wired into `intakeTick` as an **injected effect** (a new optional `reconcile`
   member on `IntakeLoopDeps`) so the pure tick stays I/O-free; the production composition root
   (`dispatchIntakeLoop`, `intake-loop-cli.ts`) supplies the effect bound to the real ledger,
   queue, and a `getIssueState` capability (as `halt-issues/sweep.ts` receives `GhAbstraction`).

Enabling primitives (both stores lack them today):
- `Ledger.list()` — enumerate entries (the ledger interface has no enumerator).
- `IntakeQueue.list()` + `IntakeQueue.remove(e)` — enumerate + remove a *pending* inbox envelope
  by handle (the queue can only `claim/ack/release` today).
- Add `forget` to the guard's minimal `GuardLedger` interface.
- A shared `parseSourceRef` (`owner/repo#n` → `{ repo, issue }` | `null`) used by both surfaces.

Sequencing: shared primitives first (parse helper, ledger/queue enumerators), then the guard,
then the sweep module, then the tick wiring, then reopen verification and docs.

## Prerequisites

- None. No migration, no new dependency, no VERSION bump (pre-v1 lock — CHANGELOG `[Unreleased]`
  only).

## Tasks

### Task 1: Shared `parseSourceRef` helper
**Story:** TR-5 (happy + both malformed negatives)
**Type:** infrastructure

**Steps:**
1. Write failing test: `parseSourceRef('jstoup111/ai-conductor#538')` → `{ repo: 'jstoup111/ai-conductor', issue: '538' }`; `parseSourceRef('owner/repo')` → `null`; `parseSourceRef('owner/repo#abc')` → `null`.
2. Verify RED.
3. Implement `parseSourceRef` in a new small module.
4. Verify GREEN.
5. Commit: "feat(intake): shared parseSourceRef for owner/repo#n"

**Files:**
- `src/conductor/src/engine/engineer/intake/source-ref.ts` — new parse helper
- `src/conductor/test/engine/engineer/intake/source-ref.test.ts` — parse unit tests

**Wired-into:** `src/conductor/src/engine/engineer/intake/delivery-guard.ts#createDeliveryGuardedQueue, src/conductor/src/engine/engineer/intake/reconcile-closed-issues.ts#reconcileClosedIssues`
**Dependencies:** none

### Task 2: `Ledger.list()` enumerator
**Story:** TR-6, TR-7 (sweep needs to enumerate pending entries)
**Type:** infrastructure

**Steps:**
1. Write failing test: seed a ledger with entries of mixed status; `list()` returns all `LedgerEntry` records.
2. Verify RED.
3. Implement `list(): Promise<LedgerEntry[]>` on the `Ledger` interface + `createLedger` (read store, return `Object.values`).
4. Verify GREEN.
5. Commit: "feat(intake): Ledger.list() enumerator"

**Files:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — add `list()` to interface + impl
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — enumerator test

**Wired-into:** `src/conductor/src/engine/engineer/intake/reconcile-closed-issues.ts#reconcileClosedIssues`
**Dependencies:** none

### Task 3: `IntakeQueue.list()` + `remove()` for pending envelopes
**Story:** TR-6 (sweep drops the matching inbox envelope)
**Type:** infrastructure

**Steps:**
1. Write failing test: enqueue two envelopes; `list()` returns both; `remove(e)` unlinks the pending `.json` for `e` so a subsequent `list()` omits it; `remove` of an already-absent envelope is a benign no-op (ENOENT swallowed).
2. Verify RED.
3. Implement `list(): Promise<Envelope[]>` and `remove(e: Envelope): Promise<void>` on `IntakeQueue` + `createFileQueue` (list `.json`, parse; remove unlinks the pending file, ENOENT benign).
4. Verify GREEN.
5. Commit: "feat(intake): IntakeQueue.list()/remove() for pending envelopes"

**Files:**
- `src/conductor/src/engine/engineer/intake/queue.ts` — add `list()` + `remove()` to interface + impl
- `src/conductor/test/engine/engineer/intake/queue.test.ts` — list/remove tests

**Wired-into:** `src/conductor/src/engine/engineer/intake/reconcile-closed-issues.ts#reconcileClosedIssues`
**Dependencies:** none

### Task 4: Add `forget` to the guard's `GuardLedger` interface
**Story:** TR-2 (guard forgets the closed entry)
**Type:** infrastructure

**Steps:**
1. Write failing test (compile-level/behavioral): the guard can call `ledger.forget(source, sourceRef)` through its `GuardLedger` interface.
2. Verify RED.
3. Implement: add `forget(source, sourceRef): Promise<void>` to `GuardLedger` (delivery-guard.ts).
4. Verify GREEN.
5. Commit: "feat(intake): expose forget on GuardLedger"

**Files:**
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — extend `GuardLedger` interface
- `src/conductor/test/engine/engineer/intake/delivery-guard.test.ts` — interface/behavior test

**Wired-into:** same as Task 5
**Dependencies:** none

### Task 5: Claim guard probes issue state for github-issues envelopes (open → deliver)
**Story:** TR-1 (happy) — intercept the `:136` passthrough
**Type:** happy-path

**Steps:**
1. Write failing test: a `pending` github-issues candidate whose issue is OPEN is delivered, and `getIssueState` (via stub `GhRunner`) WAS invoked (probe reached — guards the `:136` regression).
2. Verify RED.
3. Implement: before the healthy passthrough returns a `github-issues` candidate, `parseSourceRef` + probe via `deps.gh` (`gh issue view <n> --json state -q .state`, parse like `verifyPrState`); `open` → deliver.
4. Verify GREEN.
5. Commit: "feat(intake): claim guard probes github issue state (open delivers)"

**Files:**
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — issue-state probe branch
- `src/conductor/test/engine/engineer/intake/delivery-guard.test.ts` — open-delivers test

**Wired-into:** `src/conductor/src/engine/engineer-cli.ts#claim` (guard already wraps the claim queue at `engineer-cli.ts:1015`; this extends an existing branch)
**Dependencies:** 1, 4

### Task 6: Claim guard drops a CLOSED issue and continues scanning
**Story:** TR-2 (happy: closed → forget + ack + continue)
**Type:** happy-path

**Steps:**
1. Write failing test: closed candidate then open candidate → guard calls `ledger.forget` + `queue.ack` on the closed one and returns the OPEN one; closed is never returned.
2. Verify RED.
3. Implement: `closed` branch → `ledger.forget(source, sourceRef)`, `queue.ack(candidate)`, `return this.claim()`.
4. Verify GREEN.
5. Commit: "feat(intake): claim guard drops closed issue and continues scan"

**Files:** same as Task 5
**Wired-into:** same as Task 5
**Dependencies:** 5

### Task 7: Claim guard — closed issue is the last candidate returns null cleanly
**Story:** TR-2 (negative: last candidate closed → null, no crash; ENOENT benign)
**Type:** negative-path

**Steps:**
1. Write failing test: single closed candidate → `claim()` forgets+drops it and returns `null` without throwing; a concurrent already-deleted inbox file (ENOENT on ack) is swallowed as benign.
2. Verify RED.
3. Implement: ensure the closed-branch `return this.claim()` reaches the empty-queue `null` path; wrap `ack` ENOENT as benign (mirror existing guard handling).
4. Verify GREEN.
5. Commit: "test(intake): closed last candidate returns null; ENOENT benign"

**Files:** same as Task 5
**Wired-into:** same as Task 5
**Dependencies:** 6

### Task 8: Claim guard — fail-safe on null/throw issue state
**Story:** TR-3 (null/throw → deliver, no mutation)
**Type:** negative-path

**Steps:**
1. Write failing test: `getIssueState` → `null` delivers the envelope and leaves the ledger bytes unchanged; `getIssueState` throwing yields the same deliver-no-drop outcome.
2. Verify RED.
3. Implement: only an explicit `closed` triggers forget+drop; `unknown`/parse-fail/throw fall through to delivery with zero ledger mutation.
4. Verify GREEN.
5. Commit: "feat(intake): claim guard fails safe on unknown issue state"

**Files:** same as Task 5
**Wired-into:** same as Task 5
**Dependencies:** 6

### Task 9: Claim guard — non-github-issues / malformed ref bypasses the probe
**Story:** TR-4 (source scoping) + TR-5 (malformed ref → skip probe, deliver)
**Type:** negative-path

**Steps:**
1. Write failing test: a non-`github-issues` candidate reaches delivery with zero `getIssueState` calls; a `github-issues` candidate with an un-parseable `sourceRef` is delivered (not dropped) with the probe skipped + a diagnostic logged.
2. Verify RED.
3. Implement: gate the probe on `source === 'github-issues'` && `parseSourceRef !== null`; otherwise existing path unchanged.
4. Verify GREEN.
5. Commit: "feat(intake): scope issue probe to parseable github-issues envelopes"

**Files:** same as Task 5
**Wired-into:** same as Task 5
**Dependencies:** 5

### Task 10: `reconcileClosedIssues` core — forget closed pending entries
**Story:** TR-6 (happy: forget + drop inbox + summary counts)
**Type:** happy-path

**Steps:**
1. Write failing test: pending github-issues entries A(closed), B(open), C(closed) → A,C forgotten + their inbox envelopes removed, B untouched, summary `{ scanned, forgotten: 2 }`.
2. Verify RED.
3. Implement new `reconcileClosedIssues(deps, { dryRun })` modeled on `halt-issues/sweep.ts`: `ledger.list()` → filter `pending` + `github-issues` → per entry `parseSourceRef` + `getIssueState`; `closed` → `ledger.forget` + find matching envelope via `queue.list()` and `queue.remove()`; accumulate counts; return summary.
4. Verify GREEN.
5. Commit: "feat(intake): reconcileClosedIssues sweep core"

**Files:**
- `src/conductor/src/engine/engineer/intake/reconcile-closed-issues.ts` — new sweep module
- `src/conductor/test/engine/engineer/intake/reconcile-closed-issues.test.ts` — core sweep test

**Wired-into:** `src/conductor/src/engine/engineer/intake/intake-loop.ts#intakeTick` (via the injected `reconcile` effect added in Task 15)
**Dependencies:** 1, 2, 3

### Task 11: Sweep touches only `pending` entries
**Story:** TR-7 (status scoping + in-flight protection)
**Type:** negative-path

**Steps:**
1. Write failing test: entries `pending`(closed), `claimed`(closed), `routed`(closed), `done`(closed) → only `pending` forgotten; `claimed`/`routed`/`done` preserved.
2. Verify RED.
3. Implement: filter to `status === 'pending'` before probing.
4. Verify GREEN.
5. Commit: "feat(intake): sweep reconciles pending entries only"

**Files:** same as Task 10
**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 12: Sweep resilience + fail-safe per entry
**Story:** TR-8 (throw mid-batch; null/open untouched; total outage forgets nothing)
**Type:** negative-path

**Steps:**
1. Write failing test: middle entry's `getIssueState` throws → first + third still forgotten, middle intact, error counted, batch not aborted; `null`/`open` entries never forgotten; all-`null` outage forgets nothing.
2. Verify RED.
3. Implement: per-entry try/catch; only explicit `closed` forgets; record error counts.
4. Verify GREEN.
5. Commit: "feat(intake): sweep per-entry resilience + fail-safe"

**Files:** same as Task 10
**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 13: Sweep dry-run
**Story:** TR-9 (dry-run reports, no mutation)
**Type:** negative-path

**Steps:**
1. Write failing test: `{ dryRun: true }` with closed pending entries → summary reports would-forget counts, but `ledger.get` still returns the entries and inbox envelopes remain (no mutation).
2. Verify RED.
3. Implement: under `dryRun`, skip `forget` + `remove`, only accumulate planned counts.
4. Verify GREEN.
5. Commit: "feat(intake): sweep dry-run mode"

**Files:** same as Task 10
**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 14: Sweep idempotence + missing-store handling
**Story:** TR-6 (negative: missing inbox/ledger) + convergent forget
**Type:** negative-path

**Steps:**
1. Write failing test: forgetting an already-absent entry is a no-op; a missing ledger file yields a zero-count summary without error; an already-removed inbox envelope is benign.
2. Verify RED.
3. Implement: tolerate empty/missing store (reuse `loadStore` tolerance) + ENOENT-benign removal.
4. Verify GREEN.
5. Commit: "test(intake): sweep idempotence + missing-store handling"

**Files:** same as Task 10
**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 15: Inject the sweep effect into `IntakeLoopDeps` and call it each tick
**Story:** TR-6 (sweep runs on a brain tick)
**Type:** infrastructure

**Steps:**
1. Write failing test (intake-loop.test.ts): a stub `reconcile` effect on `IntakeLoopDeps` is invoked exactly once per `intakeTick`, after poll/enqueue, and a `reconcile` throw is caught (never crashes the tick).
2. Verify RED.
3. Implement: add optional `reconcile?: () => Promise<unknown>` to `IntakeLoopDeps`; call it in `intakeTick` inside a try/catch; keep the tick pure (no direct I/O).
4. Verify GREEN.
5. Commit: "feat(intake): intakeTick invokes injected reconcile effect"

**Files:**
- `src/conductor/src/engine/engineer/intake/intake-loop.ts` — add `reconcile` effect + call site
- `src/conductor/test/engine/engineer/intake/intake-loop.test.ts` — per-tick invocation + throw-safety

**Wired-into:** `src/conductor/src/engine/engineer/intake/intake-loop.ts#intakeTick`
**Dependencies:** 10

### Task 16: Bind the sweep in the production composition root
**Story:** TR-6 (real brain loop runs the sweep)
**Type:** infrastructure

**Steps:**
1. Write failing test: `dispatchIntakeLoop` builds `IntakeLoopDeps.reconcile` bound to `reconcileClosedIssues` with the real ledger, queue, and a `getIssueState` capability.
2. Verify RED.
3. Implement: in `dispatchIntakeLoop` (`intake-loop-cli.ts`), construct the `reconcile` effect from `buildIntake`'s ledger + queue + a `getIssueState` runner (reuse the halt-issues `gh` issue-state pattern).
4. Verify GREEN.
5. Commit: "feat(intake): wire reconcileClosedIssues into the brain intake loop"

**Files:**
- `src/conductor/src/intake-loop-cli.ts` — bind `reconcile` in `dispatchIntakeLoop`
- `src/conductor/test/engine/engineer/intake/intake-loop.test.ts` — composition wiring test

**Wired-into:** `src/conductor/src/engine/engineer/intake/intake-loop.ts#intakeTick` (effect consumed there); `dispatchIntakeLoop` is itself reached from `conduct-ts intake-loop --continuous` (the brain foreground command)
**Dependencies:** 10, 15

### Task 17: Reopen re-ingestion (forget disposition end-to-end)
**Story:** TR-10 (forgotten-then-reopened re-ingests; still-closed does not)
**Type:** negative-path

**Steps:**
1. Write failing test: after a forget (no ledger entry, no inbox envelope), a poll that lists the (reopened) issue re-records it `pending` (`ledger.known` false → re-ingest); a still-closed issue (`--state open` omits it) is not re-ingested; `engineer:handled` label semantics unchanged.
2. Verify RED.
3. Implement: assert existing poll+`ledger.known` behavior satisfies this post-forget (add glue only if the test reveals a gap).
4. Verify GREEN.
5. Commit: "test(intake): forgotten issue re-ingests on reopen"

**Files:**
- `src/conductor/test/engine/engineer/intake/github-issues.test.ts` — reopen re-ingestion test

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** 6, 10

### Task 18: Docs — CHANGELOG + intake README
**Story:** all (docs-track-features)
**Type:** infrastructure

**Steps:**
1. Add a `## [Unreleased]` entry (Added/Fixed) describing the claim-time closed-issue guard + brain reconciliation sweep.
2. Update `src/conductor/README.md` intake section noting: `claim` never hands out a closed issue; the brain sweep reconciles closed issues out of the ledger/inbox (forget disposition; fail-safe on unknown).
3. Commit: "docs(intake): changelog + README for closed-issue guard + sweep"

**Files:**
- `CHANGELOG.md` — `[Unreleased]` entry (no VERSION bump — pre-v1 lock)
- `src/conductor/README.md` — intake behavior note

**Wired-into:** none (no new production surface)
**Dependencies:** 6, 16

## Task Dependency Graph

```
Foundations:
  1 (parseSourceRef) ──┬─▶ 5 ──▶ 6 ──┬─▶ 7
  4 (GuardLedger.forget)┘            ├─▶ 8
                        └─(9 dep 5)  └─(9 dep 5)
  1,2,3 ──▶ 10 (sweep core) ──┬─▶ 11
                              ├─▶ 12
                              ├─▶ 13
                              ├─▶ 14
                              └─▶ 15 ──▶ 16
  6,10 ──▶ 17 (reopen, verify-only)
  6,16 ──▶ 18 (docs)

Acyclic. Claim-guard chain (1,4,5,6,7,8,9) and sweep chain (1,2,3,10..16) are
independent until docs (18).
```

## Integration Points

- After **Task 6**: `engineer claim` never delivers a closed issue (the #538 fix is live end-to-end for the claim path).
- After **Task 16**: the brain loop reconciles closed issues each tick (full feature wired).
- After **Task 17**: reopen re-ingestion confirmed — forget disposition validated end-to-end.

## Verification

- [ ] Every acceptance criterion (TR-1..TR-10, happy + negative) maps to ≥1 task
- [ ] Negative paths are explicit tasks (7,8,9,11,12,13,14,17)
- [ ] No task exceeds ~5 min of work
- [ ] Dependencies explicit + acyclic (see graph)
- [ ] Every new-production-surface task carries `**Wired-into:**`
- [ ] All `**Files:**` paths are real repo-relative paths (existing files or new files in existing dirs) — verified against the repo layout
- [ ] No VERSION bump (pre-v1); CHANGELOG `[Unreleased]` updated
