# Implementation Plan: Parked-Feature Reconciliation Sweep (#1060)

**Date:** 2026-07-27
**Design:** .docs/decisions/adr-2026-07-27-ancestry-proven-park-reconciliation.md
**Stories:** .docs/stories/parked-feature-reconciliation-1060.md
**Conflict check:** Clean as of 2026-07-27 (4 conflicts resolved — see .docs/conflicts/2026-07-27-parked-feature-reconciliation-1060.md)

## Summary

Builds the parked-feature reconciliation sweep (classify merged/orphan parks, auto-reconcile ancestry-proven-merged parks behind `reconcile_parked_auto_cleanup`, default on), the guarded single-slug cleanup helper, the `conduct daemon reconcile-parked <slug>` operator verb, and the orphan dashboard annotation. 17 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/park-reconciliation.ts`** holds both the sweep (`reconcileParkedFeatures`) and the guarded helper (`reconcileMergedPark`). The helper is the ONLY deletion path; it re-verifies every precondition internally (well-formed single slug, `git merge-base --is-ancestor feature/<slug> origin/main`, `.docs/shipped/<slug>.md` present on the base branch, no in-flight `.pipeline` run) immediately before acting, and unparks LAST via the existing unpark implementation (missing-worktree counter-reset fallback is the accepted path).
- **Sweep classification** per parked slug (`listOperatorParkedSlugs`): ancestry → merged; else intake marker `Source-Ref:` (shared parser, `parseIntakeSourceRef`) + `TrackerClient` issue state → orphan when closed; anything unresolvable → unclassified/no action. Outcome cache (halt-pr-reconciliation pattern) suppresses repeat log lines; summary line prints counts and is suppressed when unchanged.
- **Wiring** mirrors `reconcileHaltPrs`: optional dep on `daemon.ts` invoked from `sweepBestEffort()` (one dep declaration + one call — keep the daemon.ts diff minimal; overlap-scan shows heavy unmerged-spec contention there); bound in `daemon-cli.ts` with a per-run cache and gated by the startup-resolved `reconcile_parked_auto_cleanup` config value (new boolean key, default `true`, hard error on non-boolean).
- **Records are never written here**: missing record → resolve the merged implementation PR via `gh` and delegate to the ST-916 record-only repair-PR seam; unresolvable → report, zero writes.
- **Dashboard**: `ParkedEntry` gains an optional annotation (`orphan — needs manual review` / `merged — ready to reconcile`) rendered as a line suffix; PARKED precedence unchanged.
- **CLI verb** `daemon reconcile-parked <slug>`: pre-boot detection in `daemon-park-cli.ts` beside park/unpark, dispatched from `src/index.ts`, registered in `bin/conduct`'s known-subcommand forwarding list.
- **Contract amendment enforcement**: the operator-park single-writer grep/audit test is re-scoped to "park-marker module + guarded reconcile helper" per the amended FR-7 story.
- Pre-deletion, dispose any live HALT watcher for the slug (event-driven-wake integration note from conflict-check).

## Prerequisites

None — no migrations, no new dependencies. `origin/main` fetch state used as-is.

## Tasks

### Task 1: Config key `reconcile_parked_auto_cleanup`
**Story:** S3 — Auto-cleanup is governed by `reconcile_parked_auto_cleanup` (default `true`)
**Type:** infrastructure

**Steps:**
1. Write failing tests: config accepts `reconcile_parked_auto_cleanup: false` (resolved false), defaults `true` when absent, hard-errors naming the key on non-boolean (`"yes"`).
2. Verify RED.
3. Implement validation + default in `config.ts` following the existing boolean-key pattern (`daemon_verbose`).
4. Verify GREEN.
5. Commit: "feat(config): reconcile_parked_auto_cleanup boolean, default true"

**Files likely touched:**
- src/conductor/src/config.ts — key validation + default
- src/conductor/test/config.test.ts — new cases

**Wired-into:** src/conductor/src/daemon-cli.ts#daemon boot wiring (read at startup, Task 11)
**Dependencies:** none

### Task 2: Guarded helper — slug input validation
**Story:** S4 — Guarded single-slug cleanup helper re-verifies everything at the point of deletion
**Type:** negative-path

**Steps:**
1. Write failing tests: `reconcileMergedPark` rejects globs (`*`), path separators (`a/b`), comma lists (`a,b`), empty string — without invoking any git command (assert via injected runner spy).
2. Verify RED.
3. Implement input validation as the helper's first gate in new `src/conductor/src/engine/park-reconciliation.ts` (injected git/gh runners, injected log).
4. Verify GREEN.
5. Commit: "feat(engine): park-reconciliation helper skeleton with strict single-slug validation"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts — new module, helper skeleton
- src/conductor/test/engine/park-reconciliation.test.ts — new test file

**Wired-into:** none (inert until src/conductor/src/engine/daemon.ts) — reached via Tasks 10–13
**Dependencies:** none

### Task 3: Guarded helper — internal ancestry re-verification
**Story:** S4 — Guarded single-slug cleanup helper re-verifies everything at the point of deletion
**Type:** negative-path

**Steps:**
1. Write failing tests: helper runs `merge-base --is-ancestor feature/<slug> origin/main` itself; exit 1 → structured refusal naming the failed check, zero destructive calls; unexpected exit (128) → refusal distinct from not-ancestor; missing branch → refusal (never treated as merged).
2. Verify RED.
3. Implement ancestry gate.
4. Verify GREEN.
5. Commit: "feat(engine): helper re-verifies ancestry before any destructive step"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: Guarded helper — record-on-main precondition and ST-916 delegation
**Story:** S2 — Fully-merged parked feature is auto-reconciled by default
**Type:** negative-path

**Steps:**
1. Write failing tests: record present on base (`git ls-tree <base>:.docs/shipped` contains stem, reuse the `makeIsProcessed`/tree-source listing approach) → proceed; record missing + merged PR resolvable via injected `gh pr list --state merged --head feature/<slug>` → defer with "not reconcilable until the record lands" and invoke the ST-916 repair-PR seam hook (injected callback), zero deletions, zero record writes; record missing + no merged PR → report, zero writes, zero deletions.
2. Verify RED.
3. Implement record precondition + delegation hook.
4. Verify GREEN.
5. Commit: "feat(engine): record-on-main precondition; delegate missing records to ST-916 seam"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 5: Guarded helper — in-flight run guard
**Story:** S2 — Fully-merged parked feature is auto-reconciled by default
**Type:** negative-path

**Steps:**
1. Write failing test: worktree `.pipeline/` indicating an in-progress run → helper refuses worktree removal, logs reason, non-success outcome; absent/quiescent `.pipeline` → proceeds. Reuse the in-progress detection the mid-loop-pipeline-wipe machinery established.
2. Verify RED.
3. Implement guard before any removal.
4. Verify GREEN.
5. Commit: "feat(engine): in-flight .pipeline guard blocks worktree removal"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 6: Guarded helper — cleanup ordering, unpark last, partial-failure reporting
**Story:** S4 — Guarded single-slug cleanup helper re-verifies everything at the point of deletion
**Type:** happy-path

**Steps:**
1. Write failing tests (temp git repo): full pass removes worktree, deletes `feature/<slug>`, removes park marker LAST via the unpark implementation (missing-worktree counter-reset fallback); branch-delete failure after worktree removal → reported outcome, marker survives; counter-reset genuine failure → marker survives, non-success; missing worktree treated as done step; structured outcome names each step taken. Dispose any live HALT watcher for the slug before removal.
2. Verify RED.
3. Implement ordered cleanup.
4. Verify GREEN.
5. Commit: "feat(engine): ordered guarded cleanup — worktree, branch, unpark last"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 4, Task 5

### Task 7: Sweep — merged/orphan/normal/unclassified classification
**Story:** S6 — Orphaned parks are surfaced as a distinct dashboard category
**Type:** happy-path

**Steps:**
1. Write failing tests: `reconcileParkedFeatures` lists parked slugs; ancestry true → merged; ancestry false + intake marker `Source-Ref:` parses (shared `parseIntakeSourceRef` — assert no new parser) + injected issue state `closed` → orphan; `open` → normal; marker missing/unparseable → unclassified with zero actions and no orphan label.
2. Verify RED.
3. Implement classification in `park-reconciliation.ts` with injected `GetIssueState`-shaped capability.
4. Verify GREEN.
5. Commit: "feat(engine): parked-slug classification (merged/orphan/normal/unclassified)"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 8: Sweep — fail-closed external-failure behavior
**Story:** S7 — Remote and tracker failures degrade to inaction, never to a guess
**Type:** negative-path

**Steps:**
1. Write failing tests: unexpected `merge-base` error → slug skipped (neither merged nor orphan), logged once; `gh` unavailable → merged+record-on-main path still reconciles, orphan classification and repair delegation skipped, no throw; no remote/`origin/main` absent → per-slug no-op, single log line; one slug throwing → remaining slugs processed.
2. Verify RED.
3. Implement error isolation.
4. Verify GREEN.
5. Commit: "feat(engine): sweep fails toward inaction on every external failure"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 7

### Task 9: Sweep — outcome cache and summary suppression
**Story:** S1 — Sweep runs as an injected daemon dep at startup and each idle tick
**Type:** happy-path

**Steps:**
1. Write failing tests: injected outcome cache suppresses repeated per-slug lines across passes; summary line `reconciled/deferred/orphaned/parked/skipped` prints once and is suppressed while unchanged; stale cache entries pruned when a slug unparks.
2. Verify RED.
3. Implement caching mirroring `halt-pr-reconciliation.ts`.
4. Verify GREEN.
5. Commit: "feat(engine): delta-only sweep logging with outcome cache"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts
- src/conductor/test/engine/park-reconciliation.test.ts

**Wired-into:** same as Task 2
**Dependencies:** Task 7

### Task 10: Daemon dep declaration and sweepBestEffort call
**Story:** S1 — Sweep runs as an injected daemon dep at startup and each idle tick
**Type:** infrastructure

**Steps:**
1. Write failing wiring tests (shape of `daemon-halt-reconciliation.test.ts`): dep invoked once at startup before first dispatch, once per idle tick, after `reconcileHaltPrs`; throw swallowed with `[daemon] reconcileParkedFeatures error:` line; absent dep = no-op.
2. Verify RED.
3. Add optional `reconcileParkedFeatures?: () => Promise<void>` to daemon deps and the `sweepBestEffort()` call — minimal additive diff (contended file).
4. Verify GREEN.
5. Commit: "feat(daemon): wire reconcileParkedFeatures into sweepBestEffort"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — dep + call
- src/conductor/test/engine/daemon-parked-reconciliation-wiring.test.ts — new wiring contract

**Wired-into:** src/conductor/src/engine/daemon.ts#sweepBestEffort
**Dependencies:** Task 8, Task 9

### Task 11: daemon-cli binding with toggle gate
**Story:** S3 — Auto-cleanup is governed by `reconcile_parked_auto_cleanup` (default `true`)
**Type:** infrastructure

**Steps:**
1. Write failing tests: boot wiring binds the dep with a per-run cache; startup-resolved toggle `true` → sweep invokes the helper for merged slugs; `false` → helper never invoked, merged slugs annotated `merged — ready to reconcile`; toggle read once at startup.
2. Verify RED.
3. Bind in `daemon-cli.ts` beside the `haltPrSweepCache` binding, passing the resolved config value.
4. Verify GREEN.
5. Commit: "feat(daemon): bind parked reconciliation sweep, gated by reconcile_parked_auto_cleanup"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — binding
- src/conductor/test/engine/daemon-parked-reconciliation-wiring.test.ts

**Wired-into:** src/conductor/src/daemon-cli.ts#daemon boot wiring
**Dependencies:** Task 1, Task 10

### Task 12: Dashboard annotations
**Story:** S6 — Orphaned parks are surfaced as a distinct dashboard category
**Type:** happy-path

**Steps:**
1. Write failing tests: `ParkedEntry` with `annotation: 'orphan'` renders `orphan — needs manual review` suffix; `'merged-ready'` renders `merged — ready to reconcile`; no annotation → unchanged line; PARKED precedence over other groups unchanged; update any golden snapshots asserting PARKED line shape.
2. Verify RED.
3. Extend `ParkedEntry` + `renderDashboard` and populate the annotation in `renderStartupDashboard`'s parked overlay from sweep classification state.
4. Verify GREEN.
5. Commit: "feat(dashboard): orphan and merged-ready annotations on PARKED entries"

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — ParkedEntry + rendering
- src/conductor/src/daemon-cli.ts — parked overlay population
- src/conductor/test/engine/daemon-dashboard.test.ts

**Wired-into:** src/conductor/src/daemon-cli.ts#renderStartupDashboard
**Dependencies:** Task 7

### Task 13: Operator verb `daemon reconcile-parked <slug>`
**Story:** S5 — Operator verb `conduct daemon reconcile-parked <slug>`
**Type:** happy-path

**Steps:**
1. Write failing CLI tests (shape of `daemon-park-cli.test.ts`, real temp repos): happy reconcile prints steps taken, exit 0; not-ancestor → refusal with ancestry result (+ issue state when resolvable), non-zero, no force path; invalid slug → actionable message, non-zero, no git calls; missing/extra args → usage, nothing executed; verb works with toggle `false`.
2. Verify RED.
3. Extend `detectDaemonParkCommand`/add `detectDaemonReconcileCommand` in `daemon-park-cli.ts`, dispatch pre-boot from `src/index.ts`.
4. Verify GREEN.
5. Commit: "feat(cli): conduct daemon reconcile-parked <slug>"

**Files likely touched:**
- src/conductor/src/engine/daemon-park-cli.ts — detection + dispatch
- src/conductor/src/index.ts — pre-boot dispatch
- src/conductor/test/engine/daemon-park-cli.test.ts

**Wired-into:** src/conductor/src/index.ts#pre-boot command dispatch
**Dependencies:** Task 6

### Task 14: `bin/conduct` known-subcommand registration
**Story:** S5 — Operator verb `conduct daemon reconcile-parked <slug>`
**Type:** infrastructure

**Steps:**
1. Write failing shell test: `conduct daemon reconcile-parked x` is forwarded (not "Unknown command"), per the unknown-subcommand guard.
2. Verify RED.
3. Register the verb in `bin/conduct`'s forwarding list.
4. Verify GREEN (run `test/test_harness_integrity.sh` bash/shellcheck checks).
5. Commit: "feat(bin): forward daemon reconcile-parked"

**Files likely touched:**
- bin/conduct — subcommand list
- test/test_bin_conduct_forwarding.sh — case added (or the existing guard test file)

**Wired-into:** same as Task 13
**Dependencies:** Task 13

### Task 15: Re-scope operator-park single-writer audit test
**Story:** S4 — Guarded single-slug cleanup helper re-verifies everything at the point of deletion
**Type:** refactor

**Steps:**
1. Update the grep/audit single-writer test per the amended FR-7 story: allowed writers = canonical park-marker module + `park-reconciliation.ts` guarded helper; assert the sweep itself (non-helper code) still never touches `.daemon/parked/`.
2. Verify the audit passes with the helper present and fails if any other new path touches `.daemon/parked/` (mutation-check the assertion once).
3. Commit: "test(park): re-scope single-writer invariant for guarded reconcile helper"

**Files likely touched:**
- src/conductor/test/engine/park-marker-invariant.test.ts — re-scoped allowlist

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 16: Acceptance — end-to-end reconciliation flows
**Story:** S2 — Fully-merged parked feature is auto-reconciled by default
**Type:** happy-path

**Steps:**
1. Write failing acceptance tests (temp git repos, faithful fakes at gh boundary, style of `operator-park-rekick-sweep.acceptance.test.ts`): (a) merged park + record on base → one pass removes worktree/branch/marker; (b) not-ancestor park → byte-identical state; (c) merged, record missing → nothing deleted, delegation observed, marker survives; (d) in-flight `.pipeline` → worktree untouched; (e) toggle off → annotate-only, zero destructive calls.
2. Verify RED.
3. Fix any integration gaps surfaced.
4. Verify GREEN.
5. Commit: "test(acceptance): parked-feature reconciliation end-to-end"

**Files likely touched:**
- src/conductor/test/acceptance/parked-feature-reconciliation.acceptance.test.ts — new

**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

### Task 17: Acceptance — orphan surfacing and fail-closed classification
**Story:** S6 — Orphaned parks are surfaced as a distinct dashboard category
**Type:** negative-path

**Steps:**
1. Write failing acceptance tests: closed-issue + not-ancestor park renders orphan annotation; missing intake marker → normal parked rendering, no action; gh failure → previous rendering kept; orphan never reaches the cleanup helper (spy).
2. Verify RED.
3. Fix any gaps.
4. Verify GREEN.
5. Commit: "test(acceptance): orphan surfacing fail-closed"

**Files likely touched:**
- src/conductor/test/acceptance/parked-feature-reconciliation.acceptance.test.ts

**Wired-into:** none (no new production surface)
**Dependencies:** Task 12, Task 16

## Task Dependency Graph

```
Task 1 (config) ──────────────────────────────┐
Task 2 (helper skeleton) → Task 3 (ancestry) ─┼→ Task 4 (record) ─┐
                                    │         │                   ├→ Task 6 (cleanup order) → Task 13 (verb) → Task 14 (bin)
                                    │         └→ Task 5 (in-flight)┘         │
                                    │                                        └→ Task 15 (audit re-scope)
                                    └→ Task 7 (classification) → Task 8 (fail-closed) ─┐
                                                │                                      ├→ Task 10 (daemon dep) → Task 11 (cli bind) → Task 16 (acceptance)
                                                │              Task 9 (cache) ─────────┘         ↑
                                                └→ Task 12 (dashboard) ──────────────────────────┴→ Task 17 (acceptance orphan)
```

## Integration Points

- After Task 6: helper reconciles a merged park end-to-end when called directly.
- After Task 11: daemon performs autonomous reconciliation on idle ticks (toggle-gated).
- After Task 14: operator verb usable from `conduct`.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (each an explicit task)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic
- [ ] Every new-surface task carries `Wired-into:`
