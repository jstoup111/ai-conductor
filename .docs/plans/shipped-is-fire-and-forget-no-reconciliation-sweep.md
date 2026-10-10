# Implementation Plan: Shipped PRs get a re-examined readiness verdict (#438)

**Date:** 2026-10-09
**Design:** `.docs/decisions/adr-2026-10-09-shipped-pr-readiness-verdict.md` (technical track, no PRD)
**Stories:** `.docs/stories/shipped-is-fire-and-forget-no-reconciliation-sweep.md`
**Conflict check:** Clean as of 2026-10-09

## Summary

Each sweep tick classifies every open daemon-shipped (watched) PR into one closed readiness verdict
and routes each verdict to exactly one existing mechanism. Verdicts go on the daemon event ledger,
and `daemon status` lists the shipped PRs that are not ready. 10 tasks.

## Technical Approach

- **Read (`src/conductor/src/engine/pr-labels.ts`).** `prMergeState` adds `mergeStateStatus`,
  `baseRefName`, and `headRefOid` to its `gh pr view --json` field list and to `PrMergeState`
  (optional fields, so existing fixtures stay valid). The tracker's `readPullRequestMergeState`
  already delegates to it, so no tracker change is needed.
- **Classifier (new `src/conductor/src/engine/shipped-readiness.ts`).** A pure
  `classifyShippedReadiness(state, observation, now)` returns one member of
  `ShippedReadinessVerdict = 'ready' | 'conflicting' | 'ci-failing' | 'ci-pending' | 'no-checks' | 'draft' | 'indeterminate'`
  using the ADR D2 precedence. `observation` carries whether the mergeability re-read happened or
  failed and the head commit's first-seen time. The grace constant `SHIPPED_READINESS_GRACE_MS`
  (30 minutes) lives here. A helper `routeShippedReadiness` is an exhaustive `switch` with no
  `default`, ending in an `assertNever` so a missing case fails `tsc`.
- **Sweep (`src/conductor/src/engine/mergeable-sweep.ts`).** Inside the existing per-entry loop,
  after the unchanged MERGED / CLOSED / NOTFOUND / read-failure handling: re-read once when
  `mergeable === 'UNKNOWN'`, record the head commit's first-seen time on the entry, classify, then
  route. `indeterminate` skips the existing label reconcile and every mutation; every other verdict
  keeps the existing `mergeable` label reconcile. Autoresolve and ci-fix candidate collection is
  driven by the verdict (`conflicting`, `ci-failing`); drafts never reach either.
- **Readiness label (`mergeable-sweep.ts`).** `no-checks` and `draft` add `needs-remediation` only
  on the absent→present transition and record `escalationCause: 'shipped-readiness'`. A new
  `maybeClearReadinessLabel` mirrors `maybeClearConflictLabel` (bounded by the existing
  `labelClearAttempts`, cap 3): it removes the label only when the recorded cause is
  `shipped-readiness`, the verdict is not `no-checks`/`draft`/`ci-pending`/`indeterminate`, and the PR has no
  halt body marker. No operation is added to `GITHUB_OPERATION_REGISTRY`.
- **Watch entry.** `WatchEntry` gains optional `headSha`, `headFirstSeenAt`,
  `readinessEmitted?: { verdict; headSha }`, and `escalationCause` widens to
  `'conflict-resolution' | 'shipped-readiness'`. All are written through the existing
  `rewriteWatch`; legacy lines parse unchanged.
- **Event (`src/conductor/src/types/events.ts`).** New `ConductorEvent` variant
  `shipped_pr_readiness` with `prUrl`, `slug`, `verdict`, `headSha`, `mergeable`,
  `mergeStateStatus`, `checksOutcome`, `isDraft`, `baseRefName`. The sweep emits it only when
  `(verdict, headSha)` differs from `entry.readinessEmitted`, through its existing `onEvent`
  option, inside a `try/catch` so a listener failure never stops the sweep.
- **Wiring (`src/conductor/src/daemon-cli.ts`).** The production `sweepMergeableLabels` binding
  passes `onEvent: (e) => events.emit(e)` to the daemon's global `ConductorEventEmitter`, which
  `startDaemonEventPersistence` already persists to `.daemon/events.jsonl`. This also makes the
  sweep's existing `ci_failed` events reach the ledger.
- **Status (`src/conductor/src/engine/daemon-observe-cli.ts`).** A `SHIPPED PRS` per-repo section
  reads the latest `shipped_pr_readiness` per `prUrl` from `.daemon/events.jsonl`, restricted to PRs
  still present in `.daemon/mergeable-watch.jsonl` so merged or closed PRs drop off.

**Local pattern context.**
- *Label self-clear:* follow `maybeClearConflictLabel` in `mergeable-sweep.ts` (search
  `escalationCause !== 'conflict-resolution'`). Traits to keep: act only on an attributed cause;
  drop the cause when the label is already gone; hold while the PR shows a halt body marker or a
  read failure; bump `labelClearAttempts` per removal attempt and give up at 3 with a log line.
  Allowed variation: the cause value and the "state has recovered" predicate (verdict-based here).
- *Status ledger read:* follow `readLatestReadOnlyReviewCapabilities` in `daemon-observe-cli.ts`
  (search `CAPABILITY_EVENT_SCAN_CHUNK_BYTES`). Traits to keep: chunked backwards scan of
  `.daemon/events.jsonl`, only complete lines parsed, latest record wins per key, a missing file
  returns an "unknown" result rather than throwing, malformed lines skipped. Allowed variation: the
  event type filtered and the key (`prUrl`).
- *Label-once transition:* follow ship-ci exhaustion in `mergeable-sweep.ts` (search
  `CI_EXHAUSTION_MARKER`): mutate only on the label-absent→present transition.

## Prerequisites

- None. No config key, migration, or new dependency.

## Tasks

### Task 1: Read mergeStateStatus, base branch, and head commit with PR state
**Story:** Story 1, Story 2, Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pr-labels-merge-state.test.ts`: a stubbed `gh pr view` response carrying `mergeStateStatus: "DIRTY"`, `baseRefName: "main"`, `headRefOid: "abc123"` yields a `PrMergeState` with those three values, and the requested `--json` field list includes `mergeStateStatus,baseRefName,headRefOid`.
2. Verify RED.
3. Implement: add the three fields to the `--json` list in `prMergeState` and to `GhPrViewJson` and `PrMergeState` as optional strings; copy them through.
4. Verify GREEN; existing `pr-labels*.test.ts` stay green.
5. Commit: `feat(pr-labels): read mergeStateStatus, base branch, and head commit`.

**Done when:**
- [test] `prMergeState` returns `mergeStateStatus`, `baseRefName`, and `headRefOid` copied from the `gh pr view` JSON, as asserted by the new merge-state test.
- [test] The argv passed to the gh runner by `prMergeState` contains the `--json` value with `mergeStateStatus`, `baseRefName`, and `headRefOid` added to the prior fields.
- A response omitting the three fields still yields a `PrMergeState` with the prior fields unchanged (existing `pr-labels-merge-state.test.ts` cases pass).

**Files likely touched:**
- `src/conductor/src/engine/pr-labels.ts` — read fields and `PrMergeState`
- `src/conductor/test/engine/pr-labels-merge-state.test.ts` — new cases

**Dependencies:** none

### Task 2: Pure readiness classifier with fixed precedence and grace period
**Story:** Story 1, Story 2, Story 3
**Type:** happy-path

**Steps:**
1. Write a failing table test `src/conductor/test/engine/shipped-readiness.test.ts` for `classifyShippedReadiness(state, observation, now)`: one row per verdict, plus the collisions draft+CONFLICTING+failed → `draft`, CONFLICTING+failed → `conflicting`, failed+pending-mix → `ci-failing`; `BLOCKED` and `BEHIND` with green checks → `ready`; `MERGEABLE`+`DIRTY` → `conflicting`; `UNKNOWN` after a re-read → `indeterminate`; failed re-read → `indeterminate`; `mergeStateStatus: "SOMETHING_NEW"` → `indeterminate`; zero checks, base `main`, first seen 29 minutes ago → `ci-pending`; 31 minutes → `no-checks`; zero checks, base `feat/c1/x`, 31 minutes → `ci-pending`; pending checks → `ci-pending`.
2. Verify RED.
3. Implement `src/conductor/src/engine/shipped-readiness.ts`: the `ShippedReadinessVerdict` union, `SHIPPED_READINESS_GRACE_MS = 30 * 60 * 1000`, the documented `mergeStateStatus` set, and `classifyShippedReadiness` applying the precedence draft → indeterminate → conflicting → ci-failing → ci-pending → no-checks → ready. Also export `routeShippedReadiness(verdict, handlers)` as an exhaustive `switch` with no `default`, ending in an `assertNever(verdict)` call.
4. Verify GREEN.
5. Commit: `feat(sweep): pure shipped-PR readiness classifier`.

**Done when:**
- [test] `classifyShippedReadiness` returns exactly one verdict for every table row, including `draft` for draft+CONFLICTING+failed checks, `conflicting` for CONFLICTING+failed checks, and `ready` for `BLOCKED` or `BEHIND` with green checks.
- [test] `classifyShippedReadiness` returns `indeterminate` (never `ready`) for mergeability still `UNKNOWN` after a re-read, for a failed re-read, and for a `mergeStateStatus` outside `BEHIND, BLOCKED, CLEAN, DIRTY, DRAFT, HAS_HOOKS, UNKNOWN, UNSTABLE`.
- [test] `classifyShippedReadiness` returns `conflicting` for `MERGEABLE` with `mergeStateStatus` `DIRTY`.
- [test] With zero check runs it returns `ci-pending` at 29 minutes and `no-checks` at 31 minutes for base `main`, and `ci-pending` at 31 minutes for a non-`main` base.
- `routeShippedReadiness` has no `default` branch and ends in `assertNever`, so deleting any case makes `npx tsc --noEmit` fail.

**Files likely touched:**
- `src/conductor/src/engine/shipped-readiness.ts` — new
- `src/conductor/test/engine/shipped-readiness.test.ts` — new

**Dependencies:** Task 1

### Task 3: Watch entry carries head-commit, emission, and readiness-cause bookkeeping
**Story:** Story 3, Story 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep.test.ts`: `rewriteWatch` then `readWatch` round-trips `headSha`, `headFirstSeenAt`, `readinessEmitted`, and `escalationCause: 'shipped-readiness'`; a legacy JSONL line with only `{prUrl, slug, repoCwd}` parses to an entry with those fields undefined.
2. Verify RED.
3. Implement: add the optional fields to `WatchEntry` and widen `escalationCause` to `'conflict-resolution' | 'shipped-readiness'`; extend `readWatch`'s per-field parse (it currently keeps `escalationCause` only when it equals `'conflict-resolution'`) to keep the new fields and the new cause; keep it tolerant of absent fields.
4. Verify GREEN.
5. Commit: `feat(sweep): watch entry readiness bookkeeping`.

**Done when:**
- [test] `readWatch` returns `headSha`, `headFirstSeenAt`, `readinessEmitted`, and `escalationCause: 'shipped-readiness'` exactly as written by `rewriteWatch` to `.daemon/mergeable-watch.jsonl`.
- [test] `readWatch` parses a legacy line without the new fields into an entry whose `prUrl`, `slug`, and `repoCwd` are intact and whose new fields are undefined.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — `WatchEntry`
- `src/conductor/test/engine/mergeable-sweep.test.ts` — round-trip cases

**Dependencies:** none

### Task 4: Sweep re-reads a lazily-UNKNOWN PR and records the head commit's first sighting
**Story:** Story 2, Story 3
**Type:** happy-path

**Steps:**
1. Write failing sweep tests in `src/conductor/test/engine/mergeable-sweep.test.ts` with a stubbed tracker: (a) first read `UNKNOWN`, second `CONFLICTING` → two reads; (b) first read `MERGEABLE` → one read; (c) a first sighting of head commit `A` writes `headSha: 'A'` and `headFirstSeenAt` = the fake-clock now into the persisted entry; (d) a later tick with head `B` replaces both; (e) a legacy entry gets `headSha` and `headFirstSeenAt` = now on its first tick.
2. Verify RED.
3. Implement in `sweepMergeableLabels`: after the existing lifecycle handling for an OPEN PR, when `state.mergeable === 'UNKNOWN'` call the tracker read once more and keep the second result (a thrown or `readFailure` second read is recorded as a failed re-read for the classifier). Update `headSha`/`headFirstSeenAt` when `headRefOid` differs from the stored `headSha`, using the sweep's injectable clock.
4. Verify GREEN.
5. Commit: `feat(sweep): re-read UNKNOWN mergeability and track head commit first sighting`.

**Done when:**
- [test] The sweep issues exactly two `readPullRequestMergeState` calls for a PR whose first read is `UNKNOWN`, and exactly one for a PR whose first read is `MERGEABLE`.
- [test] After a tick that first observes head commit `A`, the entry persisted in `.daemon/mergeable-watch.jsonl` holds `headSha: 'A'` and `headFirstSeenAt` equal to the injected clock's time, and a re-read of the file after a fresh `readWatch` (restart) returns the same values.
- [test] A tick observing head commit `B` on an entry stored with `A` replaces `headSha` with `B` and resets `headFirstSeenAt` to that tick's time; a legacy entry without the fields gets them set to the current head and now.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — re-read and head tracking
- `src/conductor/test/engine/mergeable-sweep.test.ts` — sweep cases

**Dependencies:** Tasks 1, 3

### Task 5: Sweep routes each verdict through the exhaustive route table
**Story:** Story 1, Story 2, Story 3, Story 4
**Type:** happy-path

**Steps:**
1. Write failing sweep tests in `src/conductor/test/engine/mergeable-sweep.test.ts` with one watched PR per verdict plus MERGED, CLOSED, not-found, and read-failure entries, autoresolve and ci-fix enabled with recording `dispatch`/`isEligible` stubs: `ready` gets `mergeable` added; `conflicting` (including `UNKNOWN`→`CONFLICTING` and `MERGEABLE`+`DIRTY`) is offered to autoresolve; `ci-failing` is offered to ci-fix; `ci-pending` gets no dispatch, no `needs-remediation`, and an existing `mergeable` removed; `indeterminate` gets zero GitHub operations of any kind, zero dispatches, and no `escalationCause`; `draft` with CONFLICTING and failed checks is offered to neither; lifecycle and read-failure entries get no verdict and keep their existing handling (failed-read entry retained in the registry, later entries still processed).
2. Verify RED.
3. Implement: classify each OPEN entry with `classifyShippedReadiness` and dispatch through `routeShippedReadiness`. Run the existing `mergeable` label reconcile for every verdict except `indeterminate`. Collect autoresolve candidates only from `conflicting` and ci-fix candidates only from `ci-failing`, replacing the raw `mergeable === 'CONFLICTING'` and `checksOutcome === 'failed'` checks. Only candidate collection changes: the existing ship-ci `ci-failed` label and `ci_failed` event handling stays keyed on `checksOutcome === 'failed'` exactly as today (the existing ci-fix eligibility gate already refuses CONFLICTING PRs, so dispatch behaviour for a conflicting PR with failed checks is unchanged). Leave the MERGED / CLOSED / NOTFOUND / read-failure branches untouched.
4. Verify GREEN; existing sweep, autoresolve-dispatch, and ci-fix-dispatch tests stay green.
5. Commit: `feat(sweep): route watched PRs by readiness verdict`.

**Done when:**
- [test] In one sweep over one PR per verdict, `ready` receives one `mergeable` label add, the `conflicting` PRs (CONFLICTING, `UNKNOWN`→`CONFLICTING`, `MERGEABLE`+`DIRTY`) each reach the autoresolve `isEligible` stub in that tick, and `ci-failing` reaches the ci-fix `isEligible` stub.
- [test] A PR whose head-commit checks are queued or in progress is classified `ci-pending`, receives no autoresolve or ci-fix call and no `needs-remediation` add, and its pre-existing `mergeable` label is removed.
- [test] The PRs whose mergeability reads `UNKNOWN` twice, whose re-read fails, or whose `mergeStateStatus` is outside the documented set are each classified `indeterminate`, receive zero recorded GitHub operations of any kind and zero dispatch calls, get no `escalationCause` written to their entries, their entries remain in the registry, and a second sweep tick calls `readPullRequestMergeState` again for the `UNKNOWN`/`UNKNOWN` PR.
- [test] The draft PR that is CONFLICTING with failed checks reaches neither the autoresolve nor the ci-fix `isEligible` stub.
- [test] MERGED and CLOSED entries reach the existing shipped-record gate path, the not-found entry is pruned, the read-failure entry is kept, none of the four receives a verdict, and entries after the read failure are still processed.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — verdict routing
- `src/conductor/test/engine/mergeable-sweep.test.ts` — routing cases

**Dependencies:** Tasks 2, 4

### Task 6: `no-checks` and `draft` add an attributed needs-remediation label once
**Story:** Story 3, Story 4
**Type:** happy-path

**Steps:**
1. Write failing sweep tests (one `no-checks` fixture starts with a `mergeable` label, so the existing reconcile's removal of it is the only operation besides the label add): a `no-checks` PR (base `main`, zero checks, first seen 31 minutes ago by fake clock) gets one `needs-remediation` add and its entry records `escalationCause: 'shipped-readiness'`; the same PR on the next tick with the label present gets zero label calls; a draft PR without the label gets one add and the cause; a draft PR already carrying the label gets zero label calls and no cause recorded; a failing label add is logged, the entry kept, and retried next tick; the operations issued for a `no-checks` PR are only `pull-request.label.add` plus the existing reconcile's `mergeable` removal when that label was present, with no `pull-request.ready`, close, reopen, push, workflow dispatch, or re-run; an entry stored with head `A` first seen 31 minutes earlier read with new head `B`, and a legacy entry with no head fields, both with zero checks and base `main`, classify `ci-pending` and get no label add.
2. Verify RED.
3. Implement the `no-checks` and `draft` routes: when `state.labels` lacks `needs-remediation`, add it through the existing label path and set `escalationCause: 'shipped-readiness'` only after the add succeeds; when present, do nothing. Follow the label-once trait of ship-ci exhaustion (search `CI_EXHAUSTION_MARKER`).
4. Verify GREEN.
5. Commit: `feat(sweep): surface no-checks and draft shipped PRs`.

**Done when:**
- [test] A `no-checks` PR without the label and a draft PR without the label each receive exactly one `needs-remediation` add and have `escalationCause: 'shipped-readiness'` persisted on their entries.
- [test] A `no-checks` or draft PR already carrying `needs-remediation` receives zero label calls, and the draft one gets no `escalationCause` recorded.
- [test] When the label add fails, the sweep logs the failure, keeps the entry without a recorded cause, and the next tick issues the label add again.
- [test] The recorded GitHub operations for `no-checks` and draft PRs contain no `pull-request.ready` and no operation other than `pull-request.label.add` and the existing reconcile's removal of a pre-existing `mergeable` label, and `GITHUB_OPERATION_REGISTRY` has the same key set as before this change.
- [test] With zero check runs and base `main`, an entry stored with head `A` first seen 31 minutes earlier that is read with new head `B`, and a legacy entry without head fields, are each classified `ci-pending` on that tick and receive no `needs-remediation` add.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — readiness label add
- `src/conductor/test/engine/mergeable-sweep.test.ts` — label-add cases

**Dependencies:** Task 5

### Task 7: The readiness label clears itself when the PR recovers
**Story:** Story 3, Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep-label-clear.test.ts`: an entry with cause `shipped-readiness` and the label present, whose verdict is now `ready`, gets the label removed that tick and `mergeable` added no later than the next tick; one whose verdict is now `ci-failing` gets the label removed and reaches the ci-fix `isEligible` stub that tick or the next; a draft-labelled PR marked ready by a human gets the label removed that tick; a PR with the halt body marker keeps the label; PRs labelled by ci-fix exhaustion, halt presentation, or a human (no recorded cause) or by conflict escalation (cause `conflict-resolution`) whose verdict is `ready` keep the label and do not get `mergeable`; a `shipped-readiness` PR whose verdict is `ci-pending` keeps the label; three consecutive failed removals stop retrying, log the cap, and drop the cause leaving the label.
2. Verify RED.
3. Implement `maybeClearReadinessLabel(entry, state, verdict, gh, log)` beside `maybeClearConflictLabel`, with its traits: act only when `entry.escalationCause === 'shipped-readiness'`; drop the cause when the label is already gone; hold for a halt body marker, a read failure, or verdict `no-checks`/`draft`/`ci-pending`/`indeterminate` (holding through `ci-pending` stops the label flapping off and back on when a new head commit restarts the grace period); otherwise remove the label and bump `labelClearAttempts`; at 3 attempts log and drop the cause. Call it before label reconcile and candidate collection so a recovered PR is reconciled in the same tick.
4. Verify GREEN.
5. Commit: `feat(sweep): self-clear the readiness needs-remediation label`.

**Done when:**
- [test] A `shipped-readiness` entry whose verdict becomes `ready` has `needs-remediation` removed by `maybeClearReadinessLabel` in that tick and receives the `mergeable` label in that tick or the next.
- [test] A `shipped-readiness` entry whose verdict becomes `ci-failing` has the label removed and reaches the ci-fix `isEligible` stub in that tick or the next.
- [test] A draft-labelled PR marked ready by a human (verdict `ready`) has the label removed in that tick, while a PR whose body carries the halt marker keeps the label and a `shipped-readiness` PR whose verdict is `ci-pending` keeps the label.
- [test] A PR whose `needs-remediation` was added by ci-fix exhaustion, by halt presentation, or by a human (none records an `escalationCause`), or by conflict escalation (cause `conflict-resolution`), keeps the label when its verdict is `ready`, and `mergeable` is not added.
- [test] After three consecutive failed removals `maybeClearReadinessLabel` issues no fourth removal, logs the retry cap, and the entry no longer records `shipped-readiness`.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — `maybeClearReadinessLabel`
- `src/conductor/test/engine/mergeable-sweep-label-clear.test.ts` — clear cases

**Dependencies:** Task 6

### Task 8: Emit change-only `shipped_pr_readiness` events from the sweep
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep.test.ts` with a recording `onEvent`: ticks `no-checks`, `no-checks`, `ready` on one PR yield exactly two `shipped_pr_readiness` events; the event carries `prUrl`, `slug`, `verdict`, `headSha`, `mergeable`, `mergeStateStatus`, `checksOutcome`, `isDraft`, `baseRefName`; the same verdict with a new head commit yields a new event; a re-created sweep over the persisted entry with unchanged verdict and head emits nothing; an `onEvent` that throws does not stop label and dispatch work for later entries.
2. Verify RED.
3. Implement: add the `shipped_pr_readiness` variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts`. In the sweep, after classification, emit when `(verdict, headSha)` differs from `entry.readinessEmitted`, then store it on the entry; wrap the call in `try/catch` with a log line.
4. Verify GREEN; `npx tsc --noEmit` passes.
5. Commit: `feat(events): shipped_pr_readiness verdict event`.

**Done when:**
- [test] Three ticks with verdicts `no-checks`, `no-checks`, `ready` on one PR make `onEvent` receive exactly two `shipped_pr_readiness` events, the second with verdict `ready`.
- [test] Each event carries `prUrl`, `slug`, `verdict`, `headSha`, `mergeable`, `mergeStateStatus`, `checksOutcome`, `isDraft`, and `baseRefName` from that tick's read.
- [test] An unchanged verdict with a new head commit produces one new event, and a fresh sweep over the persisted entry with unchanged verdict and head produces none.
- [test] When `onEvent` throws, every later entry still receives its label reconcile and dispatch handling in that tick.
- `shipped_pr_readiness` is a member of the `ConductorEvent` union in `src/conductor/src/types/events.ts` and `npx tsc --noEmit` passes.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new variant
- `src/conductor/src/engine/mergeable-sweep.ts` — emission
- `src/conductor/test/engine/mergeable-sweep.test.ts` — emission cases

**Dependencies:** Tasks 3, 5

### Task 9: Wire sweep events to the daemon event ledger
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/daemon-cli-watch-wiring.test.ts`: drive the production `sweepMergeableLabels` binding built by `daemon-cli.ts` with a stubbed tracker (one `no-checks` PR and one PR with failed checks) and the real daemon emitter plus `startDaemonEventPersistence` on a temp root; assert `.daemon/events.jsonl` contains one `shipped_pr_readiness` line with verdict `no-checks` and one `ci_failed` line; with the persister pointed at an unwritable path, the sweep still adds the label and offers the failing PR to ci-fix.
2. Verify RED.
3. Implement: pass `onEvent: (event) => events.emit(event)` in the `sweepMergeableLabels` binding in `daemon-cli.ts`, using the daemon's global `ConductorEventEmitter`.
4. Verify GREEN.
5. Commit: `feat(daemon): persist mergeable-sweep events to the daemon ledger`.

**Done when:**
- [test] Running the production `sweepMergeableLabels` binding from `daemon-cli.ts` writes a `shipped_pr_readiness` event with the PR URL, slug, verdict `no-checks`, and head commit to `.daemon/events.jsonl`.
- [test] The same run writes the sweep's existing `ci_failed` event for the failed-checks PR to `.daemon/events.jsonl`.
- [test] With the ledger write failing, the same run still adds `needs-remediation` to the `no-checks` PR and offers the failed-checks PR to ci-fix.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — `onEvent` wiring
- `src/conductor/test/daemon-cli-watch-wiring.test.ts` — ledger wiring test

**Dependencies:** Task 8

### Task 10: `daemon status` shows a SHIPPED PRS section from the ledger
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` over fixture `.daemon/events.jsonl` files: latest verdicts A `no-checks`, B `ready`, C `draft` render a `SHIPPED PRS` section listing A and C with their verdicts and not B; all-ready renders the "no shipped PRs need attention" line; no ledger renders the "shipped-PR readiness unknown" line and the command exits 0; a malformed `shipped_pr_readiness` line is skipped while the others render; A with an earlier `no-checks` and later `ready` is not listed; a PR whose latest verdict is `no-checks` but which is no longer in `.daemon/mergeable-watch.jsonl` is not listed; the injected gh runner is never called while rendering the section.
2. Verify RED.
3. Implement `readLatestShippedPrReadiness(repoPath)` and the section renderer in `daemon-observe-cli.ts`, following `readLatestReadOnlyReviewCapabilities` (search `CAPABILITY_EVENT_SCAN_CHUNK_BYTES`): chunked backwards scan, complete lines only, latest per `prUrl`, missing file → unknown, malformed lines skipped. Keep only PRs whose `prUrl` is in the repo's watch registry (read with the existing `readWatch`). Render it in the per-repo status output after the BLOCKED section.
4. Verify GREEN.
5. Commit: `feat(status): list shipped PRs that are not ready`.

**Done when:**
- [test] For latest verdicts A `no-checks`, B `ready`, C `draft`, the `daemon status` per-repo output has a `SHIPPED PRS` section listing A with `no-checks` and C with `draft` and not listing B.
- [test] When every latest verdict is `ready`, the section prints the no-attention line, and when A's latest event is `ready` after an earlier `no-checks`, A is not listed.
- [test] With no `.daemon/events.jsonl` the section prints the readiness-unknown line and `daemon status` exits 0, and a malformed `shipped_pr_readiness` line is skipped while the remaining verdicts render.
- [test] Rendering the section makes zero calls to the injected gh runner, and a PR whose latest verdict is `no-checks` but which is absent from `.daemon/mergeable-watch.jsonl` is not listed.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — reader and section
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — renderer cases

**Dependencies:** Tasks 3, 8

## Task Dependency Graph

```
Task 1 ──► Task 2 ──┐
Task 1 ──► Task 4 ◄─┤── Task 3
                    ▼
            Task 5 (needs 2, 4)
                    ▼
            Task 6 ──► Task 7
Task 3, Task 5 ──► Task 8 ──► Task 9
                          └─► Task 10
```

## Integration Points

- After Task 5: a daemon sweep tick routes every watched PR by verdict end to end through the real sweep entry point.
- After Task 9: the production daemon binding persists readiness and `ci_failed` events to `.daemon/events.jsonl`.
- After Task 10: `daemon status` (CLI entry point) shows non-ready shipped PRs from that ledger.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an open watched PR that is not a draft, reads `MERGEABLE` with `mergeStateStatus` `CLEAN`, base `main`, and all checks on its head commit succeeded, when a sweep tick runs, then its verdict is `ready` and it receives the `mergeable` label exactly as before this change. | 5 | "`ready` receives one `mergeable` label add" | diff-local |
| Story 1 happy: Given the same PR but with `mergeStateStatus` `BLOCKED` (awaiting required review) or `BEHIND`, when a sweep tick runs, then its verdict is still `ready`; only `DIRTY` is treated as a conflict. | 2 | "`ready` for `BLOCKED` or `BEHIND` with green checks" | diff-local |
| Story 1 happy: Given an open watched PR that is a draft and also reads `CONFLICTING` with failed checks, when a sweep tick runs, then its verdict is `draft` (draft takes precedence over every other verdict) and it is not offered to autoresolve or ci-fix. | 2, 5 | "The draft PR that is CONFLICTING with failed checks reaches neither the autoresolve nor the ci-fix `isEligible` stub." | diff-local |
| Story 1 happy: Given an open watched PR that reads `CONFLICTING` and has failed checks, when a sweep tick runs, then its verdict is `conflicting` (conflict takes precedence over CI state). | 2 | "`conflicting` for CONFLICTING+failed checks" | diff-local |
| Story 1 happy: Given an open watched PR whose checks on the head commit are still queued or running, when a sweep tick runs, then its verdict is `ci-pending`, nothing is dispatched for it, `needs-remediation` is not added, and an existing `mergeable` label is removed exactly as before this change. | 5 | "A PR whose head-commit checks are queued or in progress is classified `ci-pending`, receives no autoresolve or ci-fix call and no `needs-remediation` add, and its pre-existing `mergeable` label is removed." | diff-local |
| Story 1 negative: Given a watched PR that GitHub reports as MERGED, CLOSED, or not found, when a sweep tick runs, then it receives no readiness verdict and follows the existing shipped-record / prune handling unchanged. | 5 | "MERGED and CLOSED entries reach the existing shipped-record gate path, the not-found entry is pruned" | diff-local |
| Story 1 negative: Given a watched PR whose state read fails (network error or non-zero `gh` exit), when a sweep tick runs, then it receives no readiness verdict, the entry is kept in the registry, and the sweep continues to the next entry. | 5 | "the read-failure entry is kept, none of the four receives a verdict, and entries after the read failure are still processed" | diff-local |
| Story 1 negative: Given an open, non-draft watched PR whose read returns a `mergeStateStatus` value outside GitHub's documented set (`BEHIND`, `BLOCKED`, `CLEAN`, `DIRTY`, `DRAFT`, `HAS_HOOKS`, `UNKNOWN`, `UNSTABLE`), when a sweep tick runs, then its verdict is `indeterminate` (never `ready`), no GitHub operation of any kind is issued for it, nothing is dispatched for it, and no `escalationCause` is recorded on its entry. | 2, 5 | "The PRs whose mergeability reads `UNKNOWN` twice, whose re-read fails, or whose `mergeStateStatus` is outside the documented set are each classified `indeterminate`, receive zero recorded GitHub operations of any kind and zero dispatch calls, get no `escalationCause` written to their entries" | diff-local |
| Story 2 happy: Given an open, non-draft watched PR whose first read returns `mergeable` `UNKNOWN` and whose second read in the same tick returns `CONFLICTING`, when a sweep tick runs, then its verdict is `conflicting` and it becomes an autoresolve candidate in that same tick. | 4, 5 | "the `conflicting` PRs (CONFLICTING, `UNKNOWN`→`CONFLICTING`, `MERGEABLE`+`DIRTY`) each reach the autoresolve `isEligible` stub in that tick" | diff-local |
| Story 2 happy: Given an open, non-draft watched PR whose first read returns `mergeable` `MERGEABLE` and `mergeStateStatus` `DIRTY`, when a sweep tick runs, then its verdict is `conflicting`. | 2 | "`classifyShippedReadiness` returns `conflicting` for `MERGEABLE` with `mergeStateStatus` `DIRTY`." | diff-local |
| Story 2 negative: Given an open, non-draft watched PR whose first and second reads both return `mergeable` `UNKNOWN`, when a sweep tick runs, then its verdict is `indeterminate`, no label is changed and nothing is dispatched for it, and the next tick re-reads it. | 4, 5 | "a second sweep tick calls `readPullRequestMergeState` again for the `UNKNOWN`/`UNKNOWN` PR" | diff-local |
| Story 2 negative: Given an open watched PR whose first read returns `UNKNOWN` and whose re-read fails, when a sweep tick runs, then its verdict is `indeterminate` and the entry is kept in the registry. | 2, 5 | "their entries remain in the registry" | diff-local |
| Story 2 negative: Given an open watched PR whose first read returns `MERGEABLE`, when a sweep tick runs, then no re-read is issued for it (exactly one PR read). | 4 | "and exactly one for a PR whose first read is `MERGEABLE`" | diff-local |
| Story 3 happy: Given an open, non-draft, mergeable watched PR with base `main`, zero check runs on its head commit, and that head commit first observed more than 30 minutes ago, when a sweep tick runs, then its verdict is `no-checks` and the `needs-remediation` label is added to the PR. | 2, 6 | "A `no-checks` PR without the label and a draft PR without the label each receive exactly one `needs-remediation` add" | diff-local |
| Story 3 happy: Given that PR already carries `needs-remediation`, when the next sweep tick runs with the same state, then no label call is made (the label is applied only on the absent-to-present transition). | 6 | "A `no-checks` or draft PR already carrying `needs-remediation` receives zero label calls" | diff-local |
| Story 3 happy: Given a watched PR's head commit is observed for the first time, when a sweep tick runs, then the head commit and the time it was first observed are saved in that PR's watch entry and survive a daemon restart. | 3, 4 | "After a tick that first observes head commit `A`, the entry persisted in `.daemon/mergeable-watch.jsonl` holds `headSha: 'A'` and `headFirstSeenAt` equal to the injected clock's time" | diff-local |
| Story 3 happy: Given a PR the sweep labelled `needs-remediation` for `no-checks`, when its checks later register and all succeed, then on the next sweep tick the sweep removes `needs-remediation`, its verdict is `ready`, and it receives the `mergeable` label no later than the following tick. | 7 | "A `shipped-readiness` entry whose verdict becomes `ready` has `needs-remediation` removed by `maybeClearReadinessLabel` in that tick and receives the `mergeable` label in that tick or the next." | diff-local |
| Story 3 negative: Given an open watched PR with base `main`, zero check runs, and its head commit first observed 10 minutes ago, when a sweep tick runs, then its verdict is `ci-pending` and no label is added. | 2, 5 | "With zero check runs it returns `ci-pending` at 29 minutes" | diff-local |
| Story 3 negative: Given an open watched PR whose base is not `main` (for example a stacked child PR) with zero check runs for more than 30 minutes, when a sweep tick runs, then its verdict is `ci-pending`, never `no-checks`, and no label is added. | 2, 5 | "and `ci-pending` at 31 minutes for a non-`main` base" | diff-local |
| Story 3 negative: Given a watched PR previously observed with head commit A for more than 30 minutes, when a new head commit B is pushed and a sweep tick runs, then the grace period restarts from B's first observation and the verdict is `ci-pending`. | 2, 4, 6 | "an entry stored with head `A` first seen 31 minutes earlier that is read with new head `B`, and a legacy entry without head fields, are each classified `ci-pending` on that tick" | diff-local |
| Story 3 negative: Given a `no-checks` PR, when the sweep handles it, then no GitHub operation other than the `needs-remediation` label add and the existing `mergeable` label reconcile is issued: no push, no PR close or reopen, no workflow dispatch, no re-run request. | 6 | "The recorded GitHub operations for `no-checks` and draft PRs contain no `pull-request.ready` and no operation other than `pull-request.label.add` and the existing reconcile's removal of a pre-existing `mergeable` label" | diff-local |
| Story 3 negative: Given a watch entry written before this change (no head-commit fields), when a sweep tick runs, then the entry parses, the current head commit is recorded as first observed now, and the verdict is `ci-pending`. | 3, 4, 6 | "and a legacy entry without head fields, are each classified `ci-pending` on that tick and receive no `needs-remediation` add" | diff-local |
| Story 3 negative: Given the label add fails, when the sweep handles a `no-checks` PR, then the failure is logged, the entry is kept, and the next tick retries the label add. | 6 | "When the label add fails, the sweep logs the failure, keeps the entry without a recorded cause, and the next tick issues the label add again." | diff-local |
| Story 3 negative: Given a PR the sweep labelled for `no-checks` whose checks later fail, when a sweep tick runs, then the sweep removes `needs-remediation` and the PR becomes eligible for the existing ci-fix path on that tick or the next. | 7 | "A `shipped-readiness` entry whose verdict becomes `ci-failing` has the label removed and reaches the ci-fix `isEligible` stub in that tick or the next." | diff-local |
| Story 3 negative: Given a PR carrying `needs-remediation` that the sweep did not add for a readiness reason (halt presentation, ci-fix exhaustion, or a human), when its verdict becomes `ready`, then the sweep does not remove the label and `mergeable` stays absent. | 7 | "keeps the label when its verdict is `ready`, and `mergeable` is not added" | diff-local |
| Story 3 negative: Given removing the readiness label fails on three consecutive ticks, when the third attempt fails, then the sweep stops retrying, logs the cap, and leaves the label for a human. | 7 | "After three consecutive failed removals `maybeClearReadinessLabel` issues no fourth removal, logs the retry cap" | diff-local |
| Story 4 happy: Given an open watched PR that is a draft and does not carry `needs-remediation`, when a sweep tick runs, then its verdict is `draft` and the `needs-remediation` label is added once. | 6 | "A `no-checks` PR without the label and a draft PR without the label each receive exactly one `needs-remediation` add" | diff-local |
| Story 4 negative: Given a `draft` PR that is also `CONFLICTING` and has failed checks, when a sweep tick runs, then it is not offered to autoresolve and not offered to ci-fix. | 5 | "The draft PR that is CONFLICTING with failed checks reaches neither the autoresolve nor the ci-fix `isEligible` stub." | diff-local |
| Story 4 negative: Given a `draft` PR, when the sweep handles it, then the PR is never marked ready for review by the daemon. | 6 | "contain no `pull-request.ready`" | diff-local |
| Story 4 negative: Given a `draft` PR that already carries `needs-remediation` (for example from a halt presentation), when a sweep tick runs, then no label call is made and no readiness cause is recorded, so the sweep never removes that label later. | 6, 7 | "A `no-checks` or draft PR already carrying `needs-remediation` receives zero label calls, and the draft one gets no `escalationCause` recorded." | diff-local |
| Story 4 negative: Given a PR the sweep labelled for `draft`, when a human marks it ready for review and its verdict becomes `ready`, then the sweep removes `needs-remediation` on that tick. | 7 | "A draft-labelled PR marked ready by a human (verdict `ready`) has the label removed in that tick" | diff-local |
| Story 4 negative: Given a PR the sweep labelled for `draft` that now also carries the halt body marker, when its verdict leaves `draft`, then the sweep does not remove the label. | 7 | "while a PR whose body carries the halt marker keeps the label" | diff-local |
| Story 5 happy: Given a running daemon and a watched PR whose verdict is `no-checks`, when a sweep tick runs, then `.daemon/events.jsonl` gains one `shipped_pr_readiness` event carrying the PR URL, feature slug, verdict, head commit, and the observed fields that decided it. | 8, 9 | "Running the production `sweepMergeableLabels` binding from `daemon-cli.ts` writes a `shipped_pr_readiness` event with the PR URL, slug, verdict `no-checks`, and head commit to `.daemon/events.jsonl`." | diff-local |
| Story 5 happy: Given that PR's verdict changes from `no-checks` to `ready` on a later tick, when that tick runs, then one new `shipped_pr_readiness` event with verdict `ready` is appended. | 8 | "Three ticks with verdicts `no-checks`, `no-checks`, `ready` on one PR make `onEvent` receive exactly two `shipped_pr_readiness` events, the second with verdict `ready`." | diff-local |
| Story 5 happy: Given a watched PR whose checks failed, when a sweep tick runs in the production daemon, then the sweep's existing `ci_failed` event is now present in `.daemon/events.jsonl`. | 9 | "The same run writes the sweep's existing `ci_failed` event for the failed-checks PR to `.daemon/events.jsonl`." | diff-local |
| Story 5 negative: Given a watched PR whose verdict and head commit are unchanged since its last emitted event, when the next sweep tick runs, then no new `shipped_pr_readiness` event is appended. | 8 | "a fresh sweep over the persisted entry with unchanged verdict and head produces none" | diff-local |
| Story 5 negative: Given the same verdict but a new head commit, when a sweep tick runs, then a new event is appended. | 8 | "An unchanged verdict with a new head commit produces one new event" | diff-local |
| Story 5 negative: Given the event ledger write fails, when a sweep tick runs, then the sweep still completes its label and dispatch work for every entry. | 8, 9 | "With the ledger write failing, the same run still adds `needs-remediation` to the `no-checks` PR and offers the failed-checks PR to ci-fix." | diff-local |
| Story 6 happy: Given the ledger's latest `shipped_pr_readiness` verdicts are `no-checks` for PR A, `ready` for PR B, and `draft` for PR C, when the operator runs `daemon status`, then that repo's output has a SHIPPED PRS section listing A with `no-checks` and C with `draft`, and not listing B. | 10 | "For latest verdicts A `no-checks`, B `ready`, C `draft`, the `daemon status` per-repo output has a `SHIPPED PRS` section listing A with `no-checks` and C with `draft` and not listing B." | diff-local |
| Story 6 happy: Given every watched PR's latest verdict is `ready`, when the operator runs `daemon status`, then the section reads that no shipped PRs need attention. | 10 | "When every latest verdict is `ready`, the section prints the no-attention line" | diff-local |
| Story 6 negative: Given a repo with no `.daemon/events.jsonl`, when the operator runs `daemon status`, then the section reads that shipped-PR readiness is unknown and the command exits successfully. | 10 | "With no `.daemon/events.jsonl` the section prints the readiness-unknown line and `daemon status` exits 0" | diff-local |
| Story 6 negative: Given the ledger holds a malformed `shipped_pr_readiness` line, when the operator runs `daemon status`, then the malformed line is skipped and the remaining verdicts render. | 10 | "a malformed `shipped_pr_readiness` line is skipped while the remaining verdicts render" | diff-local |
| Story 6 negative: Given PR A's earlier event was `no-checks` and its latest is `ready`, when the operator runs `daemon status`, then A is not listed. | 10 | "when A's latest event is `ready` after an earlier `no-checks`, A is not listed" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-09-shipped-pr-readiness-verdict#D1 | task | task-1, task-2, task-4 | The sweep issues exactly two `readPullRequestMergeState` calls for a PR whose first read is `UNKNOWN` |
| adr-2026-10-09-shipped-pr-readiness-verdict#D2 | task | task-2 | `classifyShippedReadiness` returns exactly one verdict for every table row |
| adr-2026-10-09-shipped-pr-readiness-verdict#D3 | task | task-2, task-5, task-6, task-7 | `routeShippedReadiness` has no `default` branch and ends in `assertNever` |
| adr-2026-10-09-shipped-pr-readiness-verdict#D4 | task | task-6 | `GITHUB_OPERATION_REGISTRY` has the same key set as before this change |
| adr-2026-10-09-shipped-pr-readiness-verdict#D5 | task | task-8, task-9 | Running the production `sweepMergeableLabels` binding from `daemon-cli.ts` writes a `shipped_pr_readiness` event |
| adr-2026-10-09-shipped-pr-readiness-verdict#D6 | task | task-10 | Rendering the section makes zero calls to the injected gh runner |
| adr-2026-10-09-shipped-pr-readiness-verdict#D7 | task | task-3, task-4 | `readWatch` returns `headSha`, `headFirstSeenAt`, `readinessEmitted`, and `escalationCause: 'shipped-readiness'` exactly as written by `rewriteWatch` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
