# Implementation Plan: Daemon merged-PR guard on step retry (#358)

**Date:** 2026-07-09
**Design:** .docs/decisions/adr-2026-07-09-mid-run-merged-pr-guard.md (APPROVED)
**Stories:** .docs/stories/2026-07-09-daemon-merged-pr-guard-on-retry.md (Status: Accepted, TS-1..TS-5)
**Conflict check:** Clean as of 2026-07-09 (.docs/conflicts/2026-07-09-daemon-merged-pr-guard-on-retry.md)

## Summary

Adds a fail-open merged-PR guard at three points (kickback re-entry, rebase entry, rekick
play-forward) so a PR merged out-of-band mid-run retires the feature cleanly instead of
rebuilding/rebasing into a self-inflicted HALT. 14 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/merged-pr-guard.ts`** with two pure-ish primitives:
  - `checkMergedPrGuard(runGh, cwd, prUrl, log) → 'merged' | 'proceed'` — thin wrapper over the
    existing `prMergeState` (`pr-labels.ts:277`). No `prUrl` → `'proceed'` with **zero** gh
    calls; `MERGED` → `'merged'`; `OPEN`/`CLOSED`/`NOTFOUND`/`UNKNOWN`/throw → `'proceed'`
    (fail-open, log at debug). Single-shot — no retry/poll wrapper.
  - `writeSyntheticShipMarkers(projectRoot, headSha, log)` — idempotently writes
    `.pipeline/finish-choice` = `pr` (`FINISH_CHOICE_MARKER`, `artifacts.ts:317`) and
    `.pipeline/DONE`, leaves `conduct-state.json` untouched, logs
    `already shipped out-of-band; local branch retained at <sha>`.
- **Conductor wiring:** `ConductorOptions` gains optional `runGh?: GhRunner` (default
  `makeProductionGh()`, the factory already used in-engine at `artifacts.ts:1180`) — same
  injected-collaborator pattern as `selfHostGuardrails`. A private
  `stopIfPrMerged(state): Promise<boolean>` (daemon-mode only, reads `state.pr_url`) is called:
  1. at each kickback-to-build/`navigateBack` route before the rewind is committed —
     `conductor.ts` sites ~1786 (manual_test), ~1856 (build_review), ~1975 (prd_audit),
     ~2046 (finish/as-built remediation route), ~1917 (remediation route) — on `'merged'` it
     writes the synthetic markers, emits the completion event, detaches signal handlers
     (mirroring the existing `loop_halt` return path shape at ~2000), and returns from `run()`
     successfully;
  2. at the top of `runRebaseStep` (~2880, after the `!daemon` noop, before `performRebase`).
- **Rekick wiring:** `resumeRebaseFirst` (`daemon-rekick.ts:303`) gains optional
  `runGh` + `prUrl` opts (optional = backward-compatible, matching the `isProcessed?` pattern
  in `RekickSweepDeps`); on `'merged'` it returns a new `'already_shipped'` outcome without
  calling `performRebase` (:331). The sweep handles that outcome: `markProcessed(slug, prUrl)`
  (`daemon-deps.ts:99`), clear the marker, skip re-dispatch, log the out-of-band line. The
  daemon layer wires `runGh` from its existing production deps (`daemon-deps.ts:62`) and reads
  `prUrl` from the worktree's `conduct-state.json` (same read as `readWorktreeOutcome`,
  `daemon-deps.ts:224-262`).
- **Ship side-effects stay owned by daemon-runner:** the conductor only emits markers;
  `readWorktreeOutcome` → `isVerifiedShip` (`daemon-runner.ts:144`) → existing
  `markProcessed`/cleanup path. No second ship pathway.
- **Sequencing:** module first, then conductor plumbing, then the three sites (each with its
  negative table), then the daemon-runner integration proof, then cost-bound + changelog.
- **Tests:** vitest in `src/conductor` (`rtk proxy npx vitest run`). Fake `GhRunner` per
  `test/engine/daemon-runner-mergeable.test.ts` (`makeGhFake`); rebase tests use
  `daemon: true` + isolated repo (existing rebase test pattern); rekick tests reuse the
  daemon-rekick fixtures.

## Prerequisites

None — no migrations, no new dependencies, no CLI/schema/hook changes (internal-only surface;
no migration block required).

## Tasks

### Task 1: Guard verdict mapping — checkMergedPrGuard
**Story:** TS-1/TS-2/TS-5 (shared primitive); TS-4 single-shot
**Type:** infrastructure

**Steps:**
1. Write failing tests: fake GhRunner returning each of MERGED/OPEN/CLOSED/NOTFOUND/UNKNOWN
   maps to 'merged'/'proceed'×4; a throwing runner → 'proceed'; `prUrl: undefined` → 'proceed'
   with the call-counter asserting zero gh invocations.
2. Verify RED.
3. Implement `checkMergedPrGuard` as a thin wrapper over `prMergeState`; single call, no retry.
4. Verify GREEN.
5. Commit: "feat(engine): merged-pr-guard verdict mapping (#358)"

**Files:**
- src/conductor/src/engine/merged-pr-guard.ts
- src/conductor/test/engine/merged-pr-guard.test.ts

**Dependencies:** none

### Task 2: Synthetic ship markers — writeSyntheticShipMarkers
**Story:** TS-1 happy (markers), TS-3 idempotency
**Type:** infrastructure

**Steps:**
1. Write failing tests: after invoke, `.pipeline/finish-choice` == `pr` and `.pipeline/DONE`
   exists; pre-existing `conduct-state.json` byte-identical; double-invoke → same content, no
   throw; log line contains `already shipped out-of-band` + the passed SHA.
2. Verify RED.
3. Implement using `FINISH_CHOICE_MARKER` and the DONE path; idempotent writes.
4. Verify GREEN.
5. Commit: "feat(engine): synthetic verified-ship markers (#358)"

**Files:** same

**Dependencies:** none

### Task 3: Conductor runGh plumbing
**Story:** TS-1 (enabler)
**Type:** infrastructure

**Steps:**
1. Write failing test: constructing a Conductor with an injected fake `runGh` exposes it to the
   guard path (observable via Task 4's seam — here assert option accepted + default factory
   used when omitted, without any behavior change; existing conductor tests stay green).
2. Verify RED (compile/assert).
3. Add `runGh?: GhRunner` to `ConductorOptions`, default `makeProductionGh()` lazily.
4. Verify GREEN + full conductor.test.ts pass.
5. Commit: "feat(engine): inject GhRunner into ConductorOptions (#358)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** none

### Task 4: Kickback guard at the finish-remediation route — happy path
**Story:** TS-1 happy (all three criteria)
**Type:** happy-path

**Steps:**
1. Write failing engine test (daemon:true): drive a finish completion-check failure whose
   remediation routes to build, fake gh → MERGED; assert NO build re-dispatch, run returns
   successfully, `.pipeline/finish-choice` == `pr`, `.pipeline/DONE` present, `pr_url`
   unchanged in conduct-state, log matches `already shipped out-of-band` + 40-hex SHA.
2. Verify RED.
3. Implement `stopIfPrMerged` + call it in the finish/as-built remediation route
   (conductor.ts ~2046) before `navigateBack`; on 'merged' write markers, emit completion
   event, detach signal handlers, return.
4. Verify GREEN.
5. Commit: "feat(engine): merged-PR guard at finish-remediation kickback (#358)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/merged-pr-guard-kickback.test.ts

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: Kickback guard — non-MERGED verdict table
**Story:** TS-1 negatives (OPEN, CLOSED, gh failure)
**Type:** negative-path

**Steps:**
1. Write failing table-driven tests: verdicts OPEN/CLOSED/NOTFOUND/UNKNOWN and a throwing
   runner → the rewind proceeds (build re-dispatched exactly as today), NO finish-choice, NO
   DONE written by the guard, no HALT introduced.
2. Verify RED (if guard were wrongly closed) / assert behavior.
3. Adjust guard to fail-open on every non-MERGED path; debug-level log on throw.
4. Verify GREEN.
5. Commit: "test(engine): kickback guard fail-open verdict table (#358)"

**Files:** same as Task 4

**Dependencies:** Task 4

### Task 6: Kickback guard — inactive without pr_url / outside daemon mode
**Story:** TS-1 negatives (no pr_url, non-daemon)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) no `pr_url` in state + call-counting fake → zero gh calls, rewind
   unchanged; (b) daemon:false with `pr_url` set → zero gh calls, behavior identical.
2. Verify RED.
3. Gate `stopIfPrMerged` on `this.daemon && state.pr_url`.
4. Verify GREEN.
5. Commit: "test(engine): kickback guard inactivity gates (#358)"

**Files:** same as Task 4

**Dependencies:** Task 4

### Task 7: Guard on the remaining kickback routes
**Story:** TS-1 happy ("any of the five kickback routes")
**Type:** happy-path

**Steps:**
1. Write failing parameterized tests covering the manual_test (~1786), build_review (~1856),
   prd_audit (~1975) and generic remediation (~1917) routes: MERGED short-circuits each; one
   non-MERGED case per route proves pass-through.
2. Verify RED.
3. Insert the same `stopIfPrMerged` call before each remaining `navigateBack(state,'build',…)`
   site.
4. Verify GREEN.
5. Commit: "feat(engine): merged-PR guard on all kickback routes (#358)"

**Files:** same as Task 4

**Dependencies:** Task 4

### Task 8: Rebase backstop — happy path
**Story:** TS-2 happy (both criteria)
**Type:** happy-path

**Steps:**
1. Write failing test (daemon:true, isolated repo per existing rebase test pattern): enter
   `runRebaseStep` with fake gh → MERGED; assert `performRebase` NOT invoked (spy seam), no
   `.pipeline/HALT`, both markers present, branch tip SHA unchanged, run ends successfully.
2. Verify RED.
3. Call `stopIfPrMerged` at the top of `runRebaseStep` (after the `!daemon` noop, before
   `performRebase` at ~2882); on 'merged' produce the clean-stop outcome.
4. Verify GREEN.
5. Commit: "feat(engine): merged-PR backstop at rebase entry (#358)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/merged-pr-guard-rebase.test.ts

**Dependencies:** Task 1, Task 2, Task 3

### Task 9: Rebase backstop — negatives (real conflicts still HALT)
**Story:** TS-2 negatives (OPEN+conflict, gh failure, no pr_url)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) OPEN verdict + genuinely conflicting branch → existing
   `conflict_halt` flow runs, `.pipeline/HALT` written exactly as today; (b) throwing runner →
   `performRebase` proceeds; (c) no `pr_url` → zero gh calls, rebase proceeds.
2. Verify RED.
3. Ensure the guard never swallows `RebaseOutcome` handling on 'proceed'.
4. Verify GREEN.
5. Commit: "test(engine): rebase backstop preserves conflict HALT (#358)"

**Files:** same as Task 8

**Dependencies:** Task 8

### Task 10: Daemon-runner integration — synthetic ship flows through isVerifiedShip
**Story:** TS-3 (happy + both negatives)
**Type:** happy-path

**Steps:**
1. Write failing daemon-runner tests (existing fixture pattern): (a) a guard-terminated
   worktree (markers from Task 2 + pr_url) → `readOutcome` → verified ship → `markProcessed`
   called with slug + prUrl; (b) a halted non-guard outcome → zero `markProcessed` calls;
   (c) marker idempotency: guard stop path invoked twice → single ledger entry, stable content.
2. Verify RED.
3. No production change expected — this pins the integration; fix any seam mismatch found.
4. Verify GREEN.
5. Commit: "test(engine): synthetic ship rides the verified-ship path (#358)"

**Files:**
- src/conductor/test/engine/daemon-runner.test.ts
- src/conductor/src/engine/daemon-runner.ts

**Dependencies:** Task 2

### Task 11: Rekick play-forward guard — happy path
**Story:** TS-5 happy
**Type:** happy-path

**Steps:**
1. Write failing rekick test (daemon-rekick fixtures): halted worktree with recorded pr_url,
   fake gh → MERGED; assert NO `performRebase` call, `resumeRebaseFirst` returns
   `'already_shipped'`, sweep writes `.daemon/processed/<slug>` with the prUrl, no re-dispatch,
   log line present.
2. Verify RED.
3. Add optional `runGh`/`prUrl` opts to `resumeRebaseFirst` (daemon-rekick.ts:303), check via
   `checkMergedPrGuard` before `performRebase` (:331); add the `'already_shipped'` outcome and
   handle it in the sweep (markProcessed + clearMarker + skip); wire production `runGh` +
   conduct-state `pr_url` read in the daemon layer.
4. Verify GREEN.
5. Commit: "feat(engine): merged-PR guard on rekick play-forward (#358)"

**Files:**
- src/conductor/src/engine/daemon-rekick.ts
- src/conductor/src/engine/daemon-deps.ts
- src/conductor/test/engine/daemon-rekick.test.ts

**Dependencies:** Task 1

### Task 12: Rekick guard — negatives (byte-identical pass-through)
**Story:** TS-5 negatives
**Type:** negative-path

**Steps:**
1. Write failing table tests: OPEN verdict / throwing runner / absent pr_url (no gh call,
   counter-asserted) → the existing gated rebase-resolution flow runs byte-identically
   (per 2026-07-05-rekick-gated-rebase-resolution stories: same outcomes, same HALT timing).
2. Verify RED.
3. Ensure opts absent → zero new code paths execute (backward compatibility).
4. Verify GREEN.
5. Commit: "test(engine): rekick guard fail-open pass-through (#358)"

**Files:** same as Task 11

**Dependencies:** Task 11

### Task 13: Cost bound — exactly one query per checkpoint
**Story:** TS-4 (happy + timeout negative)
**Type:** negative-path

**Steps:**
1. Write failing test: one kickback + one rebase entry over a non-MERGED PR with a
   call-counting fake → exactly 2 guard queries for the whole chain; assert no retry wrapper
   by driving a slow/erroring runner once and observing a single attempt.
2. Verify RED.
3. Remove any accidental double-query (e.g. re-check inside the same checkpoint).
4. Verify GREEN.
5. Commit: "test(engine): guard query budget — one per checkpoint (#358)"

**Files:**
- src/conductor/test/engine/merged-pr-guard-kickback.test.ts
- src/conductor/test/engine/merged-pr-guard-rebase.test.ts

**Dependencies:** Task 7, Task 9

### Task 14: CHANGELOG + docs upkeep
**Story:** repo release gate (CLAUDE.md)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Fixed: mid-run merged-PR guard (#358), three sites.
2. Add a short paragraph to `src/conductor/README.md` daemon behavior section describing the
   out-of-band-merge guard (internal behavior, no new flags).
3. Run `test/test_harness_integrity.sh`; fix any failures.
4. Commit: "docs: changelog + conductor README for merged-PR guard (#358)"

**Files:**
- CHANGELOG.md
- src/conductor/README.md

**Dependencies:** Task 13

## Task Dependency Graph

```
1 ──┬─► 4 ──► 5
2 ──┤        6
3 ──┘        7 ──► 13 ──► 14
1,2,3 ─► 8 ─► 9 ──► 13
2 ─► 10
1 ─► 11 ─► 12
```

## Integration Points

- After Task 4: the #358 incident scenario is reproducible end-to-end in a test (finish fails →
  operator merges → daemon exits cleanly).
- After Task 10: the full conductor→daemon-runner ship handoff is proven.
- After Task 12: all three ADR insertion points are live; the class is closed.

## Coverage Mapping

| Criterion | Task(s) |
|---|---|
| TS-1 happy (no re-dispatch, markers, log+SHA) | 4, 7 |
| TS-1 neg OPEN/CLOSED/gh-fail | 5 |
| TS-1 neg no-pr_url / non-daemon | 6 |
| TS-2 happy (no performRebase, branch retained) | 8 |
| TS-2 neg conflict-HALT preserved / gh-fail / no-pr_url | 9 |
| TS-3 happy (markProcessed via verified ship) + dedup skip | 10 |
| TS-3 neg (no fabricated ship) + idempotency | 10 |
| TS-5 happy (rekick retire) | 11 |
| TS-5 negatives (pass-through) | 12 |
| TS-4 (bounded cost, no polling) | 13 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (5, 6, 9, 12, 13)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Full suite green via `rtk proxy npx vitest run` in src/conductor before finish
