# Implementation Plan: Honest park termination boundary

**Date:** 2026-08-06
**Stories:** .docs/stories/automatic-park-outcome-writes-no-park-marker-so-an.md
**Design:** .docs/decisions/adr-2026-08-06-honest-park-termination-boundary.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-06-automatic-park-outcome-writes-no-park-marker-so-an.md
**Conflict check:** .docs/conflicts/2026-08-06-automatic-park-outcome-writes-no-park-marker-so-an.md
**Complexity:** .docs/complexity/automatic-park-outcome-writes-no-park-marker-so-an.md

## Summary

Replaces `daemon-runner.ts`'s `writeErrorHalt` with a termination primitive that takes an explicit
park intent, writes `.daemon/parked/<slug>` via the existing `writeAutoPark` **before** rendering
the `.pipeline/HALT` note, and derives the note's first line from that write's result. Eleven
tasks. All changes are inside `src/conductor/src/engine/daemon-runner.ts` plus its tests; no other
production module changes, because every park consumer (`daemon-backlog.ts`, `daemon-rekick.ts`,
`park-reconciliation.ts`) already honors the marker.

## Technical Approach

`writeErrorHalt(worktreePath, reason, log?, triageEvidence?, slug?)` becomes
`terminateFeature(opts)` in the same file, taking an explicit `park: boolean` plus the existing
inputs and a `projectRoot` from which `writeAutoPark` resolves the main repository root. It returns
a small result the caller can inspect, so a park-write failure is observable rather than swallowed.

The internal order is fixed and is the substance of the change:

1. If `park` is true, call `writeAutoPark(root, slug, reason)` and capture the outcome as one of
   `written` / `already-parked` (`EEXIST`) / `failed(err)`.
2. Choose the note's first line from that outcome — `parked, will not re-dispatch` for the first
   two, a park-failure line naming the error and the `conduct-ts daemon park <slug>` remedy for the
   third. When `park` is false, no marker call is made and the line is
   `errored — will re-dispatch on the next scan`.
3. Append the existing triage-evidence block and resume procedure unchanged, then
   `writeHaltMarker(worktreePath, note, 'needs-human')` and the existing verification read.

Because step 2 consumes step 1's return value, no caller can select the parked wording without a
successful write — the invariant is enforced by data flow rather than by convention. The existing
swallow-and-log around HALT-marker *verification* is left exactly as it is; the park failure is a
separate signal that reaches the note.

The four call sites pass `park: true` at the triage-park branch and `park: false` at the other
three. Intent is never inferred from the returned `status`, because `status: 'error'` is produced
by three sites with different park semantics.

Sequencing: characterize current behavior (T1) → primitive with park intent, non-park first (T2,
T3) → park path and ordering (T4, T5) → failure path (T6) → wire the four sites (T7, T8) →
consumer-level and durability coverage (T9, T10) → docs (T11).

## Prerequisites

- None. `writeAutoPark` (`park-marker.ts:231`), `writeHaltMarker` (`halt-marker.ts`), and the
  `TriageOutcome` type (`setup-triage.ts`) all exist and are unchanged by this work.
- Per this repository's test-isolation policy every task's tests run the real internal flow with
  faithful fakes at the filesystem and git boundaries. No task invokes a real provider.

## Task Dependency Graph

```
T1 ──┬─▶ T2 ──▶ T3 ──┬─▶ T7 ──▶ T8 ──┬─▶ T9 ──▶ T11
     │              │               │
     └─▶ T4 ──▶ T5 ─┘               └─▶ T10
                │
                └─▶ T6
```

## Tasks

### Task 1: Characterize the current termination boundary
**Story:** 4 (negative path)
**Type:** negative-path
**Steps:**
1. In `src/conductor/test/engine/daemon-runner.test.ts`, add tests that drive the existing
   feature runner to each of the four termination sites with faithful fs fakes, asserting today's
   observable outputs: `.pipeline/HALT` first line, `.pipeline/HALT.class` contents, returned
   `status`, and worktree-keep behavior.
2. Assert explicitly that **no** `.daemon/parked/<slug>` is written at any of the four sites —
   this is the currently-passing characterization that Task 7 will flip for the triage-park site
   only, and that must keep passing for the other three forever.
3. Verify GREEN (these describe current behavior and must pass before any change).
**Files:** `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** none (test-only)
**Dependencies:** none

### Task 2: Introduce the termination primitive with explicit park intent
**Story:** 4 (happy path)
**Type:** happy-path
**Steps:**
1. Add a failing test asserting that calling the new `terminateFeature` with `park: false` writes
   a `.pipeline/HALT` whose first line states the feature errored and will be re-dispatched on the
   next scan, and writes no `.daemon/parked/<slug>`.
2. Verify RED.
3. In `daemon-runner.ts`, add `terminateFeature(opts)` alongside `writeErrorHalt`, implementing
   the `park: false` branch only: render the re-dispatch line, append the existing triage-evidence
   block and resume procedure, call `writeHaltMarker(..., 'needs-human')`, and keep the existing
   verification read and its swallow-and-log.
4. Verify GREEN. Leave all four call sites on `writeErrorHalt` for now.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** none yet — wired at Task 7; the primitive lives in `daemon-runner.ts` beside the callers it will serve
**Dependencies:** 1

### Task 3: Preserve HALT class and the evidence block on the non-park path
**Story:** 4 (negative path)
**Type:** negative-path
**Steps:**
1. Add failing tests asserting `terminateFeature({ park: false })` still writes
   `.pipeline/HALT.class` as `needs-human`, still renders the resume procedure, and — when a
   `kind: 'park'` triage evidence object is supplied — still renders the output tail, the
   quarantine ref or the explicit no-quarantine statement, the contract outcome, and preserved
   paths.
2. Verify RED, implement, verify GREEN.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `terminateFeature` in `src/conductor/src/engine/daemon-runner.ts`
**Dependencies:** 2

### Task 4: Write the durable marker on park intent
**Story:** 1 (happy path)
**Type:** happy-path
**Steps:**
1. Add a failing test asserting `terminateFeature({ park: true, reason, slug, projectRoot })`
   creates `<projectRoot>/.daemon/parked/<slug>` with a body beginning `auto-parked: `, containing
   the reason text and a `timestamp:` line.
2. Add a failing test asserting the marker resolves to the **main repository root** when the
   boundary is invoked with a worktree path under `<root>/.worktrees/<slug>`.
3. Verify RED.
4. Implement the `park: true` branch: call `writeAutoPark` and capture its outcome.
5. Verify GREEN.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `terminateFeature` calls the existing exported `writeAutoPark` (`src/conductor/src/engine/park-marker.ts:231`)
**Dependencies:** 1

### Task 5: Derive the note from the write result, and pin the ordering
**Story:** 2 (happy path)
**Type:** happy-path
**Steps:**
1. Add a failing test asserting that on a successful park the HALT's first line states the feature
   is parked and will not be re-dispatched, and that `.daemon/parked/<slug>` exists at that moment.
2. Add a failing **ordering** test: instrument the filesystem boundary to record the call sequence
   and assert the marker write is issued and settled **before** the HALT note write. Assert on the
   observed order, not only the end state — the end state is equally reachable by two independent
   writes, which is the defect being removed.
3. Add a failing test asserting an `EEXIST` (already-parked) outcome renders the ordinary parked
   line, not a failure line.
4. Verify RED.
5. Implement: the note's first line is selected from the captured `writeAutoPark` outcome.
6. Verify GREEN.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `terminateFeature` in `src/conductor/src/engine/daemon-runner.ts`
**Dependencies:** 4

### Task 6: A failed park write is loud
**Story:** 3 (happy path)
**Type:** happy-path
**Steps:**
1. Add a failing test injecting a non-`EEXIST` marker-write failure (for example `EACCES`) and
   asserting the HALT's first line states the park **failed**, names the underlying error message,
   and instructs the operator to run `conduct-ts daemon park <slug>`.
2. Add a failing test asserting the parked-claim string is **absent** from that note.
3. Add a failing test asserting a distinct log line naming the slug and the park-write failure is
   emitted, separable from the existing HALT `unrecoverable-state` line.
4. Add a failing test asserting `terminateFeature` returns normally rather than throwing, so a
   park-write failure cannot crash the daemon loop.
5. Verify RED, implement, verify GREEN.
6. Confirm by inspection that the park failure is not routed into the existing HALT-verification
   swallow block; it must reach the rendered note.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `terminateFeature` in `src/conductor/src/engine/daemon-runner.ts`
**Dependencies:** 5

### Task 7: Wire the triage-park site to park intent
**Story:** 1 (negative path)
**Type:** negative-path
**Steps:**
1. Update the Task 1 characterization for the triage-park site to expect a marker (this is the one
   site whose behavior changes). Verify RED.
2. In the `triageOutcome.kind === 'park'` branch, replace the `writeErrorHalt` call with
   `terminateFeature({ park: true, ... })`, passing the project root and slug.
3. Verify GREEN, and confirm the branch still logs its triage-outcome line, still calls
   `teardownWorktree(worktree, true)`, and still returns `status: 'error'` with the same reason.
4. Add a test asserting parking the same slug twice leaves the first marker's bytes untouched.
5. Add a test asserting two different slugs terminating with park intent each get their own marker
   with their own reason.
6. Add a test asserting a non-`park` triage outcome (`pass`, `quarantined-pass`, `fixed-pass`)
   writes no marker and still continues to the conductor.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon-runner.ts` — the triage-park branch of the feature runner built by `makeFeatureRunnerDeps` (`daemon-deps.ts`) and driven by `runDaemonMode` (`daemon-cli.ts`)
**Dependencies:** 3

### Task 8: Wire the three non-park sites and delete the old writer
**Story:** 4 (happy path)
**Type:** happy-path
**Steps:**
1. Replace the remaining three `writeErrorHalt` calls — the false-ship guard, the no-DONE/no-HALT
   termination, and the catch-all throw — with `terminateFeature({ park: false, ... })`.
2. Remove `writeErrorHalt` once it has no callers, so the hardcoded parked-claim string exists in
   exactly one place that is reachable only behind a successful write.
3. Verify the Task 1 characterizations still pass unchanged for all three sites, including that
   the false-ship site still returns `status: 'halted'` and still performs its escalation.
4. Add a test per site asserting the note omits the parked claim and states re-dispatch.
5. Add a test asserting a non-park termination for a slug an operator has **already** parked by
   hand leaves that operator marker untouched.
**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon-runner.ts` — the false-ship, no-marker, and catch-all termination branches of the same feature runner
**Dependencies:** 7

### Task 9: Consumers honor the automatic park
**Story:** 5 (happy path)
**Type:** happy-path
**Steps:**
1. Add a test asserting the backlog eligibility check excludes a slug once an `auto-parked:`
   marker exists.
2. Add a test asserting the parked-reconciliation summary counts an auto-parked slug whose intake
   issue is open, and that provenance classification returns machine provenance for an
   `auto-parked:` body and operator provenance for an operator-written body.
3. Add a test asserting the re-kick sweep skips an auto-parked slug, leaves its `.pipeline/HALT`
   intact, writes no `REKICK` sentinel, and records no `lastRekickSha`.
4. Add a test asserting `conduct-ts daemon unpark <slug>` removes an auto-placed marker and
   restores dispatch eligibility.
**Files:** `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** none (test-only — asserts existing consumers `daemon-backlog.ts:846`, `daemon-rekick.ts:132`, and `park-reconciliation.ts` against the new producer)
**Dependencies:** 8

### Task 10: Pin the reconciliation edge cases the conflict check surfaced
**Story:** 5 (negative path)
**Type:** negative-path
**Steps:**
1. Add a test asserting an auto-parked slug whose `feat/daemon-<slug>` branch carries **no commits
   of its own** survives a reconciliation sweep: the merged-park path refuses with `record-missing`
   because no shipped record exists on the base branch, and the marker, worktree, and branch are
   all left in place. This is the guard that keeps the fix from deleting its own park.
2. Add a test asserting an auto-parked slug whose originating intake issue is CLOSED is classified
   `orphan`, reported under `orphaned` rather than `parked`, and keeps its marker.
3. Add a test asserting an unreadable or empty marker body does not throw during classification
   and leaves the slug parked (fail-closed).
**Files:** `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** none (test-only — pins existing `park-reconciliation.ts` guards against the new producer)
**Dependencies:** 8

### Task 11: Durability, fix-session accounting, and documentation
**Story:** 6 (happy path)
**Type:** happy-path
**Steps:**
1. Add a test counting triage fix-session invocations across several scans after a park, asserting
   the count stays at exactly one.
2. Add a test clearing the daemon's in-memory dispatch state (simulating a restart) and asserting
   the slug remains excluded.
3. Add a test removing `.pipeline/HALT` (simulating worktree recreation) and asserting the slug
   remains excluded — the marker, not the HALT, is what suppresses dispatch.
4. Add a test that unparks, re-dispatches, parks again on a different reason, and asserts the new
   marker carries the new reason.
5. Update `docs/runbooks/stalled-or-stuck-feature.md` with the automatic-park case: how to
   recognize an `auto-parked:` marker written by a setup-failure triage, what the three HALT
   first-line variants mean, and that recovery is `conduct-ts daemon unpark <slug>` after fixing
   the underlying setup problem.
6. Run `test/test_harness_integrity.sh` and fix anything it reports.
**Files:** `src/conductor/test/engine/daemon-runner.test.ts`, `docs/runbooks/stalled-or-stuck-feature.md`
**Wired-into:** none (test and documentation only)
**Dependencies:** 9

## Task 6 negative-path coverage note

**Story:** 6 (negative path)
**Story:** 3 (negative path)
**Story:** 2 (negative path)

The negative paths for Stories 2, 3, and 6 are executed inside Tasks 5, 6, and 11 respectively —
Task 5 step 2 (the ordering assertion, which fails an implementation that writes the note first),
Task 6 steps 2 and 4 (the parked-claim absence and the no-throw assertions), and Task 11 steps 1
and 4 (the fix-session call count and the re-park-with-a-new-reason case). They are listed here so
each story's negative path resolves to a declared plan citation.

## Out of scope

- The unresolved question of why `.pipeline/HALT` was absent in the reported incident despite
  `HALT.class = 'needs-human'` and the restart-safe park at `daemon.ts:155`. Recorded as a
  follow-up action on the ADR; a separate intake issue tracks it. This plan does not depend on the
  answer, because the marker it writes lives in the main repository root and survives every
  candidate mechanism.
- Any change to `park-reconciliation.ts`'s counter chain, classification rules, or cleanup
  authority. The conflict check accepted two degrading behaviors there rather than widening scope
  into a subsystem that unmerged spec work is already reworking.
- Any change to `daemon-auto-park.ts` or its #612 contradiction guard.
