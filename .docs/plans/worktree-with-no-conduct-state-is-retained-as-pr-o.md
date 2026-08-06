# Implementation Plan: Worktree classification, retained reasons, and the operator lever (#1329)

**Date:** 2026-08-05
**Design:** .docs/architecture/worktree-with-no-conduct-state-is-retained-as-pr-o.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-05-worktree-with-no-conduct-state-is-retained-as-pr-o.md
**Stories:** .docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md
**Conflict check:** Clean as of 2026-08-05

## Summary

Split the never-started worktree case out of the retained bucket, derive each retained row's
reason from real evidence instead of a hardcoded string, render a reason plus a remedy for every
non-dispatched slug, and guarantee an errored dispatch always leaves an operator-clearable marker.
Thirteen TDD tasks across two engine modules and their CLI wiring.

## Technical Approach

Three seams change, in this order:

1. **Classification** (`src/conductor/src/engine/daemon-dashboard.ts`). `scanInheritedState`
   currently pushes both the processed-ledger case and the missing-`conduct-state.json` case into
   `retainedWorktrees` with the same hardcoded reason. Introduce a distinct `neverStarted`
   collection on the scan result for the missing-state case and stop pushing it into
   `retainedWorktrees`. Precedence is unchanged: HALT and processed-ledger membership are both
   evaluated before the missing-state branch, so a halted or shipped slug never lands in the new
   bucket.

2. **Reason derivation** (same module). `RetainedWorktreeEntry.reason` widens from the current
   two-value union to include an explicit unknown. The shipped case already has local evidence —
   `readProcessedEntries` parses `prUrl` out of each ledger file. Add an optional injected
   PR-state probe (`(prUrl: string) => Promise<'open' | 'closed' | undefined>`), following the
   `tracker.getIssueState` injection pattern `daemon-cli.ts` already uses at the
   `scanInheritedState` call site (`daemon-cli.ts:1605`). The awaiting-main reason becomes
   reachable only from the branch that has an open-PR result in hand; every other branch yields
   the shipped-no-PR-reference or unknown reason. A probe that throws is caught per-slug so one
   failure never aborts the scan.

3. **Rendering** (same module, `renderDashboard`). Add the never-started group and give every
   non-dispatched row a reason and a remedy line. The `retainedWorktreeSet` ELIGIBLE/WAITING/GATED
   filters keep operating on `retainedWorktrees` only, so removing never-started slugs from that
   set is what restores their ELIGIBLE membership — no dispatch code changes.

4. **Lever guarantee** (`src/conductor/src/engine/daemon-runner.ts`). The catch in `makeRunFeature`
   is guarded by `if (worktree)`, so a `createWorktree` throw leaves no marker. Derive the marker
   path from the slug's deterministic `.worktrees/<slug>` location so the guard is no longer
   needed, and log an explicit warning when the marker write itself fails. Retry semantics are
   untouched — the feature stays stopped until an operator clears the marker.

Sequencing rationale: classification (1) must land before rendering (3) because the render reads
the new collection; reason derivation (2) is independent of both and can interleave; the lever
guarantee (4) touches a different module and has no ordering constraint against 1-3.

**Unconfirmed-attribution note.** Which code path produced the observed marker-less worktree in
`reporting_app` is NOT established (~35% for the `createWorktree`-throws path). No task asserts a
confirmed cause; Task 11 states the invariant for every error path regardless of attribution.

## Prerequisites

- None. No migration, no schema change, no new dependency.

## Tasks

### Task 1: Never-started worktrees leave the retained collection

**Story:** Story 1 — a directory with no `conduct-state.json`, no HALT and no ledger entry is
reported in a never-started bucket and absent from the retained collection.
**Type:** happy-path

**Steps:**
1. Write failing test: scan a fixture worktree base holding one worktree whose `.pipeline/` has no
   `conduct-state.json`; assert the result's `neverStarted` contains the slug and
   `retainedWorktrees` does not.
2. Verify test fails (RED)
3. Implement: add `neverStarted` to the scan result type and push the missing-state case there
   instead of into `retainedWorktrees`.
4. Verify test passes (GREEN)
5. Commit with message: "classify never-started worktrees apart from retained ones"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — new `neverStarted` collection; missing-state branch retargeted
- src/conductor/test/engine/daemon-dashboard.test.ts — new classification test

**Wired-into:** src/conductor/src/daemon-cli.ts#renderStartupDashboard
**Dependencies:** none

### Task 2: Setup-era-only worktrees classify as never-started

**Story:** Story 1 — a `.pipeline/` holding only setup-era artifacts classifies never-started.
**Type:** happy-path

**Steps:**
1. Write failing test: fixture `.pipeline/` containing `git-hooks`, `session-hooks`,
   `step-heartbeat`, `task-evidence.json`, `events.jsonl` and `audit-trail` but no
   `conduct-state.json`; assert never-started.
2. Verify test fails (RED)
3. Implement: confirm the branch keys on `conduct-state.json` alone and does not treat sibling
   artifacts as pipeline state.
4. Verify test passes (GREEN)
5. Commit with message: "treat setup-era artifacts as no pipeline state"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — missing-state predicate
- src/conductor/test/engine/daemon-dashboard.test.ts — setup-era fixture test

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Malformed conduct-state is in-progress, not never-started

**Story:** Story 1 negative path — malformed JSON yields IN-PROGRESS with step `unknown` and no
never-started entry.
**Type:** negative-path

**Steps:**
1. Write failing test: fixture `conduct-state.json` containing invalid JSON; assert an IN-PROGRESS
   entry with step `unknown` and an empty `neverStarted`.
2. Verify test fails (RED)
3. Implement: keep `loadWorktreeState`'s `present: true` semantics for unparseable content so the
   new branch is not reached.
4. Verify test passes (GREEN)
5. Commit with message: "a file that exists but does not parse is not never-started"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — branch ordering around `present`
- src/conductor/test/engine/daemon-dashboard.test.ts — malformed-JSON test

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 4: Infrastructure and unreadable worktrees are handled

**Story:** Story 1 negative paths — `resolve-`/`engineer-` prefixed directories appear in neither
collection; an unreadable state file does not abort the scan.
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture base containing an `engineer-` prefixed directory, a `resolve-`
   prefixed directory, and one whose state file read rejects; assert neither prefixed slug appears
   in either collection and the scan still returns entries for the remaining worktrees.
2. Verify test fails (RED)
3. Implement: apply the existing `isRetainedFeatureWorktree` prefix guard to the never-started push
   and keep the per-worktree read failure contained.
4. Verify test passes (GREEN)
5. Commit with message: "exclude infrastructure worktrees from the never-started bucket"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — prefix guard on the new branch
- src/conductor/test/engine/daemon-dashboard.test.ts — prefix and read-failure tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 5: A never-started slug appears in ELIGIBLE

**Story:** Story 2 — a never-started, unparked, unhalted eligible slug is rendered under ELIGIBLE.
**Type:** happy-path

**Steps:**
1. Write failing test: render a dashboard whose discovery reports the slug eligible and whose
   worktree is never-started; assert the rendered ELIGIBLE section lists it.
2. Verify test fails (RED)
3. Implement: leave `retainedWorktreeSet` built from `retainedWorktrees` only, so the never-started
   slug is no longer filtered out.
4. Verify test passes (GREEN)
5. Commit with message: "keep never-started features eligible for dispatch"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — ELIGIBLE filter set membership
- src/conductor/test/engine/daemon-dashboard.test.ts — eligibility render test

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 6: Park and HALT still outrank the never-started bucket

**Story:** Story 2 negative paths — a never-started slug that is also parked or halted is excluded
from ELIGIBLE and rendered in the higher-precedence group.
**Type:** negative-path

**Steps:**
1. Write failing test: two fixtures — never-started plus park marker, and never-started plus HALT —
   assert PARKED and HALTED respectively, and absence from ELIGIBLE in both.
2. Verify test fails (RED)
3. Implement: keep the HALT check ahead of the missing-state branch and keep the parked overlay
   applied after the scan.
4. Verify test passes (GREEN)
5. Commit with message: "preserve park and halt precedence over never-started"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — branch ordering and overlay
- src/conductor/test/engine/daemon-dashboard.test.ts — precedence tests

**Wired-into:** same as Task 1
**Dependencies:** Task 5

### Task 7: The retained reason widens and derives from ledger evidence

**Story:** Story 3 — a legacy ledger entry with no PR URL reports a ship with no PR reference
rather than an open PR.
**Type:** happy-path

**Steps:**
1. Write failing test: a processed-ledger entry holding legacy plain-text `shipped`; assert the
   retained reason is the shipped-no-PR-reference value and never the awaiting-main value.
2. Verify test fails (RED)
3. Implement: widen `RetainedWorktreeEntry.reason` and derive the ledger-only case from the parsed
   `prUrl` being absent.
4. Verify test passes (GREEN)
5. Commit with message: "derive the retained reason from ledger evidence"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — reason union and derivation
- src/conductor/test/engine/daemon-dashboard.test.ts — legacy-ledger reason test

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 8: An injected PR-state probe refines the reason

**Story:** Story 3 — an open PR yields the awaiting-main reason naming the PR URL; a closed PR
yields the closed-unmerged reason.
**Type:** happy-path

**Steps:**
1. Write failing test: inject a fake probe returning `open` for one slug and `closed` for another;
   assert each row's reason and that the open row names its PR URL.
2. Verify test fails (RED)
3. Implement: accept an optional probe dependency in `scanInheritedState` and gate the
   awaiting-main reason behind an `open` result.
4. Verify test passes (GREEN)
5. Commit with message: "gate the awaiting-main reason behind an open-PR result"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — probe dependency and reason gating
- src/conductor/src/daemon-cli.ts — inject the probe at the existing scan call site
- src/conductor/test/engine/daemon-dashboard.test.ts — probe-driven reason tests

**Wired-into:** src/conductor/src/daemon-cli.ts#renderStartupDashboard
**Dependencies:** Task 7

### Task 9: An absent or failing probe degrades to an explicit unknown

**Story:** Story 3 negative paths — no probe, a throwing probe, and a mismatched probe response
must never produce an awaiting-main row.
**Type:** negative-path

**Steps:**
1. Write failing test: three cases — probe omitted, probe rejecting, probe answering about a
   different slug; assert an explicit unknown reason each time, a completed scan for other rows,
   and zero awaiting-main rows.
2. Verify test fails (RED)
3. Implement: catch per-slug probe failures, ignore responses that do not correspond to the queried
   PR, and fall through to the unknown reason.
4. Verify test passes (GREEN)
5. Commit with message: "degrade an unavailable PR probe to an explicit unknown reason"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — probe error containment
- src/conductor/test/engine/daemon-dashboard.test.ts — probe failure tests

**Wired-into:** same as Task 8
**Dependencies:** Task 8

### Task 10: A shipped-and-retained slug with an open PR stays excluded

**Story:** Story 4 — the mandatory non-regression: a ledger slug with an open PR is absent from
ELIGIBLE, and probe failure downgrades the reason but never the exclusion.
**Type:** negative-path

**Steps:**
1. Write failing test: a processed-ledger slug with an open PR that discovery also reports
   eligible; assert it renders under RETAINED and is absent from ELIGIBLE. Repeat with a throwing
   probe and assert the exclusion holds while the reason becomes unknown.
2. Verify test fails (RED)
3. Implement: keep the exclusion keyed on retained membership rather than on the derived reason,
   and keep ledger membership evaluated before the missing-state branch.
4. Verify test passes (GREEN)
5. Commit with message: "keep shipped-and-retained worktrees excluded from dispatch"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — exclusion independence from reason
- src/conductor/test/engine/daemon-dashboard.test.ts — non-regression tests

**Wired-into:** same as Task 1
**Dependencies:** Task 9

### Task 11: A failed dispatch always leaves a marker

**Story:** Story 6 — an error path writes an operator-clearable marker even when worktree creation
throws before a handle exists.
**Type:** happy-path

**Steps:**
1. Write failing test: inject a `createWorktree` that throws; assert the runner writes a marker at
   the slug's deterministic worktree path and returns an `error` outcome.
2. Verify test fails (RED)
3. Implement: derive the marker path from the slug in the catch instead of requiring the `worktree`
   handle.
4. Verify test passes (GREEN)
5. Commit with message: "write the error marker from the slug, not the worktree handle"

**Files likely touched:**
- src/conductor/src/engine/daemon-runner.ts — slug-derived marker path in the error catch
- src/conductor/test/engine/daemon-runner.test.ts — createWorktree-throws test

**Wired-into:** src/conductor/src/engine/daemon.ts#runDaemon
**Dependencies:** none

### Task 12: A failed marker write is surfaced, and no retry is introduced

**Story:** Story 6 negative paths — a failing marker write logs an explicit unrecoverable-state
warning; an errored outcome is not automatically re-dispatched.
**Type:** negative-path

**Steps:**
1. Write failing test: make the marker write reject and assert a warning naming the slug is logged;
   separately assert that after an errored outcome the loop does not dispatch the slug again while
   the marker is present.
2. Verify test fails (RED)
3. Implement: log the write failure explicitly and leave the existing park-until-cleared semantics
   untouched.
4. Verify test passes (GREEN)
5. Commit with message: "surface an unwritable error marker instead of implying a lever"

**Files likely touched:**
- src/conductor/src/engine/daemon-runner.ts — marker write failure logging
- src/conductor/test/engine/daemon-runner.test.ts — write-failure and no-retry tests

**Wired-into:** same as Task 11
**Dependencies:** Task 11

### Task 13: Every excluded row renders a reason and a remedy

**Story:** Story 5 — park, halt, retained and never-started rows each carry a reason and the action
that resumes them; double-qualifying slugs render once; an empty HALT renders `unknown`.
**Type:** happy-path

**Steps:**
1. Write failing test: render a dashboard containing one parked, one halted (with an empty marker),
   one retained and one never-started slug; assert each row carries both a reason and a remedy, the
   empty halt renders `unknown` with its remedy intact, a slug qualifying twice appears once with
   the higher-precedence reason, and an all-clear dashboard prints no orphan remedy lines.
2. Verify test fails (RED)
3. Implement: emit reason plus remedy per group in `renderDashboard`, naming the reclaim verb for
   retained rows and stating explicitly when no operator action applies.
4. Verify test passes (GREEN)
5. Commit with message: "render an exclusion reason and remedy for every non-dispatched feature"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — group rendering with reason and remedy
- src/conductor/test/engine/daemon-dashboard.test.ts — rendering tests
- src/conductor/test/ui/dashboard-text.test.ts — text-surface expectations

**Wired-into:** same as Task 1
**Dependencies:** Task 10, Task 6

## Task Dependency Graph

```
Task 1 ──┬── Task 2
         ├── Task 3
         ├── Task 4
         ├── Task 7 ── Task 8 ── Task 9 ── Task 10 ──┐
         └── Task 5 ── Task 6 ───────────────────────┴── Task 13

Task 11 ── Task 12          (independent module — no ordering against 1-13)
```

## Integration Points

- After Task 6: the never-started bucket is end-to-end visible — a never-started feature renders
  under its own heading and stays in ELIGIBLE, while park and halt still win.
- After Task 10: retained-reason derivation is complete and the dispatch-exclusion non-regression
  is proven.
- After Task 12: the lever invariant holds for every error path in the runner.
- After Task 13: `daemon status` answers "why is this not being dispatched, and what do I do about
  it?" for every excluded feature.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
