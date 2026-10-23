# Implementation Plan: kickback-budget inspect --child shows wrong prd_audit/as-built budgets (#3364)

**Date:** 2026-10-22
**Design:** none (technical track, Small tier; governed by `adr-2026-10-12-routed-whole-feature-repair` D10 and `adr-2026-10-07-per-child-build-region` D10)
**Stories:** .docs/stories/kickback-budget-inspect-child-shows-wrong-prd-audi.md
**Conflict check:** Not required at Small tier

## Summary

`kickback-budget inspect` renders a child view from one ledger, the child's. That includes the
feature-wide `prd_audit` and `architecture_review_as_built` budgets, their pending lap charges and
the plan-growth line. Those budgets live in the flat ledger, where the cap halt, `raise`/`reset` and
daemon re-kick read and write them. This plan routes each gate to its owning ledger, in 4 tasks.

## Technical Approach

- **Where the change lives.** Everything is in `src/conductor/src/engine/kickback-budget-cli.ts`.
  `raise`/`reset` already route by gate through the module-level
  `WHOLE_FEATURE_GATES = new Set(['prd_audit', 'architecture_review_as_built', 'manual_test'])`:
  `ledgerChild = WHOLE_FEATURE_GATES.has(gate) ? undefined : child`. `daemon-rekick.ts` makes the
  same choice with its `WHOLE_FEATURE_KICKBACK_GATES`. `inspect` is the only reader that ignores the
  set.
- **Inspect with a child selected.** This covers both an explicit `--child` and the default execution
  child. The `inspect` branch of `dispatchKickbackBudgetCommand` reads two ledgers:
  - the flat ledger, `readKickbackLedger(worktree)`;
  - the child ledger, `readKickbackLedger(worktree, child)`.

  Each gate takes its entry, and its malformed-gate status (`unreadableKickbackGates`), from the
  flat ledger when `WHOLE_FEATURE_GATES.has(gate)`, and from the child ledger otherwise
  (`build_review`, `restack`). If either ledger's envelope is unreadable, inspect prints the existing
  `kickback-budget: ledger is unreadable.` and exits 1. The plan-growth line is shown in every gate
  block, so an unreadable flat ledger leaves no complete view to print.
- **Which child counts as selected.** In the steps below, `child` means the value after the execution-child default is resolved: the existing `selectedChild`/`child` locals of the `inspect` branch. The existing `--child` validation and `childStateExists` refusal stay ahead of every ledger read and reconciliation.
- **Inspect with no child.** Both reads resolve to the same flat ledger, so a childless feature's
  output is byte-identical to today.
- **Pending lap charges.** `pendingLaps(gate)` reads the flat ledger's `pendingRepair`. Child ledgers
  refuse `pendingRepair` (`adr-2026-10-07-per-child-build-region` D10), so today's child read always
  yields 0.
- **Reconciliation.** Inspect's command-entry reconciliation (`reconcilePendingAdjustments`) runs for
  the child ledger, as today, and also for the flat ledger when a child is selected. A
  whole-feature-gate `raise` stages its pending adjustment in the flat ledger.
- **Plan growth.** `planGrowthViewFor` loses its `child` parameter and its child-ledger branch.
  Growth, `effectiveGrowthCap` and `pendingRepair` exist only in the flat ledger, so the branch read
  a cap that is never set (`config-derived`), and through `readGrowth` it read with
  `persist: true`. The function always returns the feature-wide budget:
  - `readPlanGrowthBudget(worktree, config, { persist: false })`;
  - wrapped by `withPendingGrowth(…, flatLedger.pendingRepair)`.

  The cap halt renders the same budget, via `pendingRepairSettlementBudgets` →
  `readPlanGrowthBudget`. Both callers pass the flat ledger: inspect, and the post-mutation print
  in `raise`/`reset`. That print therefore shows the feature-wide cap for a child-scoped
  `build_review` raise too.
- **Pattern to reuse.** The routing is the same per-gate selection `raise`/`reset` already make.
  Search hints: `WHOLE_FEATURE_GATES` in `kickback-budget-cli.ts`, and `WHOLE_FEATURE_KICKBACK_GATES`
  in `daemon-rekick.ts`. Reuse the module's existing `WHOLE_FEATURE_GATES` constant; add no new gate
  list.
- **Tests.** They extend the existing `describe('kickback-budget inspect --child')` block in
  `src/conductor/test/cli/kickback-budget.test.ts`. Its fixtures are `makeFeature` plus a
  `children/2/kickback-ledger.json`, and its raise fixtures write `.pipeline/HALT` and
  `.pipeline/HALT.class`. The default-execution-child case uses `stackedFixture` in
  `src/conductor/test/engine/recovery-cli-child-default.test.ts`.
- **Unchanged.** No halt text changes and no new CLI flag, schema or event.

## Prerequisites

- None.

## Tasks

### Task 1: Route each gate of a child inspect view to its owning ledger
**Story:** Story 1 (happy 1, 2, 5, 6, 7), Story 2 (happy 1, 2; negative 1, 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`, inside the `kickback-budget inspect --child` block.
   - **Fixture.** The flat ledger holds:
     - `architecture_review_as_built`: `laps: 3`, `effectiveLapCap: 4`, one `raise` adjustment, and `capEvidence` plus `resumeAuthorization` bound to halt generation `g1`;
     - `prd_audit`: `laps: 5`, `effectiveLapCap: 5`, two `raise` adjustments;
     - `build_review`: `cumulative: 1`.

     The child-2 ledger holds stale `prd_audit` and `architecture_review_as_built` entries with `count: 0` and no laps or adjustments, a `build_review` entry with `cumulative: 4` and `effectiveLimit: 6`, and a `restack` entry. `.pipeline/HALT` carries `Kickback halt generation: g1`.
   - **Human output.** Assert inspect `--child 2` prints:
     - `Kickback budget (architecture_review_as_built): 3/4 consumed; 1 remaining`;
     - the raise id in `Adjustment history:`;
     - `Resume authorization: awaiting daemon sweep`;
     - `Kickback budget (build_review): 4/6 consumed; 2 remaining`;
     - a `restack` block rendered from the child-2 entry.
   - **JSON output.** Assert `--format json --child 2` carries `child: 2`, and that its `prd_audit` gate has `consumed` 5, `limit` 5, `laps` 5, `lapCap` 5 and both adjustment ids.
   - **Halt line.** Write this test in `src/conductor/test/engine/conductor-kickback-transition.test.ts`, using its `runBuild` harness.
     - **Produce a real halt.** Follow the existing "records a raised lap cap as the cap evidence limit" case: the flat `architecture_review_as_built` entry has `laps: 3` and `effectiveLapCap: 3`, and the pending repair charges it 1 lap. Add a `runBuild` option that sets the conductor's `activeRegionChild` to child 2 before the run, the same cast the "keeps a manual-test kickback to plan feature-scoped even while child 2 is active" case uses. The conductor's BUILD-transition settlement then writes a real `kickback-cap` `.pipeline/HALT` that ends with `for child 2`.
     - **Inspect it.** Place the harness directory at `<root>/.worktrees/transition` so `dispatchKickbackBudgetCommand` resolves feature `transition`. Write `.pipeline/children/2/kickback-ledger.json` with a zero-lap `architecture_review_as_built` copy. Run inspect `--child 2`.
     - **Compare.** Assert its `Kickback budget (architecture_review_as_built):` line is byte-identical to the one in that HALT.
   - **Raise, then inspect.** Use a live `kickback-cap` halt for the flat `architecture_review_as_built` cap evidence: `.pipeline/HALT` carries `Kickback halt generation: <gen>` and `.pipeline/HALT.class` is `kickback-cap`. Run `raise --gate architecture_review_as_built --by 1 --child 2` (interactive, injected operator, `appendEvent` stub), then inspect `--child 2`. Assert the as-built block shows the raised limit and lists the new adjustment id.
   - **Existing tests.** Keep the existing unreadable-child-ledger test and the missing-child-3 test passing. Extend the missing-child test to assert the flat ledger bytes are unchanged.
2. Write a failing test in `src/conductor/test/engine/recovery-cli-child-default.test.ts`. On `stackedFixture()`, whose execution child is 2, write the same flat `architecture_review_as_built` entry and a zero-lap child-2 copy. Assert that inspect without `--child` reports the flat consumed count, limit and adjustment history.
3. Verify the tests fail (RED). Today the as-built block prints `0/…` from the child copy.
4. Implement in `src/conductor/src/engine/kickback-budget-cli.ts`, in the `inspect` branch:
   - read `flatLedger = await readKickbackLedger(worktree)` and, when `child !== undefined`, `childLedger = await readKickbackLedger(worktree, child)`; otherwise `childLedger = flatLedger`;
   - define `ledgerFor(gate) = WHOLE_FEATURE_GATES.has(gate) ? flatLedger : childLedger`;
   - keep the existing `kickback-budget: ledger is unreadable.` refusal for the child ledger (Task 4 adds the flat ledger's unreadability and per-gate availability);
   - pass `ledgerFor(gate).gates[gate]` to `kickbackBudgetView` and `renderKickbackBudgetView`.

   Reuse the existing `WHOLE_FEATURE_GATES` constant, which is the same selection `raise`/`reset` make. Add no new gate list.
5. Verify the tests pass (GREEN).
6. Commit: "fix(kickback-budget): inspect reads feature-wide gates from the flat ledger in child views"

**Done when:**
- [test] An inspect `--child 2` test in `test/cli/kickback-budget.test.ts` asserts, against a child-2 ledger holding stale zero-lap copies, that `dispatchKickbackBudgetCommand` prints `Kickback budget (architecture_review_as_built): 3/4 consumed; 1 remaining`, lists the flat raise id in `Adjustment history:`, and prints `Resume authorization: awaiting daemon sweep`.
- [test] The same fixture with `--format json --child 2` yields `"child": 2` and a `prd_audit` gate with `consumed` 5, `limit` 5, `laps` 5, `lapCap` 5 and both flat adjustment ids; and in `test/engine/conductor-kickback-transition.test.ts`, after the conductor's BUILD-transition settlement writes a real `kickback-cap` HALT ending `for child 2` for an exhausted 3/3 `architecture_review_as_built` lap cap, inspect `--child 2` (child-2 ledger holding a zero-lap copy) prints a `Kickback budget (architecture_review_as_built):` line byte-identical to that HALT's line.
- [test] Inspect without `--child` on `stackedFixture()` (execution child 2) in `test/engine/recovery-cli-child-default.test.ts` reports the flat ledger's as-built consumed count, limit and adjustment history, identical to the `--child 2` values; and after `raise --gate architecture_review_as_built --by 1 --child 2` against a live `kickback-cap` halt, inspect `--child 2` shows the as-built block's raised limit and lists the new adjustment id.
- [test] Inspect `--child 2` prints `Kickback budget (build_review): 4/6 consumed; 2 remaining` from the child-2 ledger while the flat `build_review` holds cumulative 1, renders `restack` from the child-2 entry, keeps exit 1 with `kickback-budget: ledger is unreadable.` for an unparseable child-2 ledger and the readable flat ledger, and keeps exit 1 with `kickback-budget: child 3 has no child state.` and unchanged flat ledger bytes for `--child 3`.
- The `inspect` branch of `dispatchKickbackBudgetCommand` in `src/conductor/src/engine/kickback-budget-cli.ts` selects each gate's entry from the flat ledger when `WHOLE_FEATURE_GATES.has(gate)` and from the selected child's ledger otherwise.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — per-gate ledger selection in `inspect`
- `src/conductor/test/cli/kickback-budget.test.ts` — child-view routing tests
- `src/conductor/test/engine/recovery-cli-child-default.test.ts` — default execution child test
- `src/conductor/test/engine/conductor-kickback-transition.test.ts` — real child-2 cap halt compared with inspect

**Dependencies:** none

### Task 2: Plan growth in child views and child-scoped raise output comes from the feature-wide budget
**Story:** Story 1 (happy 3), Story 2 (happy 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`:
   - **Inspect.** The fixture's flat ledger sets `effectiveGrowthCap: 15`, and a child-2 ledger exists. Assert every gate block printed by inspect `--child 2` has a `Plan growth:` line naming cap 15 with `(raised cap)`. Assert its added count equals the `growth.added` that `readPlanGrowthBudget(worktree, config, { persist: false })` returns for that worktree.
   - **Raise.** In the existing `kickback-budget raise and reset --child` block, add a new fixture: a copy of `childFixture` whose flat ledger also sets `effectiveGrowthCap: 15`. Leave `childFixture` unchanged so the existing tests keep their config-derived plan-growth lines. Capture the printed output of `raise --gate build_review --by 1 --child 2`. Assert:
     - the adjustment lands in the child-2 ledger (`effectiveLimit` 6);
     - the flat ledger bytes are unchanged;
     - the printed `Plan growth:` line names cap 15.
2. Verify the tests fail (RED). Today both print the `config-derived` cap.
3. Implement in `src/conductor/src/engine/kickback-budget-cli.ts`:
   - change `planGrowthViewFor(worktree, ledger)` to drop the `child` parameter and the child-ledger branch;
   - have it always return `withPendingGrowth({ ...budget.growth, cap, capSource, authoredSource }, ledger.pendingRepair)` from `readPlanGrowthBudget(worktree, config, { persist: false })`, keeping the existing `cap: null` rule for an unresolved plan with a config-derived cap;
   - update both callers to pass the flat ledger: inspect, and the post-mutation print in `raise`/`reset`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(kickback-budget): plan growth always reports the feature-wide budget"

**Done when:**
- [test] Inspect `--child 2` on a flat ledger with `effectiveGrowthCap: 15` prints, in every gate block, a `Plan growth:` line naming cap 15 with `(raised cap)` and the added count equal to `readPlanGrowthBudget(…, { persist: false })`'s `growth.added`.
- [test] `raise --gate build_review --by 1 --child 2` against the live `needs-human` halt writes `effectiveLimit` 6 to the child-2 ledger, leaves the flat ledger bytes unchanged, and prints a `Plan growth:` line naming cap 15.
- `planGrowthViewFor` in `src/conductor/src/engine/kickback-budget-cli.ts` has no child parameter and derives every view from `readPlanGrowthBudget` with `persist: false` plus the flat ledger's `pendingRepair`.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — `planGrowthViewFor` and its two callers
- `src/conductor/test/cli/kickback-budget.test.ts` — child-view and child-raise plan-growth tests

**Dependencies:** Task 1

### Task 3: Pending charges and pending adjustments of feature-wide gates come from the flat ledger
**Story:** Story 1 (happy 4, 8; negative 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`, inside the `kickback-budget inspect --child` block:
   - **Pending charge.** The flat ledger's `pendingRepair` charges `prd_audit` 1 lap. Assert inspect `--child 2` prints `Pending charge: 1 lap (charged when build dispatches)` in the `prd_audit` block, and that its `remaining` is limit minus consumed minus 1.
   - **Interrupted raise.** The flat ledger's `prd_audit` entry carries `capEvidence` and a staged `pendingAdjustment` that raises the limit. Record its `kickback_budget_adjustment_authorized` event with `appendCloseoutEvent`, following the existing pending-adjustment reconciliation tests in this file. Assert:
     - inspect `--child 2` shows the raised limit in the `prd_audit` block;
     - the flat ledger entry has no `pendingAdjustment` and lists the adjustment once;
     - a second inspect leaves the flat ledger bytes unchanged.
   - **Read-only.** With no pending adjustment in either ledger, assert inspect `--child 2` leaves the flat and child-2 ledger bytes unchanged.
2. Verify the tests fail (RED).
3. Implement in the `inspect` branch of `dispatchKickbackBudgetCommand`:
   - when `child !== undefined`, also run `reconcile(undefined)` (flat) after `reconcile(child)` and before the ledgers are read;
   - read `pendingLaps(gate)` from `flatLedger.pendingRepair`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(kickback-budget): child views reconcile and charge feature-wide gates in the flat ledger"

**Done when:**
- [test] Inspect `--child 2` with a flat `pendingRepair` charging 1 `prd_audit` lap prints `Pending charge: 1 lap (charged when build dispatches)` in the `prd_audit` block and a `remaining` of limit minus consumed minus 1.
- [test] Inspect `--child 2` with a staged flat `prd_audit` `pendingAdjustment` whose authorization event is recorded shows the raised limit, leaves the flat entry with no `pendingAdjustment` and the adjustment listed once, and a second inspect leaves the flat ledger bytes unchanged.
- [test] Inspect `--child 2` with no pending adjustment in either ledger leaves the flat and child-2 ledger bytes unchanged.
- The `inspect` branch of `dispatchKickbackBudgetCommand` calls `reconcilePendingAdjustments` for the flat ledger as well as the child ledger when a child is selected, and `pendingLaps` reads the flat ledger's `pendingRepair`.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — flat reconciliation and pending charges in `inspect`
- `src/conductor/test/cli/kickback-budget.test.ts` — pending charge, reconciliation and read-only tests

**Dependencies:** Task 1

### Task 4: Ledger readability and gate availability in child views follow each gate's owning ledger
**Story:** Story 1 (negative 1, 2, 3, 5), Story 2 (negative 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`:
   - **Unparseable flat ledger.** Use an unparseable flat ledger and a readable child-2 ledger. Assert inspect `--child 2` prints exactly `kickback-budget: ledger is unreadable.` and returns 1.
   - **Malformed flat gate.** Make only the flat `prd_audit` entry fail validation, for example a negative `laps`. Assert inspect `--child 2`:
     - prints `prd_audit: budget unavailable (durable entry failed validation)`;
     - still renders `architecture_review_as_built` and `build_review`;
     - returns 1;
     - in JSON form, lists `prd_audit` in `unavailableGates`.
   - **Malformed child gate.** Make only the child-2 `build_review` entry malformed. Assert inspect `--child 2`:
     - prints `build_review: budget unavailable (durable entry failed validation)`;
     - still renders `prd_audit` from the flat ledger values;
     - returns 1.
   - **Stale child copy.** Make only the child-2 `prd_audit` entry malformed, with a valid flat `prd_audit` entry. Assert inspect `--child 2` renders the flat `prd_audit` values and exits 0.
   - **Childless output.** On a feature with no child state, capture inspect human and JSON output from a fixed ledger. Assert both are byte-identical to the expected strings, which are pinned from the current renderer before the change.
2. Verify the new child-view tests fail (RED). After Task 1, an unparseable or malformed flat ledger is still not checked, and a malformed child copy of `prd_audit` still marks it unavailable. The childless test is a guard and must pass both before and after.
3. Implement in the `inspect` branch of `dispatchKickbackBudgetCommand`:
   - print the existing `kickback-budget: ledger is unreadable.` and return 1 when either the flat or the child ledger envelope is unreadable;
   - compute `unavailable` per gate as `unreadableKickbackGates(ledgerFor(gate)).includes(gate)`, so a feature-wide gate's availability comes from the flat ledger and a child-scoped gate's from the child ledger.
4. Verify the tests pass (GREEN).
5. Commit: "fix(kickback-budget): child views take gate availability from each gate's owning ledger"

**Done when:**
- [test] Inspect `--child 2` with an unparseable flat ledger and a readable child-2 ledger prints exactly `kickback-budget: ledger is unreadable.` and returns 1.
- [test] Inspect `--child 2` with only the flat `prd_audit` entry malformed prints `prd_audit: budget unavailable (durable entry failed validation)`, still renders `architecture_review_as_built` and `build_review`, returns 1, and its JSON form lists `prd_audit` in `unavailableGates`.
- [test] Inspect `--child 2` with only the child-2 `build_review` entry malformed prints `build_review: budget unavailable (durable entry failed validation)`, renders `prd_audit` from the flat ledger values, and returns 1.
- [test] Inspect `--child 2` with only the child-2 `prd_audit` entry malformed renders the flat ledger's `prd_audit` values and returns 0.
- [test] Inspect without `--child` on a feature with no child state prints human and JSON output byte-identical to the pinned pre-change strings.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — per-ledger readability and per-gate availability in `inspect`
- `src/conductor/test/cli/kickback-budget.test.ts` — unreadable and malformed ledger tests, childless byte-identity test

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬── Task 2
         ├── Task 3
         └── Task 4
```

## Integration Points

- After Task 1, the operator entry point `dispatchKickbackBudgetCommand` (the `kickback-budget
  inspect` CLI) reports feature-wide gates from the flat ledger in child views. Tasks 2–4 complete the
  growth, pending-charge, reconciliation and fail-closed behavior on the same entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the flat ledger has an `architecture_review_as_built` entry with 3 consumed laps, an effective lap cap of 4, one raise adjustment and a resume authorization bound to the live halt generation, and the child-2 ledger has an `architecture_review_as_built` entry with 0 laps and no adjustments, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `architecture_review_as_built` block prints `Kickback budget (architecture_review_as_built): 3/4 consumed; 1 remaining`, lists that raise's id in `Adjustment history:`, and prints `Resume authorization: awaiting daemon sweep`. | 1 | "prints `Kickback budget (architecture_review_as_built): 3/4 consumed; 1 remaining`, lists the flat raise id in `Adjustment history:`, and prints `Resume authorization: awaiting daemon sweep`" | diff-local |
| Story 1 happy: Given the flat ledger has a `prd_audit` entry with 5 laps, an effective lap cap of 5 and two raise adjustments, and the child-2 ledger has a `prd_audit` entry with count 0, when the operator runs `kickback-budget inspect --feature <slug> --child 2 --format json`, then the JSON keeps `"child": 2` and its `prd_audit` gate reports `consumed` 5, `limit` 5, `laps` 5, `lapCap` 5 and both adjustment ids. | 1 | "a `prd_audit` gate with `consumed` 5, `limit` 5, `laps` 5, `lapCap` 5 and both flat adjustment ids" | diff-local |
| Story 1 happy: Given the flat ledger records an effective plan-growth cap of 15, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then every gate block's `Plan growth:` line reports cap 15 as a `raised cap`, with the added count from the feature's growth accounting. | 2 | "prints, in every gate block, a `Plan growth:` line naming cap 15 with `(raised cap)` and the added count equal to `readPlanGrowthBudget(…, { persist: false })`'s `growth.added`" | diff-local |
| Story 1 happy: Given the flat ledger's pending repair charges 1 `prd_audit` lap, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `prd_audit` block prints `Pending charge: 1 lap (charged when build dispatches)` and its remaining count excludes that lap. | 3 | "prints `Pending charge: 1 lap (charged when build dispatches)` in the `prd_audit` block and a `remaining` of limit minus consumed minus 1" | diff-local |
| Story 1 happy: Given a `kickback-cap` halt written for child 2 on an exhausted `architecture_review_as_built` lap cap, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then that block's `Kickback budget (architecture_review_as_built):` line is identical to the corresponding line in the halt. | 1 | "prints a `Kickback budget (architecture_review_as_built):` line byte-identical to that HALT's line" | diff-local |
| Story 1 happy: Given that halt is live, when the operator runs `kickback-budget raise --feature <slug> --gate architecture_review_as_built --by 1 --rationale "<why>" --child 2` and then `kickback-budget inspect --feature <slug> --child 2`, then the inspected block shows the raised limit and lists the new adjustment's id. | 1 | "inspect `--child 2` shows the as-built block's raised limit and lists the new adjustment id" | diff-local |
| Story 1 happy: Given a feature whose execution child is 2 and whose flat ledger holds the `architecture_review_as_built` entry above, when the operator runs `kickback-budget inspect --feature <slug>` without `--child`, then the `architecture_review_as_built` block reports the same consumed count, limit and adjustment history as with `--child 2`. | 1 | "reports the flat ledger's as-built consumed count, limit and adjustment history, identical to the `--child 2` values" | diff-local |
| Story 1 happy: Given the flat ledger holds a staged `prd_audit` adjustment whose authorization event was recorded before an interrupted `raise`, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the adjustment is applied to the flat ledger exactly once and the `prd_audit` block shows its raised limit. | 3 | "shows the raised limit, leaves the flat entry with no `pendingAdjustment` and the adjustment listed once, and a second inspect leaves the flat ledger bytes unchanged" | diff-local |
| Story 1 negative: Given an unparseable flat ledger and a readable child-2 ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `kickback-budget: ledger is unreadable.` and exits 1. | 4 | "Inspect `--child 2` with an unparseable flat ledger and a readable child-2 ledger prints exactly `kickback-budget: ledger is unreadable.` and returns 1." | diff-local |
| Story 1 negative: Given the flat ledger's `prd_audit` entry fails validation while its other entries are valid, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `prd_audit: budget unavailable (durable entry failed validation)`, still renders the other gates, and exits 1, and the JSON form lists `prd_audit` in `unavailableGates`. | 4 | "prints `prd_audit: budget unavailable (durable entry failed validation)`, still renders `architecture_review_as_built` and `build_review`, returns 1, and its JSON form lists `prd_audit` in `unavailableGates`" | diff-local |
| Story 1 negative: Given the child-2 ledger's `prd_audit` entry fails validation while the flat ledger's `prd_audit` entry is valid, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `prd_audit` block renders the flat ledger's values and the command exits 0. | 4 | "Inspect `--child 2` with only the child-2 `prd_audit` entry malformed renders the flat ledger's `prd_audit` values and returns 0." | diff-local |
| Story 1 negative: Given neither ledger holds a pending adjustment, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the bytes of the flat ledger and the child-2 ledger are unchanged. | 3 | "Inspect `--child 2` with no pending adjustment in either ledger leaves the flat and child-2 ledger bytes unchanged." | diff-local |
| Story 1 negative: Given a feature with no child state, when the operator runs `kickback-budget inspect --feature <slug>` in human or JSON form, then its output is byte-identical to the output before this change. | 4 | "Inspect without `--child` on a feature with no child state prints human and JSON output byte-identical to the pinned pre-change strings." | diff-local |
| Story 2 happy: Given the child-2 ledger has a `build_review` entry with cumulative 4 and an effective limit of 6, and the flat ledger has a `build_review` entry with cumulative 1, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the `build_review` block prints `Kickback budget (build_review): 4/6 consumed; 2 remaining`. | 1 | "Inspect `--child 2` prints `Kickback budget (build_review): 4/6 consumed; 2 remaining` from the child-2 ledger while the flat `build_review` holds cumulative 1" | diff-local |
| Story 2 happy: Given child 2 is selected, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then a `restack` block is rendered from the child-2 ledger's `restack` entry as before this change. | 1 | "renders `restack` from the child-2 entry" | diff-local |
| Story 2 happy: Given a live `needs-human` `build_review` cap halt for child 2, when the operator runs `kickback-budget raise --feature <slug> --gate build_review --by 1 --rationale "<why>" --child 2`, then the adjustment is written to the child-2 ledger, the flat ledger's `build_review` entry is unchanged, and the printed `Plan growth:` line reports the flat ledger's plan-growth cap. | 2 | "writes `effectiveLimit` 6 to the child-2 ledger, leaves the flat ledger bytes unchanged, and prints a `Plan growth:` line naming cap 15" | diff-local |
| Story 2 negative: Given an unparseable child-2 ledger and a readable flat ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `kickback-budget: ledger is unreadable.` and exits 1. | 1 | "keeps exit 1 with `kickback-budget: ledger is unreadable.` for an unparseable child-2 ledger and the readable flat ledger" | diff-local |
| Story 2 negative: Given the child-2 ledger's `build_review` entry fails validation, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then it prints `build_review: budget unavailable (durable entry failed validation)`, still renders `prd_audit` from the flat ledger, and exits 1. | 4 | "prints `build_review: budget unavailable (durable entry failed validation)`, renders `prd_audit` from the flat ledger values, and returns 1" | diff-local |
| Story 2 negative: Given no `.pipeline/children/3/`, when the operator runs `kickback-budget inspect --feature <slug> --child 3`, then it prints `kickback-budget: child 3 has no child state.`, exits 1, and leaves the flat ledger's bytes unchanged. | 1 | "keeps exit 1 with `kickback-budget: child 3 has no child state.` and unchanged flat ledger bytes for `--child 3`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-4a: kickback-budget-cli.ts: build the unavailable list in ledger key order from unreadableKickbackGates over each owning ledger (flat ledger for whole-feature gates, child ledger otherwise), so a childless inspect is byte-identical to the pre-change `unreadableKickbackGates(ledger).filter(g => GATES.has(g))`
**Gate:** prd-audit
**Rationale:** Verified (95%) at src/conductor/src/engine/kickback-budget-cli.ts:196. The unavailable-gate list used to follow the ledger's JSON key order. The new code orders it by KICKBACK_BUDGET_GATES instead, so a childless inspect whose ledger has two or more malformed entries in a different key order prints different human and JSON output. That breaks task 4's done-when for byte-identical childless output. The pinned test only covers a healthy ledger, so it does not catch this. No architecture or product decision is involved: this is clear implementation and test drift inside approved task 4, so it routes to BUILD.
**Criterion:** S1.13
**Parent task:** 4
**Done when:**
- [test] S1.13 is satisfied by this task.
- The repair for task rem-prd-audit-4a is committed and its targeted tests pass.

### Task rem-prd-audit-4b: kickback-budget-cli test: pin childless inspect human and JSON output (unavailable lines and unavailableGates order) for a ledger with two or more malformed gate entries whose JSON key order differs from KICKBACK_BUDGET_GATES order, e.g. prd_audit before build_review; RED against the current code
**Gate:** prd-audit
**Rationale:** Verified (95%) at src/conductor/src/engine/kickback-budget-cli.ts:196. The unavailable-gate list used to follow the ledger's JSON key order. The new code orders it by KICKBACK_BUDGET_GATES instead, so a childless inspect whose ledger has two or more malformed entries in a different key order prints different human and JSON output. That breaks task 4's done-when for byte-identical childless output. The pinned test only covers a healthy ledger, so it does not catch this. No architecture or product decision is involved: this is clear implementation and test drift inside approved task 4, so it routes to BUILD.
**Criterion:** S1.13
**Parent task:** 4
**Done when:**
- [test] S1.13 is satisfied by this task.
- The repair for task rem-prd-audit-4b is committed and its targeted tests pass.
