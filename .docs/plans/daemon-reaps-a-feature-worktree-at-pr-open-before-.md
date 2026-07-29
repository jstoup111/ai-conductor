# Implementation Plan: Deferred Feature-Worktree Reap (#1091)

**Date:** 2026-07-29
**Design:** `.docs/decisions/adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-07-29-daemon-reaps-a-feature-worktree-at-pr-open-before-.md`
**Stories:** `.docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (S1-S6)
**Conflict check:** Clean as of 2026-07-29 (`.docs/conflicts/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` — 0 blocking, 2 degrading accepted)

## Summary

Moves the feature-worktree reap off the daemon runner's ship path and onto the mergeable sweep,
gated on `.docs/shipped/<slug>.md` being present at path on `origin/main`, and adds retain/reap
logging plus an operator reclaim surface. 19 tasks.

## Technical Approach

Three seams, in dependency order.

**1. A new record-presence probe.** `src/conductor/src/engine/shipped-record-on-main.ts` exports a
single async predicate `shippedRecordOnMain(repoCwd, slug, run?)` that fetches `origin main` and
runs `git cat-file -e origin/main:.docs/shipped/<slug>.md`. It returns a three-valued result —
`present` / `absent` / `indeterminate` — rather than a boolean, so a fetch or git failure can never
be read as "absent" and never authorizes a delete. The git runner is injected (the `execa` pattern
already used in `daemon-deps.ts` and `autoresolve.ts`) so tests need no network. **Ancestry is
deliberately not consulted**: verified 2026-07-29 against squash-merged PR #1138, `cat-file` finds
the record while `git merge-base --is-ancestor` returns false.

**2. Relocate the reap.** `daemon-runner.ts`'s `outcome.done` branch drops its
`teardownWorktree(worktree, false)` call and emits a retain line instead; `enrollWatch`,
`markProcessed`, and the halt-presentation cleanup are untouched. `mergeable-sweep.ts`'s per-entry
loop gains the reap: today `MERGED | CLOSED | NOTFOUND` all fall into one prune branch
(`mergeable-sweep.ts:270-280`); that branch splits so only `MERGED` consults the probe and may
teardown, while `CLOSED`/`NOTFOUND` prune the registry entry and leave the worktree on disk. The
sweep gains a `teardownWorktree` dep injected the same way `autoresolve`/`ciFix` already are, so the
sweep does not grow a direct `execa` dependency and stays unit-testable.

**3. Operator surface.** `daemon-dashboard.ts` gains a retained-worktree category **enumerated from
the `.worktrees/` directory on disk**, not from `.daemon/mergeable-watch.jsonl` — per the conflict
report, registry membership must never determine visibility, since the registry size cap can drop an
entry. `daemon-park-cli.ts` (already the home of the pre-boot, filesystem-direct `park` / `unpark` /
`reconcile-parked` verbs) gains `reclaim-worktree <slug>`, registered in the `cli.ts` daemon
subcommand table alongside them. It accepts exactly one well-formed slug, prints the path before
removing, has no force flag and no bulk mode, and refuses a slug whose `.pipeline/` belongs to an
in-progress run — reusing the in-flight predicate from
`adr-2026-07-27-ancestry-proven-park-reconciliation` rule 5 rather than writing a second one.

**Deliberately not built** (operator decisions, 2026-07-29): no in-flight guard on the *sweep* reap
(accepted; #564 relocates run-state out of the worktree), and no repair of `isEligibleForResolve`
Gate 6 (descoped to #1150, v1.1). Task 15 only makes the resulting rebase-resolution skip observable.

**Documentation** is owned by this repo's `maintain-documentation` custom step and is intentionally
not represented as plan tasks.

## Prerequisites

- None. No migration, no new dependency, no config key. `WatchEntry` already carries
  `{prUrl, slug, repoCwd}`, so no registry schema change is required.

## Tasks

### Task 1: Record-presence probe returns `present` for a squash-merged feature
**Story:** S2 happy path (record present at path; squash-merged case)
**Type:** happy-path

**Steps:**
1. Write failing test: against a fixture repo whose feature branch was squash-merged into `main`, `shippedRecordOnMain(repoCwd, slug)` resolves `'present'`, and the same fixture's `git merge-base --is-ancestor` returns false — asserting the probe succeeds exactly where ancestry fails.
2. Verify test fails (RED)
3. Implement: new module exporting `shippedRecordOnMain` with an injected git runner; fetch `origin main`, then `git cat-file -e origin/main:.docs/shipped/<slug>.md`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): probe shipped-record presence on origin/main"

**Files likely touched:**
- `src/conductor/src/engine/shipped-record-on-main.ts` — new module
- `src/conductor/test/engine/shipped-record-on-main.test.ts` — new test

**Wired-into:** none (inert until `src/conductor/src/engine/mergeable-sweep.ts`)
**Dependencies:** none

### Task 2: Probe returns `absent` when the record is not on main
**Story:** S2 negative path (record absent → retain)
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture whose `origin/main` has no `.docs/shipped/<slug>.md` resolves `'absent'`, and the probe does not throw.
2. Verify test fails (RED)
3. Implement: map `cat-file` non-zero exit to `'absent'`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): record probe reports absent without throwing"

**Files likely touched:** same as Task 1

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Probe returns `indeterminate` on fetch or git failure
**Story:** S2 negative path (fetch fails → no reap, entry kept)
**Type:** negative-path

**Steps:**
1. Write failing test: an injected git runner that throws on `fetch` resolves `'indeterminate'` (never `'absent'`); a runner that throws on `cat-file` with a non-"missing object" error also resolves `'indeterminate'`.
2. Verify test fails (RED)
3. Implement: distinguish transport/tooling failure from a clean missing-object result; default to `'indeterminate'` on anything ambiguous.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): record probe fails closed to indeterminate"

**Files likely touched:** same as Task 1

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 4: Runner no longer reaps on the verified-ship path
**Story:** S1 happy path (worktree + task-status survive PR-open)
**Type:** happy-path

**Steps:**
1. Write failing test: drive `makeRunFeature` to a verified ship and assert the injected `teardownWorktree` dep is never called, while `enrollWatch` and `markProcessed` are still called in the existing order.
2. Verify test fails (RED)
3. Implement: remove the `await deps.teardownWorktree(worktree, false)` call from the `outcome.done` branch.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): stop reaping the feature worktree at PR-open (#1091)"

**Files likely touched:**
- `src/conductor/src/engine/daemon-runner.ts` — remove the teardown call
- `src/conductor/test/engine/daemon-runner.test.ts` — assertion

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 5: Retained evidence artifacts survive a verified ship
**Story:** S1 happy path (the artifacts #1118 refuses to reconstruct)
**Type:** happy-path

**Steps:**
1. Write failing test: seed a fake worktree `.pipeline/` with `task-status.json`, `HALT`, `HALT.class`, `QUARANTINE`, `DONE`, `finish-choice`, `version-approval`, `conduct-state.json`, `gates/`, `protected-artifact-seal.json`, `events.jsonl`; drive a verified ship; assert every seeded path is still readable.
2. Verify test fails (RED)
3. Implement: no production change expected beyond Task 4 — the test pins the guarantee.
4. Verify test passes (GREEN)
5. Commit with message: "test(daemon): pin retained .pipeline evidence across a ship"

**Files likely touched:**
- `src/conductor/test/engine/daemon-runner.test.ts` — new test

**Wired-into:** none (no new production surface)
**Dependencies:** 4

### Task 6: Ship path tolerates an already-absent worktree and a cleanup throw
**Story:** S1 negative paths (halt/error outcome; cleanup throws; worktree already gone)
**Type:** negative-path

**Steps:**
1. Write failing test: three cases — a halt outcome retains as before with no ship-claiming retain line; a throwing `cleanupHaltPresentation` still reaches `enrollWatch` + `markProcessed`; a verified ship whose worktree path does not exist completes without throwing.
2. Verify test fails (RED)
3. Implement: adjust the retain-logging placement so it is not emitted on non-ship outcomes and does not assume the path exists.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): ship-path retention tolerates absent worktree and cleanup errors"

**Files likely touched:**
- `src/conductor/src/engine/daemon-runner.ts` — guard placement
- `src/conductor/test/engine/daemon-runner.test.ts` — cases

**Wired-into:** same as Task 4
**Dependencies:** 4

### Task 7: Split the sweep's terminal-state branch into three dispositions
**Story:** S3 happy path (`CLOSED` prunes but retains; `NOTFOUND` same)
**Type:** infrastructure

**Steps:**
1. Write failing test: `CLOSED` and `NOTFOUND` entries prune the registry entry and do NOT call the injected `teardownWorktree`; `MERGED` reaches the new gate path.
2. Verify test fails (RED)
3. Implement: split the combined `MERGED || CLOSED || NOTFOUND` prune at `mergeable-sweep.ts:270-280`; add an injected optional `teardownWorktree` dep alongside the existing `autoresolve`/`ciFix` injection pattern.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): separate merged from closed-unmerged in the sweep"

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — branch split, new dep
- `src/conductor/test/engine/mergeable-sweep.test.ts` — dispositions

**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels`
**Dependencies:** none

### Task 8: Merged + record-present reaps the worktree and prunes the entry
**Story:** S2 happy path (reap within one sweep pass)
**Type:** happy-path

**Steps:**
1. Write failing test: a `MERGED` entry whose probe resolves `'present'` calls `teardownWorktree` with `.worktrees/<slug>` and prunes the entry, within a single pass.
2. Verify test fails (RED)
3. Implement: call the Task 1 probe on the `MERGED` branch; on `'present'`, teardown then prune.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): reap the feature worktree once its record is on main"

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — gate + reap
- `src/conductor/test/engine/mergeable-sweep.test.ts` — case

**Wired-into:** same as Task 7
**Dependencies:** 1, 7

### Task 9: Merged + record-absent or indeterminate retains and re-checks
**Story:** S2 negative paths (record absent; fetch fails)
**Type:** negative-path

**Steps:**
1. Write failing test: probe `'absent'` and probe `'indeterminate'` each leave the worktree untouched, keep the registry entry, and let the sweep continue to the next entry; a following pass whose probe resolves `'present'` then reaps.
2. Verify test fails (RED)
3. Implement: only `'present'` authorizes teardown; every other value retains and keeps the entry.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): only a proven on-main record authorizes a reap"

**Files likely touched:** same as Task 8

**Wired-into:** same as Task 7
**Dependencies:** 8

### Task 10: Reap is idempotent and non-throwing on teardown failure
**Story:** S2 negative paths (teardown fails; worktree already absent; racing passes)
**Type:** negative-path

**Steps:**
1. Write failing test: a `teardownWorktree` that rejects leaves the sweep non-throwing and the remaining entries processed, and the outcome is surfaced rather than swallowed; an already-absent worktree prunes without error; a second pass over the same entry is a no-op.
2. Verify test fails (RED)
3. Implement: wrap the teardown per-entry with error isolation that records the failure rather than discarding it.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): reap failures isolate per entry and never throw"

**Files likely touched:** same as Task 8

**Wired-into:** same as Task 7
**Dependencies:** 8

### Task 11: `UNKNOWN` state and closed-after-merge are handled correctly
**Story:** S3 negative paths (`UNKNOWN` skips; `CLOSED` with record on main still reaps)
**Type:** negative-path

**Steps:**
1. Write failing test: `UNKNOWN` performs no teardown, no prune, and skips to the next entry; a `CLOSED` entry whose probe resolves `'present'` is reaped rather than merely retained.
2. Verify test fails (RED)
3. Implement: run the probe on `CLOSED` as well, letting a proven-on-main record win over the closed-state read; leave `UNKNOWN` on the existing skip path.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): proven-on-main record outranks a closed-state read"

**Files likely touched:** same as Task 8

**Wired-into:** same as Task 7
**Dependencies:** 8

### Task 12: Every disposition emits a greppable reason line
**Story:** S4 happy paths (five reason tokens) and negative path (failed reap must not claim success)
**Type:** happy-path

**Steps:**
1. Write failing test: assert the exact reason token for `pr-open-awaiting-main` (runner), `shipped-record-on-main`, `record-not-yet-on-main`, `pr-closed-unmerged`, and an indeterminate/unknown disposition; assert a failed teardown's line does not read `reaped`.
2. Verify test fails (RED)
3. Implement: emit through the runner's `featureLog` and the sweep's injected `log?.()`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): log worktree retain/reap disposition with its reason"

**Files likely touched:**
- `src/conductor/src/engine/daemon-runner.ts` — retain line
- `src/conductor/src/engine/mergeable-sweep.ts` — disposition lines
- `src/conductor/test/engine/mergeable-sweep.test.ts` — token assertions
- `src/conductor/test/engine/daemon-runner.test.ts` — retain-line assertion

**Wired-into:** same as Task 7
**Dependencies:** 6, 9, 10, 11

### Task 13: Repeat passes suppress unchanged retain lines
**Story:** S4 negative path (log-noise suppression, changes always logged)
**Type:** negative-path

**Steps:**
1. Write failing test: two passes with identical dispositions emit the per-entry line once; a pass where a disposition changes emits it again.
2. Verify test fails (RED)
3. Implement: per-run outcome cache keyed by slug+disposition, mirroring the halt-PR reconciliation cache.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): suppress repeat retain lines on unchanged passes"

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — cache
- `src/conductor/test/engine/mergeable-sweep.test.ts` — case

**Wired-into:** same as Task 7
**Dependencies:** 12

### Task 14: Dashboard lists retained worktrees enumerated from disk
**Story:** S5 happy path + negative path (capped-out slug still visible)
**Type:** happy-path

**Steps:**
1. Write failing test: a retained slug appears under a retained-worktree category with its reason; a slug present on disk but absent from `.daemon/mergeable-watch.jsonl` still appears.
2. Verify test fails (RED)
3. Implement: enumerate `.worktrees/` on disk, excluding `resolve-` and `engineer-` prefixed paths; render the category.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): surface retained worktrees on the dashboard"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — category
- `src/conductor/test/engine/daemon-dashboard.test.ts` — cases

**Wired-into:** `src/conductor/src/engine/daemon-dashboard.ts#renderDashboard`
**Dependencies:** none

### Task 15: Rebase-resolution skip for a retained slug is observable
**Story:** S6 negative path (Gate 6 suppression must be logged, not silent — #1150 owns the repair)
**Type:** negative-path

**Steps:**
1. Write failing test: with `.worktrees/<slug>` present and the PR `CONFLICTING`, `isEligibleForResolve` returns ineligible with a reason naming the retained build worktree, the skip is logged, and nothing is created or removed.
2. Verify test fails (RED)
3. Implement: sharpen Gate 6's existing reason string so it names retention as the cause and is greppable; the gate's behavior is unchanged.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): name retention as the rebase-resolution skip reason (#1150)"

**Files likely touched:**
- `src/conductor/src/engine/autoresolve.ts` — reason string
- `src/conductor/test/engine/autoresolve-guards.test.ts` — assertion

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 16: CI-fix still completes with the feature worktree retained
**Story:** S6 happy paths + negative paths (`resolve-` disjoint; prepare failure; stale transient)
**Type:** negative-path

**Steps:**
1. Write failing test: with `.worktrees/<slug>` retained, a CI-fix run provisions and tears down `.worktrees/resolve-<slug>` while the feature worktree and its `.pipeline/` are untouched; a `prepareWorktree` failure does not remove the feature worktree; a stale `resolve-<slug>` is force-recreated without touching `.worktrees/<slug>`.
2. Verify test fails (RED)
3. Implement: no production change expected — the test pins disjointness.
4. Verify test passes (GREEN)
5. Commit with message: "test(daemon): pin CI-fix coexistence with a retained feature worktree"

**Files likely touched:**
- `src/conductor/test/engine/autoresolve-inflight.test.ts` — coexistence cases

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 17: Reclaim verb removes exactly one named retained worktree
**Story:** S5 happy path (path printed, removal logged, works from any cwd)
**Type:** happy-path

**Steps:**
1. Write failing test: `reclaim-worktree <slug>` on a retained slug with no in-flight run prints the resolved path, removes the worktree, and logs the removal; invoked from a subdirectory it resolves the repo root correctly.
2. Verify test fails (RED)
3. Implement: add the verb to `daemon-park-cli.ts` beside the existing pre-boot park/unpark/reconcile-parked detection, reusing their root resolution.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): add reclaim-worktree operator verb"

**Files likely touched:**
- `src/conductor/src/engine/daemon-park-cli.ts` — verb
- `src/conductor/src/cli.ts` — daemon subcommand registration
- `src/conductor/test/engine/daemon-park-cli-reclaim.test.ts` — new test

**Wired-into:** `src/conductor/src/cli.ts#daemon`, `src/conductor/src/engine/daemon-park-cli.ts#detectDaemonParkCommand`
**Dependencies:** 14

### Task 18: Reclaim refuses in-flight runs, globs, lists, and unknown slugs
**Story:** S5 negative paths (in-flight; glob/path/list/multiple; unknown slug; removal failure)
**Type:** negative-path

**Steps:**
1. Write failing test: each of — a slug whose `.pipeline/` belongs to an in-progress run, a glob, a path, a comma-separated list, two slugs, an unknown slug, and a failing removal — is rejected or reported without removing anything and without claiming success.
2. Verify test fails (RED)
3. Implement: single-well-formed-slug validation with no force flag and no bulk mode; in-flight check reusing the `adr-2026-07-27-ancestry-proven-park-reconciliation` rule-5 predicate.
4. Verify test passes (GREEN)
5. Commit with message: "fix(daemon): reclaim-worktree rejects bulk, malformed, and in-flight targets"

**Files likely touched:** same as Task 17

**Wired-into:** same as Task 17
**Dependencies:** 17

### Task 19: Confirm `bin/conduct` already forwards the new daemon verb
**Story:** S5 negative path (verb recognized through `bin/conduct`, not unknown-subcommand)
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Write failing test: not applicable — verify existing behavior.
2. Verify: `bin/conduct`'s forwarding case (`bin/conduct:2790`) matches the bare `daemon` token and `exec`s `conduct-ts "$@"`, so any new `daemon <verb>` is forwarded without a per-verb list entry. Confirm `daemon reclaim-worktree <slug>` does not reach the unknown-command guard.
3. Implement: no change expected. If the check shows a per-verb list is in fact required, add the entry and convert this task to a code commit.
4. Verify.
5. Commit with message: "chore(daemon): confirm bin/conduct forwards reclaim-worktree" (empty commit with `Evidence: skipped <reason>` when no change is needed)

**Files likely touched:**
- `bin/conduct` — no change expected

**Wired-into:** none (no new production surface)
**Dependencies:** 17

## Advisory Overlap Scan (2026-07-29)

`conduct-ts overlap-scan` over this plan's `**Files:**` union reports ~40 unmerged spec branches
touching the same engine files. Almost all are broad-divergence noise; three are substantive and
`build` should sequence around them:

- `origin/spec/pipeline-run-state-lives-inside-the-worktree-cwd-r` — **#564**. Load-bearing here: the
  conflict report accepts the sweep reap's missing in-flight guard specifically because #564 lands.
- `origin/spec/removed-but-registered-worktree-causes-a-silent-gi` — directly adjacent. Retention
  changes which worktrees stay registered, so its git-registration handling and Task 14's disk
  enumeration must agree on what a "registered but removed" worktree looks like.
- **PR #1146** (dispatch preflight + shipped-record-on-feature-branch dedup, `daemon-backlog.ts` /
  `daemon-work-source.ts`) — no file overlap with this plan; do not re-implement its preflight.

Advisory only — this does not block the plan.

## Task Dependency Graph

```
Probe seam                Runner seam              Independent
─────────                 ───────────              ───────────
1 ──┬── 2                 4 ──┬── 5                14 ──┬── 17 ── 18
    └── 3                     └── 6                     └──────── 19
    │                             │                15
    │                             │                16
    ▼                             │
    7 ── 8 ──┬── 9 ───────────────┤
             ├── 10 ──────────────┤
             └── 11 ──────────────┤
                                  ▼
                                 12 ── 13
```

- Tasks 1, 4, 7, 14, 15, 16 have no dependencies and may start in parallel.
- Task 8 is the first integration point: it needs both the probe (1) and the split branch (7).
- Task 12 is the convergence point: it needs every disposition to exist (6, 9, 10, 11) before it can
  assert the full reason-token set.
- The graph is acyclic.

## Integration Points

- **After Task 8** — end-to-end reap is exercisable: merge a PR, run a sweep, watch the worktree go.
- **After Task 11** — the full three-way disposition (merged / merged-without-record /
  closed-unmerged) is behaviorally complete; S1-S3 are satisfied.
- **After Task 13** — operator observability (S4) is complete.
- **After Task 18** — the operator surface (S5) is complete and the feature is shippable.

## Coverage Mapping

| Story | Criteria covered by |
|---|---|
| S1 happy | 4, 5 |
| S1 negative | 6 |
| S2 happy | 1, 8 |
| S2 negative | 2, 3, 9, 10 |
| S3 happy | 7 |
| S3 negative | 11 (`UNKNOWN`, closed-after-merge); malformed task-status surfaces via existing #1118 reconstruction reporting, asserted in 11 |
| S4 happy | 12 |
| S4 negative | 12 (failed reap), 13 (suppression) |
| S5 happy | 14, 17 |
| S5 negative | 14 (capped-out visibility), 18, 19 |
| S6 happy | 16 |
| S6 negative | 15, 16 |

Every acceptance criterion in S1-S6 maps to at least one task. 19 tasks — within the normal range.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
