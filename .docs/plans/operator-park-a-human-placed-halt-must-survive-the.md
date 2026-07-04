# Implementation Plan: Operator Park — human park survives autonomous re-dispatch

**Date:** 2026-07-04
**Design:** .docs/specs/2026-07-04-operator-park.md
**Stories:** .docs/stories/operator-park-a-human-placed-halt-must-survive-the.md (FR-1..FR-7)
**ADRs:** adr-2026-07-04-operator-park-marker.md, adr-2026-07-04-park-unpark-cli-verbs.md (both APPROVED)
**Conflict check:** Clean as of 2026-07-04 (zero blocking; 2 accepted degrading constraints below)

## Summary

Adds an operator-owned `.daemon/parked/<slug>` marker with `daemon park`/`unpark` CLI verbs;
the re-kick sweep, dispatch eligibility, and dashboard all honor it. 14 tasks.

## Technical Approach

- **One canonical module** (`src/conductor/src/engine/park-marker.ts`, mirroring
  `halt-marker.ts`'s single-source pattern): the `.daemon/parked/` subdir constant, path
  helper, `writeOperatorPark` (idempotent create), `removeOperatorPark`, and
  `isOperatorParked`. `isOperatorParked` is **fail-toward-parked**: plain ENOENT → `false`;
  any other error → `true` plus an anomaly log via an optional log callback (ADR §4). All
  consumers (sweep, eligibility, dashboard, CLI) import from here — no re-spelled paths.
- **Sweep contract:** in `rekickSweep` the parked check is the FIRST guard in the per-slug
  loop — ahead of the `isProcessed` branch and the `lastRekickSha` guard (conflict-check
  constraint). A parked slug goes to `skipped`, logs
  `re-kick <slug>: skipped — operator-parked`, and touches nothing (no abort, no clear, no
  sentinel, no SHA mutation). The existing `isProcessed` fail-OPEN policy is untouched; the
  parked check carries its own fail-toward-parked policy.
- **Eligibility:** the daemon loop's dispatch decision (the layer that consults
  `isHalted`/backlog eligibility) gains a parked check so a parked slug is never dispatched on
  any tick, startup scan, or halt-cleared (PR-#109) resume; a pending `.pipeline/REKICK`
  sentinel on a parked worktree is left unconsumed.
- **Verbs:** `daemon park <slug>` / `daemon unpark <slug>` declared in `src/cli.ts` under the
  `daemon` group; a new pre-boot detector in `src/index.ts` (pattern of
  `detectDaemonObserveCommand`) dispatches them filesystem-direct — no supervisor, no live
  daemon. `park` validates the slug against current plan stems (`.docs/plans/`) or an existing
  worktree directory; unknown → exit non-zero, nothing written.
- **Dashboard:** a `PARKED` group listed first; PARKED outranks **every** existing group
  (HALTED, PROCESSED, GATED, IN-PROGRESS, WAITING, ELIGIBLE and future siblings); interior
  order unchanged. Stale parks (no worktree, no backlog entry) still render under PARKED.
- **Terminology rule (conflict-check):** new code, tests, and log lines say **"operator-parked"**;
  legacy comments where "parked" means halted are NOT re-worded in this PR.
- **Sequencing rationale:** module first (everything imports it), then the two enforcement
  chokepoints (sweep, eligibility), then verbs, then visibility, then docs/integrity.

## Prerequisites

None — `.daemon/` per-slug state pattern (`warned/`) already exists; no migrations, no deps.

## Tasks

### Task 1: park-marker module — happy-path helpers
**Story:** FR-1 (marker exists with provenance body), FR-7 (single-writer invariant surface)
**Type:** infrastructure
**Steps:**
1. Write failing tests (`park-marker.test.ts`): `writeOperatorPark(root, slug)` creates
   `.daemon/parked/<slug>` (mkdir -p chain) with a body containing a timestamp line and
   `parked by operator`; `isOperatorParked` true after write, false on fresh root;
   `removeOperatorPark` deletes; module exports the subdir constant.
2. RED → implement `src/conductor/src/engine/park-marker.ts` mirroring `halt-marker.ts`'s
   header/comment style → GREEN.
3. Commit: "feat(conductor): park-marker module — operator-parked state single source"
**Files:** `src/conductor/src/engine/park-marker.ts` (new), `src/conductor/test/park-marker.test.ts` (new)
**Dependencies:** none

### Task 2: park-marker module — idempotency + fail-toward-parked
**Story:** FR-7 (re-park unchanged content/mtime; race yields one intact marker), FR-2 negative
(check error → parked; empty file parks)
**Type:** negative-path
**Steps:**
1. Failing tests: second `writeOperatorPark` leaves content+mtime unchanged and reports
   already-parked; two concurrent writes → one intact marker, both resolve; zero-byte marker →
   `isOperatorParked` true; injected non-ENOENT error (e.g. unreadable dir via fs stub) →
   `isOperatorParked` returns true and invokes the log callback with the anomaly.
2. RED → implement (exclusive-create `wx` flag for idempotency/race; error branch) → GREEN.
3. Commit: "feat(conductor): park-marker idempotent create + fail-toward-parked check"
**Files:** same as Task 1
**Dependencies:** Task 1

### Task 3: rekickSweep — operator-parked skip, first in chain
**Story:** FR-3 happy (skip + HALT byte-intact + no abort/clear/sentinel + verbatim log;
unconditional across SHAs), FR-3 negative (before isProcessed and SHA guard; no
`lastRekickSha` mutation)
**Type:** happy-path
**Steps:**
1. Failing tests in the existing rekick suite: deps gain optional
   `isOperatorParked?: (slug) => Promise<boolean>`; parked slug → in `skipped`, HALT body
   byte-identical, `abortRebase`/`clearMarker` never called, no REKICK sentinel, `lastRekickSha`
   not set, log line `re-kick <slug>: skipped — operator-parked` present; parked slug with
   `isProcessed` also true → isProcessed never invoked (ordering assertion); skip repeats at a
   second SHA.
2. RED → add the parked branch at the TOP of the per-slug loop in `rekickSweep` → GREEN.
3. Commit: "feat(conductor): rekickSweep skips operator-parked worktrees first"
**Files:** `src/conductor/src/engine/daemon-rekick.ts`, its test file
**Dependencies:** Task 1

### Task 4: rekickSweep — parked-check error isolation
**Story:** FR-3 negative (check throws → slug skipped fail-toward-parked, error logged,
siblings still processed)
**Type:** negative-path
**Steps:**
1. Failing test: `isOperatorParked` throws for slug A → A in `skipped` with anomaly log; slug B
   (halted, un-parked) still cleared in the same pass.
2. RED → wrap the parked check per-slug (treat error as parked, log, continue) → GREEN.
3. Commit: "feat(conductor): rekickSweep parked-check failure isolates per-slug, fails toward parked"
**Files:** same as Task 3
**Dependencies:** Task 3

### Task 5: rekickSweep — mixed-pass regression (FR-5)
**Story:** FR-5 happy (parked sibling untouched while un-parked sibling clears in one pass;
no-parks pass byte-identical), FR-5 negative (FR-9 SHA guard still applies to un-parked)
**Type:** negative-path
**Steps:**
1. Failing tests: two-worktree fixture — parked A untouched, B renamed to HALT.cleared +
   sentinel + `lastRekickSha` set, both in one `rekickSweep` call; absent `isOperatorParked`
   dep (undefined) → behavior identical to today (backward-compat); B already re-kicked at SHA →
   still skipped by the SHA guard.
2. RED where needed → GREEN (mostly assertions on Task 3's implementation).
3. Commit: "test(conductor): rekick mixed-pass — operator-park never weakens existing guards"
**Files:** rekick test file
**Dependencies:** Task 3, Task 4

### Task 6: wire the real parked dep into the daemon sweep
**Story:** FR-2 happy (sweeps across restarts honor the marker)
**Type:** infrastructure
**Steps:**
1. Failing integration-level test (deps assembly): the sweep deps built in `daemon-cli.ts`
   include an `isOperatorParked` backed by `park-marker.ts` against the repo root.
2. RED → wire in `daemon-cli.ts` (same spot the other real primitives are injected, ~L455-510)
   → GREEN.
3. Commit: "feat(conductor): daemon wires operator-parked check into re-kick sweep"
**Files:** `src/conductor/src/daemon-cli.ts`, its test file
**Dependencies:** Task 3

### Task 7: dispatch eligibility — parked slug never dispatched
**Story:** FR-2 happy (tick skip; halt-cleared/PR-#109 path skip; zero-burn across restarts)
**Type:** happy-path
**Steps:**
1. Failing tests at the dispatch decision layer (where `isHalted` gates re-dispatch): parked
   backlog slug not dispatched, no worktree created; parked slug whose HALT was removed still
   not re-dispatched; restart simulation (fresh deps object, same fs) → still ineligible.
2. RED → add the parked check beside the `isHalted` consult (single import from park-marker)
   → GREEN.
3. Commit: "feat(conductor): dispatch treats operator-parked slugs as ineligible"
**Files:** `src/conductor/src/engine/daemon-deps.ts` (or the daemon loop's eligibility site it
feeds), matching tests
**Dependencies:** Task 1

### Task 8: sentinel resume — parked worktree leaves REKICK unconsumed
**Story:** FR-2 happy (pending sentinel on parked worktree: resume skipped, sentinel intact)
**Type:** negative-path
**Steps:**
1. Failing test: worktree with `.pipeline/REKICK` + parked marker → the resume path is not
   entered and the sentinel file still exists afterward (contrast: un-parked consumes it).
2. RED → guard the `resumeRebaseFirst` call site (dispatch layer, not the primitive) → GREEN.
3. Commit: "feat(conductor): parked worktrees skip rekick-sentinel resume, sentinel preserved"
**Files:** dispatch call-site module + tests
**Dependencies:** Task 7

### Task 9: CLI verbs — declaration + pre-boot detector
**Story:** FR-1 happy (park known slug, no daemon required), FR-4 happy (unpark), FR-1 negative
(typo subcommand fails loudly)
**Type:** happy-path
**Steps:**
1. Failing tests: `detectDaemonParkCommand(argv)` recognizes `daemon park <slug>` /
   `daemon unpark <slug>` and nothing else; handler writes/removes via park-marker module and
   prints the confirmation ("will not be dispatched or re-kicked until unparked" /
   removal message); `daemon parkk` falls to the unknown-subcommand guard (regression
   assertion); verbs appear in `renderFullHelp` output.
2. RED → declare both commands in `src/cli.ts` daemon group; add detector + handler dispatch in
   `src/index.ts` pre-boot chain → GREEN.
3. Commit: "feat(conductor): daemon park/unpark verbs — filesystem-direct, pre-boot dispatch"
**Files:** `src/conductor/src/cli.ts`, `src/conductor/src/index.ts`, new
`src/conductor/src/engine/daemon-park-cli.ts` (handler) + tests
**Dependencies:** Task 1, Task 2

### Task 10: CLI verbs — validation + edge semantics
**Story:** FR-1 negative (unknown slug → non-zero, nothing written; fresh checkout mkdir
chain), FR-7 happy (re-park exit 0 reports existing park), FR-4 negative (unpark not-parked →
exit 0 no-op message)
**Type:** negative-path
**Steps:**
1. Failing tests: unknown slug (no `.docs/plans/<slug>.md`, no worktree dir) → exit non-zero,
   `.daemon/parked/` unchanged; known-by-worktree-only slug parks; fresh checkout (no
   `.daemon/`) parks; re-park → exit 0 + original timestamp reported, mtime unchanged; unpark
   when absent → exit 0 + "was not operator-parked" message.
2. RED → implement validation + messages in the handler → GREEN.
3. Commit: "feat(conductor): park verb validation — unknown slug rejected, idempotent edges"
**Files:** `daemon-park-cli.ts` + tests
**Dependencies:** Task 9

### Task 11: dashboard — PARKED group with absolute precedence
**Story:** FR-6 happy (both-markers slug renders once as PARKED; undispatched parked slug under
PARKED not ELIGIBLE), FR-6 negative (no-parks output unchanged; stale park visible)
**Type:** happy-path
**Steps:**
1. Failing tests in the dashboard suite: state builder takes a parked-slugs input (listed via
   park-marker module); fixture with every group (HALTED, PROCESSED, GATED, IN-PROGRESS,
   WAITING, ELIGIBLE) plus parked overlaps → parked slug appears ONLY under PARKED regardless
   of which other group it matches; no-parks fixture renders byte-identical to current
   expectations; stale park (no worktree/backlog) listed under PARKED.
2. RED → add PARKED group first in `buildState`/`renderDashboard`
   (`engine/daemon-dashboard.ts`), exclusion set threaded like `haltedSlugs` → GREEN.
3. Commit: "feat(conductor): dashboard PARKED group — operator-parked outranks all groups"
**Files:** `src/conductor/src/engine/daemon-dashboard.ts` + tests, wiring in `daemon-cli.ts`
**Dependencies:** Task 1, Task 6

### Task 12: single-writer invariant sweep
**Story:** FR-7 negative (no daemon code path writes/removes `.daemon/parked/`)
**Type:** negative-path
**Steps:**
1. Failing test: static assertion test that greps `src/conductor/src` for `parked` writes —
   only `park-marker.ts` contains write/remove primitives and only `daemon-park-cli.ts` calls
   them (module-API-shape check: engine consumers import only `isOperatorParked`/list).
2. RED → adjust exports if needed (e.g. read-only surface for engine consumers) → GREEN.
3. Commit: "test(conductor): operator-park single-writer invariant"
**Files:** new invariant test
**Dependencies:** Tasks 6, 7, 9, 11

### Task 13: docs — README, conductor README, CHANGELOG
**Story:** PRD acceptance criterion (docs + changelog, repo rule)
**Type:** infrastructure
**Steps:**
1. Add `daemon park|unpark` to `README.md` and `src/conductor/README.md` (verbs, marker
   location, PARKED dashboard group, "operator-parked vs halted" terminology note).
2. Add CHANGELOG `## [Unreleased]` → Added entry.
3. Commit: "docs: operator park/unpark verbs, PARKED state, changelog"
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Tasks 9-11 (documents final behavior)

### Task 14: integrity + full suite
**Story:** repo validation rule
**Type:** infrastructure
**Steps:**
1. Run `test/test_harness_integrity.sh` — fix any failure.
2. Run `rtk proxy npx vitest run` in `src/conductor` — full suite green (regression gate for
   FR-5's "existing rekick suite passes unchanged").
3. Commit any fixes.
**Files:** n/a
**Dependencies:** all prior

## Task Dependency Graph

```
T1 ─┬─ T2 ─────────────┐
    ├─ T3 ─ T4 ─ T5    ├─ T9 ─ T10 ─┐
    │    └─ T6 ────────┤            ├─ T12 ─ T13 ─ T14
    ├─ T7 ─ T8         │            │
    └─ T11 (also ← T6) ┴────────────┘
```
(T12 after T6/T7/T9/T11; T13 after verbs+dashboard; T14 last.)

## Integration Points

- After Task 6: park a halted worktree by hand-writing the marker → run a real sweep → HALT
  survives a base advance end-to-end.
- After Task 10: full operator flow `daemon park <slug>` → merge to main → no re-dispatch →
  `daemon unpark <slug>` → normal re-kick, all via CLI.
- After Task 11: `daemon status`/startup dashboard shows the PARKED bucket.

## Verification

- [ ] All happy path criteria covered: FR-1 (T1,T9), FR-2 (T6,T7,T8), FR-3 (T3), FR-4 (T9,T10),
      FR-5 (T5), FR-6 (T11), FR-7 (T2,T10)
- [ ] All negative path criteria covered: FR-1 (T9,T10), FR-2 (T2), FR-3 (T4), FR-4 (T10),
      FR-5 (T5), FR-6 (T11), FR-7 (T2,T12)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic
- [ ] Conflict-check constraints honored: parked-first ordering (T3), fail policies intact
      (T3/T4 vs isProcessed untouched), "operator-parked" terminology (all tasks)
