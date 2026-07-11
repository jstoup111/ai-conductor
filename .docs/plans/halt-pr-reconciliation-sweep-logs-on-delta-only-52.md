# Implementation Plan: Halt-PR reconciliation sweep logs on delta only

**Date:** 2026-07-11
**Track:** technical (`.docs/track/halt-pr-reconciliation-sweep-logs-on-delta-only-52.md`)
**Complexity:** Tier S (`.docs/complexity/halt-pr-reconciliation-sweep-logs-on-delta-only-52.md`)
**Stories:** `.docs/stories/halt-pr-reconciliation-sweep-logs-on-delta-only-52.md` (Status: Accepted)
**Source:** jstoup111/ai-conductor#521

## Summary

The daemon's halt-PR reconciliation sweep (`reconcileHaltPrs`) is stateless and
re-emits its full per-PR observation every idle tick, so an all-conforming idle
daemon fills 42% of daemon.log with no-op "already conforming … skipping" lines
(#521: 308/740 lines, 79 sweeps, zero actions). This plan adds a small in-memory
per-PR outcome cache, threaded through the existing `ReconcileOpts` seam and
owned per daemon run by `runDaemonMode`, and gates the per-PR and summary log
lines on a state delta. Action lines (healing / healed / unconfirmed / error)
stay verbatim and are never suppressed. 4 tasks.

## Technical Approach

- **Cache shape:** a `Map<string, PrSweepOutcome>` keyed by PR URL, where
  `PrSweepOutcome = 'conforming' | 'healed' | 'unconfirmed'`. Passed in via a new
  optional `cache?: Map<string, PrSweepOutcome>` field on `ReconcileOpts`
  (`halt-pr-reconciliation.ts:24-28`). When absent, `reconcileHaltPrs` uses a
  throwaway `new Map()` per call — reproducing today's "log every line" behavior
  exactly, so existing tests stay green and no caller is forced to change.
- **Per-PR delta gate (Step 3 loop, `halt-pr-reconciliation.ts:69-93`):** for a
  conforming PR, emit the `already conforming … skipping` line only when
  `cache.get(url) !== 'conforming'`; then set `conforming`. For a non-conforming
  PR, always emit the existing `healing …` + result lines (action path,
  unconditional) and set `healed` / `unconfirmed` from the result. Errors
  (`error healing …`) are always logged, verbatim.
- **Prune:** after the loop, delete cache entries whose URL is no longer in the
  current marked-PR set (silent) so merged/closed PRs don't leak and a re-opened
  URL is re-observed as first-seen.
- **Summary delta gate (`:66`):** track the last `(prList.length,
  markedPrs.length)` signature on the cache carrier (a small companion field —
  a second `Map`/object slot, or a `WeakMap`-free wrapper: use a dedicated
  optional `summaryState?: { sig: string }` on `ReconcileOpts` mirroring the
  cache, OR store a sentinel key in the same Map). Emit the summary line only
  when a per-PR line was emitted this sweep OR the signature changed since last
  sweep; otherwise suppress. Absent carrier → always emit (legacy behavior).
- **Per-run ownership (`daemon-cli.ts`):** declare
  `const haltPrSweepCache = new Map<string, PrSweepOutcome>()` (and its summary
  companion) once inside `runDaemonMode` (function starts `:372`; declare
  alongside the other per-run consts, before the deps object), and pass it in
  the existing wiring at `:1216-1218`. In-memory by construction → a restart
  starts empty → the first post-boot sweep re-logs a full baseline, then falls
  silent (Story 4). No disk persistence.
- All gh access stays behind the existing injected `runGh`/`makeProductionGh`
  seam; every new branch is unit-tested with the existing `fakeGh` pattern and an
  array `log` collector (`test/engine/halt-pr-reconciliation.test.ts:32-60`).
  Tests run from `src/conductor` (`rtk proxy npx vitest run <file>`).

## Prerequisites

- None beyond the repo as-is. Verified present on main:
  `halt-pr-reconciliation.ts:24-28` (`ReconcileOpts`), `:43-98`
  (`reconcileHaltPrs`), `:66` (summary line), `:69-93` (per-PR loop);
  `daemon-cli.ts:372` (`runDaemonMode`), `:1216-1218` (sweep wiring);
  `test/engine/halt-pr-reconciliation.test.ts` (fakeGh + log-collector harness).

## Tasks

### Task 1: Add the in-memory outcome cache seam + per-PR delta gate
**Story:** Story 1 (steady-state silence), Story 2 (first-observation logs once),
Story 4 (fresh vs warm cache)
**Type:** happy-path

**Steps:**
1. Write failing tests (extend the existing suite): (a) a warm cache holding
   `conforming` for all marked PRs → a sweep over the same conforming set logs
   zero per-PR lines; (b) a fresh cache → each conforming PR's line logged once,
   and a second sweep with the same cache logs zero; (c) a PR removed from the
   list has its cache entry pruned (assert via a follow-up sweep where its URL
   re-appears and is logged again as first-seen).
2. Verify RED.
3. Implement: add `PrSweepOutcome` type + `cache?` to `ReconcileOpts`; in the
   Step-3 loop gate the `already conforming … skipping` line on
   `cache.get(pr.url) !== 'conforming'`, set `conforming` after; default to a
   throwaway `new Map()` when `cache` is absent; prune non-marked URLs after the
   loop.
4. Verify GREEN (including all pre-existing `reconcileHaltPrs` tests).
5. Commit: "feat(halt-pr-recon): in-memory per-PR outcome cache + delta-gated conforming log (#521)"

**Files:**
- src/conductor/src/engine/halt-pr-reconciliation.ts
- src/conductor/test/engine/halt-pr-reconciliation.test.ts

**Dependencies:** none

### Task 2: Keep action + error lines verbatim; log first post-heal conforming once
**Story:** Story 3 (action always logs), Story 2 (state-change transition logged)
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) a PR that returns `unconfirmed` two sweeps in a row
   (same cache) logs its `healing …` + `heal unconfirmed …` lines on BOTH sweeps
   (action never suppressed); (b) a PR that heals to `confirmed`, then is
   observed conforming next sweep, logs the `already conforming` line exactly
   once on that first post-heal sweep and zero thereafter; (c) a throwing
   `ensureHaltPresentation` still logs `error healing <url>: <err>` and continues.
2. Verify RED.
3. Implement: in the loop, always emit the `healing …`/result/error lines and
   record `healed`/`unconfirmed` in the cache; ensure the conforming-line gate
   from Task 1 treats a prior `healed`/`unconfirmed` outcome as a delta (so the
   first conforming observation after a heal logs once).
4. Verify GREEN.
5. Commit: "feat(halt-pr-recon): action/error lines stay verbatim; post-heal conforming logs once (#521)"

**Files:**
- src/conductor/src/engine/halt-pr-reconciliation.ts
- src/conductor/test/engine/halt-pr-reconciliation.test.ts

**Dependencies:** 1

### Task 3: Delta-gate the summary line
**Story:** Story 2 (summary emitted only on delta), Story 1 (steady-state silence
includes the summary)
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) a warm, all-conforming steady-state sweep logs zero
   lines total — including no summary line; (b) a sweep whose (open, marked)
   counts changed since last sweep logs exactly one summary line; (c) a sweep
   that emits ≥1 per-PR line also emits exactly one summary line.
2. Verify RED.
3. Implement: track the last `(prList.length, markedPrs.length)` signature on the
   carrier; emit the `enumerated … found … marked` line only when a per-PR line
   was emitted this sweep OR the signature differs from the last; absent carrier
   → always emit (legacy).
4. Verify GREEN (including all pre-existing tests, which pass an absent carrier
   and therefore still see the summary line).
5. Commit: "feat(halt-pr-recon): delta-gate the sweep summary line (#521)"

**Files:**
- src/conductor/src/engine/halt-pr-reconciliation.ts
- src/conductor/test/engine/halt-pr-reconciliation.test.ts

**Dependencies:** 1

### Task 4: Own the cache per daemon run in `runDaemonMode`
**Story:** Story 4 (in-memory, owned per run; one full log post-boot then quiet)
**Type:** infrastructure

**Steps:**
1. Write failing test: a unit test exercising the wiring path (or a focused test
   that constructs two independent caches and confirms the first re-logs while a
   shared warm cache stays silent) asserting (a) sweep 1 with a fresh cache logs
   a full baseline, sweep 2 with the same cache is silent, and (b) a second fresh
   cache re-logs (no cross-run suppression — proves in-memory, not persisted).
2. Verify RED (or assert the wiring gap: caller currently passes no cache).
3. Implement: declare `const haltPrSweepCache = new Map<string, PrSweepOutcome>()`
   (plus its summary companion) inside `runDaemonMode` alongside the other
   per-run consts (before the deps object, ~`:1060`), and pass it in the existing
   `reconcileHaltPrs({ projectRoot, log })` wiring at `:1216-1218`. No disk write.
4. Verify GREEN. Run the full `halt-pr-reconciliation` + affected `daemon-cli`
   suites from `src/conductor`.
5. Commit: "feat(daemon): own the halt-pr-recon outcome cache per run — silent idle sweeps (#521)"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/halt-pr-reconciliation.test.ts (or the daemon-cli wiring test)

**Dependencies:** 1, 2, 3

## Task Dependency Graph

```
Task 1 (cache seam + per-PR delta gate)
  ├─> Task 2 (action lines verbatim + post-heal transition)
  ├─> Task 3 (summary delta gate)
  └───────────────┐
Task 2 ───────────┤
Task 3 ───────────┴─> Task 4 (per-run ownership wiring in runDaemonMode)
```

Task 1 is the foundation (introduces the cache type + seam). Tasks 2 and 3 build
independently on Task 1 and may proceed in parallel. Task 4 wires the completed
logic into the daemon and depends on 1–3.

## Verification

- **Automated:** `cd src/conductor && rtk proxy npx vitest run test/engine/halt-pr-reconciliation.test.ts`
  green (new + all pre-existing cases). Full affected suite:
  `rtk proxy npx vitest run test/engine/` for daemon-cli wiring.
- **Behavioral (per #521 desired outcomes):**
  - Steady-state: a warm-cache sweep over an all-conforming unchanged marked set
    emits zero lines (Story 1 test asserts `log.length === 0` across ≥3 sweeps).
  - First-observation / action: a newly-marked or healed PR logs once, then goes
    silent; a repeated-`unconfirmed` heal logs every sweep (Stories 2, 3 tests).
  - Post-boot: a fresh cache logs a full baseline then falls silent; a second
    fresh cache re-logs (Story 4 test — proves in-memory, no cross-run
    suppression).
- **Harness integrity:** `test/test_harness_integrity.sh` green; `CHANGELOG.md`
  `[Unreleased]` gains a Changed/Fixed entry for the delta-gated sweep logging.
  No CLI/hook/schema/skill-symlink surface touched → no migration block (Release
  Gate 2).

## Coverage Mapping

| Story | Tasks | Verification |
| --- | --- | --- |
| Story 1 — steady-state silence | 1, 3 | zero-line assertion across repeated warm-cache sweeps; summary suppressed |
| Story 2 — new/changed logs once | 1, 2, 3 | first-observation logs once then silent; summary delta-gated |
| Story 3 — action always logs | 2 | healing/unconfirmed/error lines verbatim every action sweep |
| Story 4 — cache-loss re-logs baseline | 1, 4 | fresh cache full log then quiet; second fresh cache re-logs (in-memory) |
