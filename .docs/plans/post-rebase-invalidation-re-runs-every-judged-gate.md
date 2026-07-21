# Implementation Plan: Post-rebase delta-aware gate invalidation (#655)

**Date:** 2026-07-20
**Design:** `.docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (APPROVED)
**Stories:** `.docs/stories/post-rebase-invalidation-re-runs-every-judged-gate.md` (Accepted)
**Conflict check:** Clean as of 2026-07-20 (1 degrading overlap resolved via ADR amendment)
**Complexity tier:** M

## Summary
Make the finish-time rebase invalidation decision delta-aware: preserve gate verdicts whose input
surfaces the rebase delta does not touch (killing the ~20–30 min judged tail on the common
test-only / foreign-main-side rebase), with a fail-closed fallback to today's invalidate-everything
behavior. 15 tasks.

## Technical Approach
Two git-derived path sets drive the decision: the **rebase delta** `D = changedCodePaths`
(`preTree..HEAD`, already computed in `classifyClean`, captures main-side + conflict changes, docs
excluded) and the **feature claimed surface** `F = changedPathsBetween(mergeBase, preTree)` (the
files the feature's own commits touched), computed in `performRebase` where both refs already exist
(`rebase.ts:422-423`) and threaded onto `RebaseOutcome.changed`. A new **pure** module
`gate-invalidation.ts` exposes `classifyGateInvalidation(D, F, ranManualTest) → { preserved,
invalidated }` implementing the ADR decision table (a declarative gate→surface map + the
`D_test`/`D_featureSrc`/`D_foreignSrc` partition). `applyRebaseVerdicts` (`rebase.ts:780`) calls it
to select which of `{build_review, wiring_check, manual_test, prd_audit,
architecture_review_as_built}` are invalidated vs preserved (`build` stays on its ADR-2026-07-08
pre-verify, excluded). The `advanceTail` rebase branch (`conductor.ts:5291`) becomes delta-gated:
after re-opening genuinely-invalidated gates, it does NOT let `markDownstreamStale` sweep a
*preserved* judged gate stale — strictly guarded on `kickback.from === 'rebase'`. Two new events
(`rebase_gate_preserved`, `rebase_gate_invalidated`) record each decision with its justifying delta.
Everything fails closed: if `D` or `F` is uncomputable (missing `mergeBase`, git-error diff), the
whole delta path is skipped and today's fixed-set invalidation + blanket cascade run unchanged.

The pure classifier is built and unit-tested first (TDD), then wired into the two call sites, then
the existing invalidation-set tests are amended per the conflict resolution.

## Prerequisites
- None. `preTree`, `mergeBase`, `changedCodePaths`, `RebaseOutcome`, and the events union all exist.

## Tasks

### Task 1: Add the two audit event types to the events union
**Story:** "Every preserve/re-run decision emits an auditable event"
**Type:** infrastructure
**Steps:**
1. Write failing test: a test in `src/conductor/test/engine/events.test.ts` (or the nearest events
   type test) constructs `{ type: 'rebase_gate_preserved', gate, surface, deltaConsidered }` and
   `{ type: 'rebase_gate_invalidated', gate, matchedPaths }` and asserts they satisfy the event
   union type (compile-level) — RED because the members don't exist.
2. Verify RED.
3. Implement: add both interfaces to the `ConductorEvent` union in `types/events.ts` (after
   `rebase_gate_reverified`, ~line 242). `gate: StepName`; `surface`/`deltaConsidered`/`matchedPaths`
   are `string[]`.
4. Verify GREEN.
5. Commit: "feat(events): add rebase_gate_preserved / rebase_gate_invalidated"
**Files likely touched:**
- `src/conductor/src/types/events.ts` — two new union members
- `src/conductor/test/engine/events.test.ts` — type assertion
**Wired-into:** none (no new production surface) — emitted by Tasks 8–9
**Dependencies:** none

### Task 2: Define the gate→surface map + runtime/test path predicates
**Story:** "Compute the feature claimed surface and delta partition"
**Type:** infrastructure
**Steps:**
1. Write failing test: new `src/conductor/test/engine/gate-invalidation.test.ts` asserts
   `isRuntimeSourcePath('src/x.ts') === true`, `isRuntimeSourcePath('src/x.test.ts') === false`,
   `isRuntimeSourcePath('.docs/y.md') === false`, and that `GATE_SURFACE` names
   `build_review, wiring_check, manual_test, prd_audit, architecture_review_as_built` (never `build`).
2. Verify RED.
3. Implement: new `src/conductor/src/engine/gate-invalidation.ts` exporting `isRuntimeSourcePath`
   (a code path that is not a test path and passes `isCodeOrTestPath`) and `isTestPath`, plus a
   `GATE_SURFACE` descriptor per gate (`'feature-runtime' | 'all-runtime' | 'any-codetest'`).
4. Verify GREEN.
5. Commit: "feat(engine): gate→surface map + runtime/test path predicates"
**Files likely touched:**
- `src/conductor/src/engine/gate-invalidation.ts` — new module
- `src/conductor/test/engine/gate-invalidation.test.ts` — new test
**Wired-into:** none (inert until src/conductor/src/engine/rebase.ts) — consumed by Task 6
**Dependencies:** none

### Task 3: Implement the delta partitioner (D_test / D_featureSrc / D_foreignSrc)
**Story:** "Compute the feature claimed surface and delta partition" (happy path)
**Type:** happy-path
**Steps:**
1. Write failing test: `partitionDelta(D, F)` over a mixed delta `D=['src/a.ts','x.test.ts',
   'src/foreign.ts']`, `F=['src/a.ts','x.test.ts']` returns `{ test:['x.test.ts'],
   featureSrc:['src/a.ts'], foreignSrc:['src/foreign.ts'] }`; assert disjointness + that the runtime
   union equals `D ∩ runtime`.
2. Verify RED.
3. Implement: `partitionDelta` in `gate-invalidation.ts` using the Task-2 predicates and set
   membership against `F`.
4. Verify GREEN.
5. Commit: "feat(engine): partitionDelta into test/featureSrc/foreignSrc"
**Files likely touched:**
- `src/conductor/src/engine/gate-invalidation.ts` — `partitionDelta`
- `src/conductor/test/engine/gate-invalidation.test.ts` — partition cases
**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: Implement classifyGateInvalidation — preserve/invalidate decision table
**Story:** "Test-only…preserves audits" / "feature runtime re-runs audits" / "foreign runtime re-runs
manual_test/wiring_check" (happy paths)
**Type:** happy-path
**Steps:**
1. Write failing tests covering the ADR table: (a) `D_featureSrc=∅`, only a feature test file +
   foreign runtime → `prd_audit`/`architecture_review_as_built` PRESERVED, `wiring_check`/`manual_test`
   INVALIDATED, `build_review` INVALIDATED; (b) test/docs-only `D` (no runtime) → all four judged/
   whole-tree gates PRESERVED, `build_review` INVALIDATED (any code/test); (c) `D_featureSrc≠∅` →
   audits INVALIDATED; (d) `ranManualTest=false` → `manual_test` never in either list.
2. Verify RED.
3. Implement: `classifyGateInvalidation(D, F, ranManualTest) → { preserved: StepName[],
   invalidated: StepName[] }` applying `GATE_SURFACE` + `partitionDelta`; `build` never included.
4. Verify GREEN.
5. Commit: "feat(engine): classifyGateInvalidation decision table"
**Files likely touched:**
- `src/conductor/src/engine/gate-invalidation.ts` — `classifyGateInvalidation`
- `src/conductor/test/engine/gate-invalidation.test.ts` — decision-table cases
**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 5: Thread the feature claimed surface F onto RebaseOutcome.changed
**Story:** "Compute the feature claimed surface and delta partition"
**Type:** infrastructure
**Steps:**
1. Write failing test: extend `rebase.test.ts` so a `changed` outcome carries
   `featureSurface: string[]`; assert it equals `changedPathsBetween(mergeBase, preTree)` for a
   fixture where the feature touched a known file — RED (field absent).
2. Verify RED.
3. Implement: extend the `changed` variant of `RebaseOutcome` (`rebase.ts:347-351`) with
   `featureSurface: string[]`; in `performRebase`, after the clean rebase, compute
   `changedPathsBetween(git, mergeBase, preTree)` and pass it through `classifyClean`/into the
   outcome (mergeBase already resolved at `rebase.ts:423`).
4. Verify GREEN.
5. Commit: "feat(rebase): carry feature claimed surface on RebaseOutcome.changed"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `RebaseOutcome`, `classifyClean`, `performRebase`
- `src/conductor/test/engine/rebase.test.ts` — featureSurface assertion
**Wired-into:** `src/conductor/src/engine/rebase.ts#applyRebaseVerdicts` (consumed Task 6), `src/conductor/src/engine/conductor.ts#advanceTail` (consumed Task 7)
**Dependencies:** none

### Task 6: Select the invalidation set via classifyGateInvalidation in applyRebaseVerdicts
**Story:** "Test-only preserves audits" / "feature runtime re-runs audits" / "foreign runtime" (happy)
**Type:** happy-path
**Steps:**
1. Write failing test: in `rebase.test.ts`, a `changed` outcome with delta = {foreign runtime + one
   feature test file} writes NO `satisfied:false` kickback for `prd_audit`/`architecture_review_as_built`
   but DOES for `wiring_check` (and `manual_test` when ran) — RED (today invalidates the fixed set only
   and never touches the judged gates).
2. Verify RED.
3. Implement: in `applyRebaseVerdicts` (`rebase.ts:780`), replace the fixed `targets` array
   (`rebase.ts:857`) with `classifyGateInvalidation(outcome.changedCodePaths, outcome.featureSurface,
   ranManualTest).invalidated`; write `satisfied:false`+`kickback:{from:'rebase'}` only for those
   (build still handled by its pre-verify branch).
4. Verify GREEN.
5. Commit: "feat(rebase): delta-aware invalidation set selection"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `applyRebaseVerdicts` target selection
- `src/conductor/test/engine/rebase.test.ts` — delta-aware set cases
**Wired-into:** same as Task 4
**Dependencies:** Task 4, Task 5

### Task 7: Delta-gate the markDownstreamStale sweep in advanceTail's rebase branch
**Story:** "A preserved judged gate is not swept stale by the downstream cascade"
**Type:** happy-path
**Steps:**
1. Write failing test: a gate-loop test where `manual_test` is re-opened by the rebase and the audits
   are decided PRESERVED asserts `prd_audit`/`architecture_review_as_built` remain `done` (not `stale`)
   after the tail sweep and are not re-selected — RED (navigateBack→markDownstreamStale currently
   marks all downstream stale).
2. Verify RED.
3. Implement: in the `advanceTail` rebase branch (`conductor.ts:5291-5309`), compute the preserved
   set from the same classifier (using `lastRebaseOutcome.changedCodePaths`+`featureSurface`), and
   after the `navigateBack` loop restore any preserved judged gate that the sweep marked `stale` back
   to `done` (or exclude it from the sweep). Guard strictly on the rebase-origin kickback path.
4. Verify GREEN.
5. Commit: "feat(conductor): delta-gate downstream-stale sweep for preserved gates"
**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `advanceTail` rebase branch
- `src/conductor/test/engine/*` — gate-loop preserved-not-stale test
**Wired-into:** `src/conductor/src/engine/conductor.ts#advanceTail` (existing call site; branch extended)
**Dependencies:** Task 4, Task 5

### Task 8: Emit rebase_gate_invalidated for each invalidated gate
**Story:** "Every preserve/re-run decision emits an auditable event"
**Type:** happy-path
**Steps:**
1. Write failing test: a `changed` rebase that invalidates `wiring_check` emits a
   `rebase_gate_invalidated` event `{ gate:'wiring_check', matchedPaths:[…] }` — RED.
2. Verify RED.
3. Implement: in `applyRebaseVerdicts` (or the `advanceTail` kickback-emit loop at `conductor.ts:5296`
   where `kickback` events already fire), emit `rebase_gate_invalidated` alongside each invalidation
   with the matched runtime paths from the classifier.
4. Verify GREEN.
5. Commit: "feat(engine): emit rebase_gate_invalidated with matched delta"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` or `conductor.ts` — emission
- `src/conductor/test/engine/*` — event assertion
**Wired-into:** `src/conductor/src/engine/conductor.ts#advanceTail` (event bus, same path as `rebase_gate_reverified` at conductor.ts:5762)
**Dependencies:** Task 1, Task 6

### Task 9: Emit rebase_gate_preserved for each preserved gate
**Story:** "Every preserve/re-run decision emits an auditable event" (happy)
**Type:** happy-path
**Steps:**
1. Write failing test: a test-only `changed` rebase emits `rebase_gate_preserved` for `prd_audit`
   and `architecture_review_as_built` with `surface` non-empty and `deltaConsidered` reflecting D — RED.
2. Verify RED.
3. Implement: emit `rebase_gate_preserved` for each `classify…preserved` gate at the decision site.
4. Verify GREEN.
5. Commit: "feat(engine): emit rebase_gate_preserved with justifying delta"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` or `conductor.ts` — emission
- `src/conductor/test/engine/*` — event assertion
**Wired-into:** same as Task 8
**Dependencies:** Task 1, Task 6, Task 7

### Task 10: Fail-closed on uncomputable F (missing mergeBase / git-error diff)
**Story:** "Uncomputable delta fails closed to invalidate-all"
**Type:** negative-path
**Steps:**
1. Write failing test: force `mergeBase` empty (fixture with no common ancestor) on a `changed`
   rebase → `applyRebaseVerdicts` invalidates the FULL legacy set `{build_review, wiring_check,
   +manual_test}` and preserves nothing; assert no `rebase_gate_preserved` emitted — RED.
2. Verify RED.
3. Implement: represent uncomputable `F` as a distinct signal (e.g. `featureSurface: null`) from
   `performRebase` when `mergeBase` is empty or the diff errors; in `applyRebaseVerdicts`, when
   `featureSurface` is null, bypass the classifier and use today's fixed target set + record a
   fail-closed reason.
4. Verify GREEN.
5. Commit: "feat(rebase): fail-closed to legacy invalidation on uncomputable F"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — null-surface signal + fallback
- `src/conductor/test/engine/rebase.test.ts` — fail-closed case
**Wired-into:** same as Task 5
**Dependencies:** Task 6

### Task 11: Fail-closed on uncomputable D (preTree..HEAD diff error)
**Story:** "Uncomputable delta fails closed to invalidate-all" (negative path)
**Type:** negative-path
**Steps:**
1. Write failing test: simulate `changedPathsBetween(preTree,'HEAD')` returning a git error →
   `classifyClean` yields the fail-closed changed signal and `applyRebaseVerdicts` invalidates the
   full legacy set — RED.
2. Verify RED.
3. Implement: distinguish a git-error diff (exit≠0) from a genuinely-empty diff in `classifyClean`
   so an error routes to fail-closed (not `noop`); propagate to the fixed-set fallback in Task 10.
4. Verify GREEN.
5. Commit: "fix(rebase): treat delta-diff git errors as fail-closed, not noop"
**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `classifyClean`/`changedPathsBetween` error handling
- `src/conductor/test/engine/rebase.test.ts` — D-error case
**Wired-into:** same as Task 5
**Dependencies:** Task 10

### Task 12: Guard the delta-gating strictly on kickback.from === 'rebase'
**Story:** "A non-rebase kickback is never affected by the delta-gated sweep"
**Type:** negative-path
**Steps:**
1. Write failing test: a `build_review` rework kickback with `from !== 'rebase'` re-runs normally and
   NO `rebase_gate_preserved` event fires / no judged gate is preserved — RED if the sweep gating is
   not origin-guarded.
2. Verify RED.
3. Implement: ensure the Task-7 preserved-restore and the Task-6 selection run only inside the
   rebase-origin path (`lastRebaseOutcome.kind === 'changed'` / `kickback.from === 'rebase'`), never
   for other kickback origins.
4. Verify GREEN.
5. Commit: "fix(conductor): scope delta-gating to rebase-origin kickbacks only"
**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — origin guard
- `src/conductor/test/engine/*` — non-rebase kickback case
**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 13: Preservation only keeps an already-satisfied gate; build pre-verify unaffected
**Story:** "Test-only…preserves audits" (negative) + "The build gate's mechanical pre-verify is unaffected"
**Type:** negative-path
**Steps:**
1. Write failing tests: (a) a judged gate that was `satisfied:false`/absent before the rebase is NOT
   marked preserved-done (it is still selected to run); (b) `build` never appears in a
   `rebase_gate_preserved`/`rebase_gate_invalidated` event and its existing pre-verify path is
   unchanged.
2. Verify RED.
3. Implement: in the decision-application site, only skip invalidation for a preserved gate when its
   current state/verdict is already `done`/satisfied; keep `build` excluded from the classifier.
4. Verify GREEN.
5. Commit: "fix(engine): preserve only already-satisfied gates; keep build on pre-verify"
**Files likely touched:**
- `src/conductor/test/engine/rebase.test.ts` — both cases (test-only: both invariants
  already held by construction from Tasks 4-11's fail-closed, preserved-list-only design)
**Wired-into:** none (no new production surface)
**Dependencies:** Task 6, Task 7

### Task 14: Amend existing invalidation-set + wiring tests per the conflict resolution
**Story:** conflict resolution (wiring_check unconditional→conditional); "foreign runtime" story
**Type:** refactor
**Steps:**
1. Update `rebase.test.ts` cases (~line 210/226) that assert the fixed set
   `['build','build_review','wiring_check','manual_test']`: keep them for the fail-closed / runtime-in-D
   paths, and add the delta-aware expectations (test-only delta preserves `wiring_check`).
2. Update the wiring story's invalidation assertion in
   `.docs/stories/2026-07-12-wiring-reachability-gate.md` (lines 156–161) to the refined "invalidated
   iff the delta contains runtime source" wording, citing this ADR.
3. Run the conductor suite; verify GREEN.
4. Commit: "test: amend invalidation-set + wiring assertions for delta-aware invalidation"
**Files likely touched:**
- `src/conductor/test/engine/rebase.test.ts` — amended set assertions
- `src/conductor/test/integration/rebase-loop.test.ts` — judged-tail no-rerun on test-only delta
- `.docs/stories/2026-07-12-wiring-reachability-gate.md` — refined assertion text
**Wired-into:** none (no new production surface)
**Dependencies:** Task 6, Task 7, Task 8, Task 9
**Verify-only:** — (this task lands test/story edits)

### Task 15: Update README + CHANGELOG
**Story:** docs-track-features (repo convention)
**Type:** infrastructure
**Steps:**
1. Update `src/conductor/README.md` post-rebase invalidation section to describe the delta-aware
   decision (D/F, the per-gate table, the two audit events, fail-closed).
2. Add a `## [Unreleased]` → `### Changed` entry to `CHANGELOG.md` for delta-aware post-rebase
   invalidation (#655).
3. Commit: "docs: delta-aware post-rebase invalidation (README + CHANGELOG)"
**Files likely touched:**
- `src/conductor/README.md` — post-rebase section
- `CHANGELOG.md` — `[Unreleased]` Changed entry
**Wired-into:** none (no new production surface)
**Dependencies:** Task 6, Task 7
**Verify-only:** — (docs edits)

## Task Dependency Graph
```
Task 1 (events) ─────────────┐
                             ├─▶ Task 8 (emit invalidated) ─▶ Task 9 (emit preserved)
Task 2 (surface map) ─▶ Task 3 (partition) ─▶ Task 4 (classifier) ─┐
                                                                   ├─▶ Task 6 (select set) ─┬─▶ Task 10 (fail-closed F) ─▶ Task 11 (fail-closed D)
Task 5 (thread F) ─────────────────────────────────────────────────┘                       │
                                                                                            ├─▶ Task 7 (delta-gate sweep) ─▶ Task 12 (origin guard)
                                                                                            │                              └─▶ Task 13 (preserve-satisfied-only)
                                                                          Tasks 6,7,8,9 ────┴─▶ Task 14 (amend tests) ─▶ (Task 15 docs)
```
Acyclic. Roots: Task 1, Task 2, Task 5.

## Integration Points
- After Task 6: delta-aware invalidation *set* observable end-to-end in `rebase.test.ts`.
- After Task 7: full preserve behavior (judged tail not re-run) observable via a gate-loop test.
- After Task 9: audit events prove the decision in the event log.
- After Task 11: fail-closed guarantees provable for both D and F.

## Verification
- [ ] All happy-path criteria covered (Tasks 3–9)
- [ ] All negative-path criteria covered (Tasks 10–13)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Every new-surface task carries `Wired-into:` (Tasks 1,2,5,8,9 declare/inherit; others `none`)
- [ ] Conflict resolution (wiring test/story amendment) scoped as Task 14
- [ ] Docs + CHANGELOG scoped as Task 15
