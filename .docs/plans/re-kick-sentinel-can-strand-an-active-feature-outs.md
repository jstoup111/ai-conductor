# Implementation Plan: Re-kick sentinel can strand an active feature outside recovery

**Date:** 2026-08-09
**Stories:** .docs/stories/re-kick-sentinel-can-strand-an-active-feature-outs.md
**Complexity:** .docs/complexity/re-kick-sentinel-can-strand-an-active-feature-outs.md
**Track:** technical (S tier — architecture-review, conflict-check, and coherence-check skipped)

## Summary

Report an unconsumed `.pipeline/REKICK` sentinel with the exact discovery gate blocking its feature,
instead of letting the feature read as IN-PROGRESS. Thirteen tasks across discovery, the blocked
read model, and the dashboard. No recovery behaviour changes.

## Technical Approach

The strand exists because two mechanisms never meet. `rekickSweep` (`daemon-rekick.ts`) enumerates
only worktrees carrying a live `.pipeline/HALT`, so a worktree holding a sentinel with no HALT is
outside every sweep. The sentinel is consumed only by `resumeRebaseFirst`, which runs after a
feature is dispatched — and `discoverBacklog` refuses a non-`S`-tier merged spec whose
`.docs/coherence/<slug>.md` is absent (`reason: 'missing-coherence'`), so the feature is never
dispatched and the sentinel never resolves.

Three surfaces change, all of them existing:

1. **Discovery annotation.** `discoverBacklog` already classifies blocked specs into
   `BlockedSpecItem` and persists them wholesale to `.daemon/blocked.json` each pass
   (`writeBlockedSnapshot`). `BlockedSpecItem` gains an optional `strandedRekick?: boolean`, filled
   from a new optional `hasRekickSentinel?: (slug) => Promise<boolean>` probe on
   `DiscoverBacklogOpts` — the same optional-dep shape as the existing `featureWorktreePresent`
   and `shippedOnFeatureBranch` probes, so an absent probe leaves discovery byte-for-byte legacy.
   The probe is fail-open on the annotation only: a throw is logged and treated as "no sentinel",
   and never suppresses the blocked entry itself.

2. **Blocked read model rendering.** `daemon-observe-cli.ts` already reads and renders
   `.daemon/blocked.json`. `blockedSpecLine` gains the sentinel statement, and the snapshot reader
   tolerates the new field being absent or of an unexpected type (older and newer writers both).
   `readBlockedSnapshot` is exported so the dashboard can reuse the identical tolerant reader rather
   than parsing the snapshot a second way.

3. **Dashboard grouping.** `scanInheritedState` gains an optional `readBlocked` dep and returns a
   `blocked` group. Precedence becomes PARKED > HALTED > PROCESSED > BLOCKED > IN-PROGRESS > GATED >
   WAITING > ELIGIBLE: a spec discovery has blocked cannot be dispatched, so its worktree state is
   stale by construction and must not read as forward progress. The same worktree loop additionally
   probes `.pipeline/REKICK` and reports a sentinel-carrying worktree that appears in none of
   discovery's buckets as `stranded` with an explicit no-gate-identified reason, which is what
   closes the last hole in Outcome-1.

**Why `readBlocked` and not a widened `WorkSource.discover()`.** `localWorkSource.discover()` returns
a bare `BacklogItem[]` (`daemon-work-source.ts:204`); `waiting` and `gated` are already dropped on
that path, which is why the production startup dashboard shows them empty. Widening that contract is
a larger change than this feature needs and would alter the daemon's dispatch path. Discovery
already persists the blocked list to `.daemon/blocked.json` on every pass, so the dashboard reads
that snapshot — one writer, one reader, no contract change on the dispatch path.

Nothing here clears a sentinel, dispatches a feature, writes or removes a park marker, or removes a
worktree. Task 13 pins that as a test.

## Prerequisites

- None. Every file touched already exists.

## Tasks

### Task 1: Add the stranded-sentinel field and probe to discovery's blocked classification
**Story:** Story 1 — happy path 1 (`.daemon/blocked.json` entry carries the sentinel marker)
**Type:** happy-path

**Steps:**
1. Write failing test: a `missing-coherence` block on a slug whose `hasRekickSentinel` probe resolves
   `true` produces a `BlockedSpecItem` with `reason: 'missing-coherence'`, the existing remedy, and
   `strandedRekick: true`.
2. Verify test fails (RED)
3. Implement: add `strandedRekick?: boolean` to `BlockedSpecItem` and
   `hasRekickSentinel?: (slug: string) => Promise<boolean>` to `DiscoverBacklogOpts`; resolve the
   probe once per blocked slug and set the field only when it resolves `true`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(discovery): annotate blocked specs with a stranded re-kick sentinel"

**Files likely touched:**
- `src/conductor/src/engine/daemon-backlog.ts` — `BlockedSpecItem`, `DiscoverBacklogOpts`, the
  blocked classification path
- `src/conductor/test/engine/daemon-backlog.test.ts` — new case

**Wired-into:** none (inert until `src/conductor/src/engine/daemon-work-source.ts`)

**Dependencies:** none

---

### Task 2: Leave an unannotated blocked entry byte-identical when no sentinel is held
**Story:** Story 1 — happy path 3 (backward compatibility)
**Type:** happy-path

**Steps:**
1. Write failing test: with `hasRekickSentinel` resolving `false`, and separately with the probe
   absent entirely, a `missing-coherence` block produces an entry with no `strandedRekick` key.
2. Verify test fails (RED)
3. Implement: omit the field rather than writing `false`, and skip the probe call entirely when the
   dep is absent.
4. Verify test passes (GREEN)
5. Commit with message: "test(discovery): pin unannotated blocked entries unchanged"

**Files likely touched:**
- `src/conductor/src/engine/daemon-backlog.ts` — blocked classification path
- `src/conductor/test/engine/daemon-backlog.test.ts` — new cases

**Wired-into:** same as Task 1

**Dependencies:** Task 1

---

### Task 3: Name both the gate and the sentinel in discovery's warn-once log line
**Story:** Story 1 — happy path 2 (log line names gate and sentinel)
**Type:** happy-path

**Steps:**
1. Write failing test: a blocked slug holding a sentinel emits one warn-once line containing the
   slug, the blocking reason, and the stranded-sentinel wording; a blocked slug without a sentinel
   emits the existing line unchanged.
2. Verify test fails (RED)
3. Implement: append the sentinel clause to the existing `warnOnce` message when the annotation is
   set, leaving the message identical otherwise.
4. Verify test passes (GREEN)
5. Commit with message: "feat(discovery): name the stranded sentinel in the blocked warn-once line"

**Files likely touched:**
- `src/conductor/src/engine/daemon-backlog.ts` — blocked classification log path
- `src/conductor/test/engine/daemon-backlog.test.ts` — new cases

**Wired-into:** same as Task 1

**Dependencies:** Task 1

---

### Task 4: Isolate a failing or absent sentinel probe
**Story:** Story 1 — all three negative paths
**Type:** negative-path

**Steps:**
1. Write failing test: (a) a probe that rejects leaves the blocked entry complete with its gate and
   remedy and logs the failure; (b) a probe that rejects for the first of two blocked slugs still
   yields a complete entry for the second; (c) a probe resolving `false` for a slug with no worktree
   directory produces a complete unannotated entry and does not throw.
2. Verify test fails (RED)
3. Implement: wrap the probe call in try/catch, log the error with the slug, treat the result as "no
   sentinel", and continue the pass.
4. Verify test passes (GREEN)
5. Commit with message: "fix(discovery): isolate sentinel-probe failures per slug"

**Files likely touched:**
- `src/conductor/src/engine/daemon-backlog.ts` — probe invocation
- `src/conductor/test/engine/daemon-backlog.test.ts` — new cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

---

### Task 5: Thread the sentinel probe through the work-source dep surface
**Story:** Story 1 — happy path 1 (the annotation must reach a real discovery pass)
**Type:** infrastructure

**Steps:**
1. Write failing test: a `localWorkSource` constructed with `hasRekickSentinel` passes it through to
   `discoverBacklog`'s opts; one constructed without it passes an opts object with no
   `hasRekickSentinel` key.
2. Verify test fails (RED)
3. Implement: add the optional dep to `LocalWorkSourceDeps` and spread it into the opts object using
   the same conditional-spread pattern as `featureWorktreePresent`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(work-source): thread the re-kick sentinel probe into discovery"

**Files likely touched:**
- `src/conductor/src/engine/daemon-work-source.ts` — `LocalWorkSourceDeps`, the opts spread
- `src/conductor/test/engine/daemon-work-source.test.ts` — new cases

**Wired-into:** `src/conductor/src/daemon-cli.ts#localWorkSource`

**Dependencies:** Task 1

---

### Task 6: Wire the real filesystem sentinel probe in the daemon CLI
**Story:** Story 1 — happy path 1 (end-to-end in the real daemon)
**Type:** infrastructure

**Steps:**
1. Write failing test: the daemon CLI's constructed probe resolves `true` for a worktree containing
   `.pipeline/REKICK` and `false` for one without, resolving the path under `worktreeBase`.
2. Verify test fails (RED)
3. Implement: pass `hasRekickSentinel` into the `localWorkSource({...})` construction, resolving
   `join(worktreeBase, slug, REKICK_SENTINEL)` and reusing the exported `REKICK_SENTINEL` constant
   from `daemon-rekick.ts` rather than a new literal.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): wire the real re-kick sentinel probe into discovery"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — the `localWorkSource({...})` construction
- `src/conductor/test/engine/daemon-cli-rekick-sentinel-park-guard.test.ts` — new cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

---

### Task 7: Render the stranded sentinel in the blocked read model, tolerantly
**Story:** Story 2 — both happy paths and both negative paths
**Type:** happy-path

**Steps:**
1. Write failing test: `blockedSpecLine` for an entry with `strandedRekick: true` contains the slug,
   reason, remedy, and the stranded-sentinel statement; an entry without the field renders the
   existing line unchanged; an entry whose field is a string renders as if absent; a missing or
   malformed `.daemon/blocked.json` still prints the existing "blocked state unknown" line.
2. Verify test fails (RED)
3. Implement: widen the snapshot entry type with the optional field, accept it only when it is
   strictly `true`, and append the statement in `blockedSpecLine`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(observe): report a stranded re-kick sentinel in the blocked section"

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — `BlockedSnapshot`, `readBlockedSnapshot`,
  `blockedSpecLine`
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — new cases

**Wired-into:** `src/conductor/src/daemon-cli.ts#readBlockedSnapshot`

**Dependencies:** Task 1

---

### Task 8: Export the tolerant blocked-snapshot reader for reuse
**Story:** Story 3 — happy path 1 (the dashboard needs the same blocked list)
**Type:** infrastructure

**Steps:**
1. Write failing test: `readBlockedSnapshot` is importable from the module and returns the same
   tolerant result shape for a valid, a missing, and a malformed snapshot.
2. Verify test fails (RED)
3. Implement: export `readBlockedSnapshot` and its result type; no behavioural change.
4. Verify test passes (GREEN)
5. Commit with message: "refactor(observe): export the blocked-snapshot reader"

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — export declarations
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — new case

**Wired-into:** same as Task 7

**Dependencies:** Task 7

---

### Task 9: Return a blocked group from the dashboard scan, outranking IN-PROGRESS
**Story:** Story 3 — happy paths 1 and 3, negative paths 1, 2, and 4
**Type:** happy-path

**Steps:**
1. Write failing test: a slug reported blocked, with readable worktree state, no HALT, no DONE and
   no processed entry, appears in `blocked` and not in `inProgress`; an unblocked slug with state
   still appears in `inProgress`; a blocked slug with a live HALT appears only in `halted`; a
   blocked slug that is operator-parked is excluded by the existing parked overlay; an absent
   `readBlocked` dep yields an empty `blocked` group with every other group unchanged.
2. Verify test fails (RED)
3. Implement: add the optional `readBlocked` dep and a `blocked` field on `InheritedState`, collect
   blocked slugs before the in-progress push, and skip the in-progress push for a blocked slug.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): report blocked specs instead of in-progress"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — `ScanInheritedStateDeps`, `InheritedState`, the
  worktree loop
- `src/conductor/test/engine/daemon-dashboard.test.ts` — new cases

**Wired-into:** none (inert until `src/conductor/src/daemon-cli.ts`)

**Dependencies:** Task 8

---

### Task 10: Report a sentinel-carrying worktree with no identified gate as stranded
**Story:** Story 4 — happy path 1, both negative paths
**Type:** happy-path

**Steps:**
1. Write failing test: a worktree holding `.pipeline/REKICK`, with no HALT, not processed, and whose
   slug appears in neither the blocked list nor the eligible items is returned in a `stranded` group
   with a no-gate-identified reason and absent from `inProgress`; a worktree with no sentinel in the
   same position is reported exactly as today; a worktree whose sentinel read throws is logged and
   skipped without being reported as stranded.
2. Verify test fails (RED)
3. Implement: probe `.pipeline/REKICK` inside the existing per-worktree try/catch, and classify the
   residual case after the blocked check from Task 9.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): report a stranded re-kick sentinel with no known gate"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — the worktree loop, `InheritedState`
- `src/conductor/test/engine/daemon-dashboard.test.ts` — new cases

**Wired-into:** same as Task 9

**Dependencies:** Task 9

---

### Task 11: Render the blocked and stranded groups
**Story:** Story 3 — happy path 2; Story 4 — happy path 2
**Type:** happy-path

**Steps:**
1. Write failing test: rendered dashboard text for a blocked slug contains its reason and remedy and
   its stranded-sentinel statement when present; a stranded slug's line names the slug and the
   recovery runbook; both groups render as empty-count headers when they hold nothing.
2. Verify test fails (RED)
3. Implement: add the two groups to `renderDashboard` in the documented precedence order.
4. Verify test passes (GREEN)
5. Commit with message: "feat(dashboard): render the blocked and stranded groups"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — `renderDashboard`
- `src/conductor/test/engine/daemon-dashboard.test.ts` — new cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

---

### Task 12: Wire the blocked reader into the startup dashboard
**Story:** Story 3 — happy path 1 (in the real daemon)
**Type:** infrastructure

**Steps:**
1. Write failing test: the startup dashboard's `scanInheritedState` call supplies a `readBlocked`
   dep resolving from the project root's `.daemon/blocked.json`, and the blocked slugs it returns
   are added to the parked-overlay candidate set alongside `halted`/`inProgress`/`eligible`.
2. Verify test fails (RED)
3. Implement: pass `readBlocked: () => readBlockedSnapshot(projectRoot)` into the
   `scanInheritedState({...})` call in `renderStartupDashboard`, and extend `candidateSlugs`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): supply blocked specs to the startup dashboard"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — `renderStartupDashboard`
- `src/conductor/test/engine/daemon-dashboard.test.ts` — new case

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

---

### Task 13: Pin park, halt, shipped precedence and the absence of side effects
**Story:** Story 5 — all criteria; Story 6 — all criteria
**Type:** negative-path

**Steps:**
1. Write failing test: a sentinel-carrying slug that is operator-parked yields no blocked entry from
   discovery and appears only in PARKED; one matching a shipped record by content hash yields
   neither a blocked nor a stranded entry; one in the processed ledger is reported as
   processed/retained and never stranded; and across one discovery pass plus one dashboard scan,
   `.pipeline/REKICK` still exists, `.pipeline/HALT` is unchanged, no `.daemon/parked/<slug>` marker
   is created or removed, no worktree directory is removed, and no feature is dispatched.
2. Verify test fails (RED)
3. Implement: any ordering correction the tests expose — the existing park short-circuit and shipped
   dedup already precede the blocked classification, so this task is expected to prove the
   invariants rather than move code.
4. Verify test passes (GREEN)
5. Commit with message: "test(daemon): pin sentinel-report precedence and side-effect freedom"

**Files likely touched:**
- `src/conductor/test/engine/daemon-backlog.test.ts` — precedence cases
- `src/conductor/test/engine/daemon-dashboard.test.ts` — precedence and side-effect cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 12

## Task Dependency Graph

```
Task 1 ──┬── Task 2
         ├── Task 3
         ├── Task 4
         ├── Task 5 ── Task 6
         └── Task 7 ── Task 8 ── Task 9 ── Task 10 ── Task 11 ── Task 12 ── Task 13
```

## Integration Points

- **After Task 6:** a real daemon discovery pass writes `.daemon/blocked.json` entries annotated
  with the stranded sentinel; `conduct daemon observe` already renders them via Task 7.
- **After Task 12:** the startup dashboard reports a discovery-gated feature under BLOCKED with its
  named requirement, and a gateless sentinel under STRANDED, in place of IN-PROGRESS.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
