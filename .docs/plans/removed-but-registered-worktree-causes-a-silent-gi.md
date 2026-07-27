# Implementation Plan: Removed-but-registered worktree — prune reconciliation + durable creation-failure park (#1022)

**Date:** 2026-07-27
**Design:** .docs/decisions/adr-2026-07-27-worktree-prune-reconciliation-and-creation-failure-park.md (APPROVED) · .docs/decisions/architecture-review-2026-07-27-removed-but-registered-worktree-1022.md (APPROVED) · .docs/architecture/removed-but-registered-worktree-causes-a-silent-gi.md
**Stories:** .docs/stories/removed-but-registered-worktree-causes-a-silent-gi.md (Accepted; S1–S5)
**Conflict check:** Clean as of 2026-07-27 (.docs/conflicts/2026-07-27-removed-but-registered-worktree-1022.md)
**Track/Tier:** technical · M

## Summary

Close the removed-but-registered worktree loop at three seams: make
`isRegisteredWorktree` parse `git worktree list --porcelain` into **records** so a
`prunable` registration reports not-usable; make `ensureWorktree` run `git worktree prune`
when — and only when — it observed a prunable record for the requested path, so the
following add succeeds instead of exiting 128; and make `daemon-runner`'s catch write a
durable `.daemon/parked/<slug>` auto-park when `createWorktree` throws before a worktree
exists, so the feature stops being re-dispatched and carries its cause. 11 tasks.

## Technical Approach

- **`worktree-shared.ts` — record parsing.** Replace the line-wise filter in
  `isRegisteredWorktree` (`:86-102`) with a porcelain **record** parser. Records are
  separated by blank lines; `prunable` is a sibling line *within* a record, not a modifier
  on the `worktree` line (verified against real git output — a line-wise filter cannot see
  it and silently preserves the bug). Extract a small exported
  `parseWorktreeRecords(stdout): Array<{ path: string; prunable: boolean }>` so the parser
  is unit-testable independently of git. The existing exact-path-or-`.worktrees/<name>`-suffix
  match and the fail-soft `catch → false` contract are both preserved verbatim.
- **`worktree-shared.ts` — reconciliation.** `isRegisteredWorktree` keeps its boolean
  signature (it has other callers); add a sibling
  `findWorktreeRecord(root, path): Promise<{ registered: boolean; prunable: boolean }>`
  that `ensureWorktree` uses. In `ensureWorktree` (`:51-68`): reuse only when
  `registered && !prunable`; when `prunable`, run `git worktree prune` in `root` **once**
  before falling through to the existing attach/create branches, which are otherwise
  unchanged. Prune is never unconditional — a healthy repo's git call sequence must stay
  byte-identical, which Task 5 pins.
- **Lazy base is untouched.** `resolveBase()` stays invoked only on the fresh-branch path;
  the prune-then-attach route must not trigger it. The existing daemon-deps call-ordering
  test asserts this and must stay green (Task 6).
- **`daemon-runner.ts` — durable failure record.** The catch at `:529-543` currently guards
  `if (worktree)`. Add the `else` arm: when `worktree === null` the throw happened at or
  before `deps.createWorktree(item.slug)` (`:311`), so write
  `writeAutoPark(projectRoot, item.slug, reason)` with the git error text plus the prune
  remedy. Needs a `projectRoot` and a `writeAutoPark` seam on `DaemonRunnerDeps` (inject
  rather than import directly, matching how the runner takes every other side effect) —
  wire the production implementation in `daemon-cli.ts` next to the existing
  `isParked`/`isHalted` wiring (`:1360`). The park write is wrapped so a failure cannot mask
  the original error, mirroring `writeErrorHalt`'s best-effort contract. The returned
  `FeatureOutcome` is unchanged (`status:'error'`, same reason).
- **No change to `pickEligible`.** The gate already honors the marker:
  `isOperatorParked` is provenance-agnostic and reads the same path `writeAutoPark` writes
  (verified — see the conflict check). This is why the fix needs no dispatch-layer edit.
- **Test homes.** `src/conductor/test/engine/worktree-shared.test.ts` (S1, S2),
  `…/engine/daemon-runner.test.ts` (S3), `…/engine/engineer/worktree-authoring.test.ts`
  (S4). **Mocking constraint:** that suite mocks execa wholesale and the comment at
  `worktree-shared.test.ts:90-95` records that making the module-level mock *reject* trips a
  vitest settled-result artifact. Throw from inside `mockImplementation`'s branch for the
  failing subcommand — the pattern the `show-ref` branch already uses at line 31 — never
  `mockRejectedValue`.
- **Sequencing:** parser first (T1), then the reconciliation it enables (T2–T3), then the
  no-regression pins (T4–T6), then the daemon park layer (T7–T9), then docs/changelog
  (T10–T11).

## Prerequisites

None. `git worktree prune` is already used at `worktree.ts:87`; `writeAutoPark`,
`resolveMainRepoRoot`, and `getProvenanceType` all exist in `park-marker.ts`. No migration,
no config key, no VERSION bump (pre-v1: CHANGELOG `[Unreleased]` only). No `bin/conduct`
CLI, hook-wiring, skill-symlink, or `settings.json` schema change — so no migration block
and no release waiver.

## Tasks

### Task 1: parseWorktreeRecords — record-wise porcelain parsing
**Story:** S1 (1a, 1c)
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `worktree-shared.test.ts` for a new exported
   `parseWorktreeRecords(stdout)`: the canonical prunable fixture from the stories
   (`worktree` / `HEAD` / `branch` / `prunable gitdir file points to non-existent location`)
   yields one record with `prunable: true`; a healthy record yields `prunable: false`; a
   two-record fixture where only the *second* is prunable yields `[false, true]` — pinning
   that prunable-ness never bleeds across records.
2. Verify RED (export does not exist).
3. Implement `parseWorktreeRecords` in `worktree-shared.ts`: split `stdout` on blank lines,
   and for each block take the `worktree ` line's value as `path` and the presence of any
   line whose first token is `prunable` as `prunable`.
4. Verify GREEN.
5. Commit: "feat(engine): parse git worktree porcelain into records"

### Task 2: isRegisteredWorktree rejects a prunable registration
**Story:** S1 (1a, 1b)
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests: `isRegisteredWorktree` returns `false` for the prunable fixture and
   `true` for the healthy one.
2. Verify RED.
3. Reimplement `isRegisteredWorktree` over `parseWorktreeRecords`, matching the requested
   path and returning `registered && !prunable`.
4. Verify GREEN.
5. Commit: "fix(engine): treat a prunable worktree registration as not usable"

### Task 3: findWorktreeRecord exposes prunability to ensureWorktree
**Story:** S1 (1a)
**Story:** S2 (2a)
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests for `findWorktreeRecord(root, path)` returning
   `{registered:true, prunable:true}` for the prunable fixture, `{true,false}` for healthy,
   and `{false,false}` when the path is absent.
2. Verify RED.
3. Implement it over `parseWorktreeRecords`, sharing the path-matching helper with
   `isRegisteredWorktree` so the two cannot diverge.
4. Verify GREEN.
5. Commit: "feat(engine): expose worktree registration prunability"

### Task 4: preserved matching and fail-soft contracts
**Story:** S1 (1d, 1e)
**Type:** negative-path
**Dependencies:** Task 2, Task 3

**Steps:**
1. Write failing tests: a realpath-resolved record sharing the `.worktrees/<name>` suffix
   (no `prunable`) still reports registered; a `git worktree list` that throws still yields
   `false` rather than propagating.
2. Verify RED (or confirm already-green and pin as regression coverage).
3. Adjust the parser/matcher only if a contract regressed.
4. Verify GREEN.
5. Commit: "test(engine): pin worktree suffix matching and fail-soft after record rewrite"

### Task 5: ensureWorktree prunes then attaches/creates
**Story:** S2 (2a, 2b, 2c)
**Type:** happy-path
**Dependencies:** Task 3

**Steps:**
1. Write failing tests asserting the recorded argv sequence: for a prunable path **with** an
   existing branch → `['worktree','prune']` in `root` **then**
   `['worktree','add',PATH,BRANCH]`, resolving `reconcile:'attached'`; for a prunable path
   **without** the branch → prune then
   `['worktree','add','-b',BRANCH,PATH,'main']`. Assert prune precedes the add (2c).
2. Verify RED (no prune is issued today).
3. Implement in `ensureWorktree`: reuse only when `registered && !prunable`; when `prunable`,
   `await execa('git',['worktree','prune'],{cwd:root})` once before the existing
   attach/create branches.
4. Verify GREEN.
5. Commit: "fix(engine): prune a stale worktree registration before add"

### Task 6: no prune in a healthy repo; lazy base preserved
**Story:** S2 (2d, 2e)
**Type:** negative-path
**Dependencies:** Task 5

**Steps:**
1. Write failing/regression tests: for each of the three healthy routes (registered-healthy,
   absent-with-branch, absent-without-branch) assert **no** `worktree prune` appears in the
   recorded argv and the sequence matches the pre-change expectation; assert
   `resolveBase` is not called on the reuse, attach, and prune-then-attach routes.
2. Verify RED where applicable.
3. Fix any over-broad prune trigger surfaced.
4. Run the existing `daemon-deps` call-ordering test to confirm the lazy-base contract.
5. Verify GREEN.
6. Commit: "test(engine): pin no-prune-when-healthy and lazy base resolution"

### Task 7: DaemonRunnerDeps gains projectRoot + writeAutoPark seams
**Story:** S3 (3a)
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write a failing test constructing the runner with the new deps and asserting the type
   surface is honored (injected spy present, not invoked on the success path).
2. Verify RED.
3. Add `projectRoot` and `writeAutoPark(slug, reason)` to `DaemonRunnerDeps`; wire the
   production implementations in `daemon-cli.ts` beside the existing `isParked`/`isHalted`
   wiring, delegating to `park-marker.ts`'s `writeAutoPark(projectRoot, slug, reason)`.
4. Verify GREEN.
5. Commit: "feat(engine): inject auto-park seam into the daemon runner"

### Task 8: a pre-worktree throw writes a durable auto-park
**Story:** S3 (3a, 3b)
**Type:** happy-path
**Dependencies:** Task 7

**Steps:**
1. Write failing tests: with `deps.createWorktree` throwing a 128 `already registered`
   error, assert the injected `writeAutoPark` is called once with the slug and a reason
   containing the git error text **and** the string `git worktree prune`; assert the
   outcome is still `status:'error'` with the same reason.
2. Verify RED (nothing is written today — the `if (worktree)` guard).
3. Implement the `else` arm in the `daemon-runner.ts` catch (`:535`) for
   `worktree === null`.
4. Verify GREEN.
5. Commit: "fix(daemon): durably auto-park a feature whose worktree could not be created"

### Task 9: park layer negatives — post-worktree unchanged, write never masks
**Story:** S3 (3e, 3f)
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests: a throw **after** a successful `createWorktree` still calls
   `writeErrorHalt` + `teardownWorktree(worktree,true)` and calls `writeAutoPark`
   **never**; a `writeAutoPark` that itself rejects still yields
   `status:'error'` carrying the **original** worktree failure reason and does not throw
   out of the runner.
2. Verify RED.
3. Wrap the park write best-effort so it cannot mask the original error.
4. Verify GREEN.
5. Commit: "test(daemon): pin auto-park does not displace HALT or mask the original error"

### Task 10: acceptance — real git, prunable state end to end
**Story:** S3 (3c, 3d)
**Story:** S4 (4a, 4b, 4c)
**Type:** happy-path
**Dependencies:** Task 5, Task 8

**Steps:**
1. Write a failing acceptance spec driving a **real** git repo on disk (matching the style
   of `test/acceptance/parked-feature-reconciliation.acceptance.test.ts`): create a
   worktree, `rm -rf` its directory, then exercise `ensureWorktree` and assert the worktree
   is recreated and usable. Then assert an unreconcilable creation failure produces a
   `.daemon/parked/<slug>` marker whose `getProvenanceType` is `'auto'`, that
   `isOperatorParked` reports it (the dispatch gate, incl. a fresh process with empty
   in-memory sets), and that `removeOperatorPark` clears it.
2. Add the engineer cases: a stale `engineer-<slug>` registration reconciles to
   `'attached'`; an unreconcilable failure surfaces the FR-7 strict-abort message rather
   than a bare `ENOENT`; a healthy dirty leftover still hits the FR-11 refusal.
3. Verify RED.
4. Implement only what the specs require (expected: no production change beyond T5/T8 —
   the engineer inherits the shared fix).
5. Verify GREEN.
6. Commit: "test(acceptance): removed-but-registered worktree reconciles and parks durably"

### Task 11: documentation and changelog
**Story:** S5 (5a, 5b, 5c)
**Type:** happy-path
**Dependencies:** Task 10

**Steps:**
1. Update `docs/runbooks/worktree-and-evidence-recovery.md`: the Symptom entries naming the
   `prunable` line and the 128 `already registered` failure now describe automatic engine
   reconciliation on next dispatch; demote the manual `git worktree prune` step to a
   fallback.
2. Update `docs/guides/running-the-daemon.md` with the worktree-creation-failure auto-park
   reason and the `conduct daemon unpark <slug>` recovery.
3. Add a `### Fixed` entry under `## [Unreleased]` in `CHANGELOG.md`. Do **not** touch
   `VERSION` (pre-v1 policy).
4. Run `test/test_harness_integrity.sh` and the full vitest suite; fix any failure.
5. Commit: "docs: worktree reconciliation is automatic; document the creation-failure park"

## Task Dependency Graph

```
T1 ─┬─> T2 ─┬─> T4
    └─> T3 ─┴─> T5 ──> T6
                 │
T7 ──> T8 ──> T9 │
       └─────────┴──> T10 ──> T11
```

## Integration Points

- After T5: the prunable path is reconciled — the #1022 reproduction no longer 128s.
- After T6: proof the fix is inert in a healthy repo (no behavior change to the common path).
- After T9: any creation failure is durably recorded and gates dispatch.
- After T10: both callers verified against real git; the loop is closed end to end.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| S1 1a, 1c (prunable detection, per-record isolation) | T1, T2 |
| S1 1b (healthy still reuses) | T2 |
| S1 1d, 1e (suffix match, fail-soft) | T4 |
| S2 2a, 2b, 2c (prune then attach/create; prune is present) | T5 |
| S2 2d, 2e (no prune when healthy; lazy base) | T6 |
| S3 3a, 3b (auto-park written; cause + remedy in body) | T7, T8 |
| S3 3c, 3d (dispatch gated incl. fresh process; provenance + unpark) | T10 |
| S3 3e, 3f (post-worktree HALT unchanged; write never masks) | T9 |
| S4 4a, 4b, 4c (engineer reconcile, strict-abort, dirty refusal) | T10 |
| S5 5a, 5b, 5c (runbook, daemon guide, changelog) | T11 |

## Verification

- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (T4, T6, T9, T10)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic (graph above)
- [ ] Prune is conditional — T6 proves a healthy repo's git call sequence is unchanged
- [ ] The execa-mock rejection constraint (`worktree-shared.test.ts:90-95`) is honored: throw
      from inside `mockImplementation`, never `mockRejectedValue`
- [ ] `test/test_harness_integrity.sh` passes; VERSION unchanged (pre-v1)
