# Implementation Plan: A routed round's BUILD cap halt states its real charge, names its work, and reports the enforced growth cap

**Date:** 2026-10-28
**Design:** .docs/track/routed-round-growth-halt-misreports-cap-overrun-as.md (technical track, no PRD)
**Stories:** .docs/stories/routed-round-growth-halt-misreports-cap-overrun-as.md
**Conflict check:** Not required (Tier S)

## Summary

The routed BUILD settlement reports the round it refused. The BUILD halt renders that round's pending
growth, minimum raise, findings, and tasks. A route record that cannot be read halts `needs-human`
naming the record. `kickback-budget inspect` and `daemon status` derive the growth cap from the
main checkout's config, as the dispatching engine does. Seven tasks.

## Technical Approach

- **Refused-round detail (settlement owns the figures).** In `src/conductor/src/engine/routing/round-receipt.ts`,
  the `exhausted` arm of `RoundSettlementResult` gains an optional `round: RefusedRoundDetail` with
  these fields:
  - `roundId`;
  - `findingIds`: the record's items' `findingId`s, in item order;
  - `remTaskIds`: every allocation host's `remTaskIds`, in ascending child-id order;
  - `existingTaskIds`: the `taskIds` of `existingTask` items, in item order;
  - `pendingAsBuiltFindings`: the record's `pendingAsBuiltFindings`, or `[]`;
  - `charges`: a `PendingRepair['charges']`-shaped map with one entry per gate in the receipt's
    laps, inserted in `WHOLE_FEATURE_BUDGET_GATES` order. Each entry's `laps` is that gate's lap
    charge. `growth` is `receiptCharges(record).growth` on the owner gate (the first charged gate in
    that order, as `applySettledReceiptToLedger` attributes it) and 0 on the others;
  - `settledAdded` and `growthCap`: the reconciled ledger's `growth.added` and
    `effectiveGrowthCap ?? budgets[0].growthCap`, which `nextLedgerForReceipt` evaluated.

  `nextLedgerForReceipt` attaches it to every `exhausted` it returns. Its admission arithmetic,
  halting-gate choice, and all-or-nothing write are unchanged.
- **Record read failures are not exhaustion.** `settleRoundAtDispatch`'s two read-failure branches
  return the existing `halted` arm instead of `{ exhausted, prd_audit, laps }`:
  - the current record reads as not `record`: reason `route record <roundId> is <absent|unreadable>`;
  - reconciliation reports `malformed` or `unreadable`: reason `route record <ref> is <kind>`.
    `reconcileReceiptLedgerUnlocked`'s non-`reconciled` result now carries the offending `ref`
    from `enumerateRouteReceiptRecords`.

  `readRoutedGrowthSnapshot`'s throw appends ` (<ref>)` to `route receipt <kind>` when a ref is
  known. Existing substring expectations on `route receipt unreadable` keep matching.
- **Halt builder** (`settleBuildPendingRepair` in `src/conductor/src/engine/conductor.ts`). When
  `settlement.kind === 'exhausted'` and `settlement.round` is present, the halt changes as follows.
  The flat path is left byte-identical.
  - `growthView` is built from `round.settledAdded` and `round.growthCap`, and the existing
    `withPendingGrowth` is passed `{ charges: round.charges }`.
  - The existing recovery-hint rule supplies `by: minimumRaise`.
  - Cap evidence records `consumed: round.settledAdded` and `limit: round.growthCap` for a growth
    halt.
  - `findings` becomes `Routed round <id> findings: <findingIds joined by ', '>`. It is also the
    cap evidence `latestReason`.
  - The second line is `Routed round <id> remediation tasks: <remTaskIds>` when `remTaskIds` is
    non-empty. Otherwise it is `Routed round <id> repairs existing tasks: <existingTaskIds>` when
    those are non-empty, and otherwise no line.
  - `asBuiltFindingDetail` renders `round.pendingAsBuiltFindings` with the existing format.

  When the execution source is `routed-host` and `settlementFailure` is set (a thrown error or a
  `halted` result), `findings` becomes `Pending remediation findings are unavailable:
  <settlementFailure>.`. The existing `needs-human` class, the `allowance unavailable (...)` detail,
  and the `«N»` placeholder are kept. The "repair record is malformed" sentence stays only on the
  non-routed failure path.
- **Cap source.** In `src/conductor/src/engine/kickback-budget-cli.ts`, `planGrowthViewFor`
  receives the main root that `runKickbackBudgetCommand` already resolves (`root`) and loads config
  from it. `defaultsFor` (lap allowances) is untouched. In `src/conductor/src/engine/daemon-observe-cli.ts`,
  the `readPlanGrowthBudget` call loads config from `repoPath`. The lap-budget rendering keeps the
  feature-root config. Both match the default child executor, which loads `loadConfig(projectRoot)`
  from the main checkout and hands it to the `Conductor`.

Local test patterns:
- `test/engine/routing/round-receipt.test.ts` builds real route refs in a temp git repo with
  `createRouteRecord`/`writeRouteRecord`, and calls `settleRoundAtDispatch` directly.
- `test/engine/conductor-kickback-transition.test.ts` (`runBuild(`) drives `Conductor.run()` through
  BUILD settlement and reads `.pipeline/HALT`.
- A routed-host execution target is established by injecting `childRegionLifecycle.resolveActiveChild`
  (the conductor's injectable seam) with a cursor whose repair marker names the round.
- `test/engine/kickback-budget-view.test.ts` drives inspect through the CLI entry.
- `test/engine/daemon-observe-cli.test.ts` asserts `PLAN GROWTH [` lines.

Search hints: `runBuild(`, `Pending growth:`, `routeRecordRefFor(`.

## Prerequisites

- None.

## Tasks

### Task 1: Settlement's exhausted result describes the refused round
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-receipt.test.ts` for every Done-when check below. Use real route refs: round `r8` with items `S1.1` and `S3.1`, and host-1 allocation `rem-prd-audit-6.r1` and `rem-prd-audit-6.r2`.
2. Verify RED.
3. Implement `RefusedRoundDetail` and attach it from `nextLedgerForReceipt` per the Technical Approach, reusing `receiptCharges` and the owner-gate rule of `applySettledReceiptToLedger`.
4. Verify GREEN with the existing round-receipt suites unchanged, and commit.

**Done when:**
- [test] `settleRoundAtDispatch` for `r8` with ledger growth added 13, `effectiveGrowthCap` 14, and a receipt charging `prd_audit` 1 lap and growth 2 returns `exhausted` with gate `prd_audit`, allowance `growth`, and `round` deep-equal to `{ roundId: 'r8', findingIds: ['S1.1', 'S3.1'], remTaskIds: ['rem-prd-audit-6.r1', 'rem-prd-audit-6.r2'], existingTaskIds: [], pendingAsBuiltFindings: [], charges: { prd_audit: { laps: 1, growth: 2 } }, settledAdded: 13, growthCap: 14 }`.
- [test] `round.remTaskIds` lists host 1's ids before host 2's for a two-host allocation, a receipt charging both gates 1 lap with growth 3 yields `round.charges` `{ prd_audit: { laps: 1, growth: 3 }, architecture_review_as_built: { laps: 1, growth: 0 } }`, and an existing-task item bound to `4, 7` with an empty allocation yields `existingTaskIds` `['4', '7']` and `remTaskIds` `[]`.
- [test] With ledger growth added 6, cap 10, an earlier round's settled receipt of growth 2 absent from the ledger, and a current receipt of growth 3, `settleRoundAtDispatch` returns `exhausted` with `round.settledAdded` 8 and `round.growthCap` 10.
- [test] After `effectiveGrowthCap` is raised from 14 to 15 (the old cap plus `settledAdded + growth − growthCap`), the next `settleRoundAtDispatch` for `r8` returns `settled`, the route record's receipt carries a settlement id, and the flat ledger records growth added 15 and `prd_audit` laps increased by exactly 1.
- [test] With settled growth 0, round growth 17, and `effectiveGrowthCap` 16 (one short of the stated minimum 7 applied to cap 10), `settleRoundAtDispatch` returns `exhausted` with `round.settledAdded` 0 and `round.growthCap` 16, the receipt has no settlement id, and the flat ledger JSON is byte-identical to before the call.

**Files likely touched:**
- src/conductor/src/engine/routing/round-receipt.ts
- src/conductor/test/engine/routing/round-receipt.test.ts

**Dependencies:** none

### Task 2: Route record read failures return halted naming the record
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-receipt.recovery.test.ts` and `src/conductor/test/engine/kickback-ledger.stacked-growth.test.ts` for every Done-when check below. Replace the `returns exhausted when reconciliation encounters a malformed stored route record` expectation.
2. Verify RED.
3. Implement the `halted` returns, the `ref` on `reconcileReceiptLedgerUnlocked`'s failure result, and the ref suffix in `readRoutedGrowthSnapshot`'s throw, per the Technical Approach.
4. Verify GREEN and commit.

**Done when:**
- [test] `settleRoundAtDispatch` returns `{ kind: 'halted', reason: 'route record r8 is absent' }` when ref `refs/conductor/demo/routes/r8` does not exist. It returns `{ kind: 'halted', reason: 'route record r8 is unreadable' }` when that ref holds `{not-json`. It never returns `exhausted` for either.
- [test] With sibling ref `refs/conductor/demo/routes/r2` holding `{not-json`, `settleRoundAtDispatch` for `r8` returns `halted` with a reason containing `refs/conductor/demo/routes/r2`. The flat ledger JSON is byte-identical to before the call, and `r8`'s receipt has no settlement id.
- [test] `readRoutedGrowthSnapshot` with ref `refs/conductor/demo/routes/r8` holding `{not-json` throws an error whose message contains both `route receipt unreadable` and `refs/conductor/demo/routes/r8`. The existing `routed sealed growth denominator is unreadable: route receipt unreadable` expectation in `kickback-ledger.stacked-growth.test.ts` passes unchanged.

**Files likely touched:**
- src/conductor/src/engine/routing/round-receipt.ts
- src/conductor/test/engine/routing/round-receipt.recovery.test.ts
- src/conductor/test/engine/kickback-ledger.stacked-growth.test.ts

**Dependencies:** none

### Task 3: Routed cap halt renders the round's pending growth and minimum raise
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts` for every Done-when check below. Drive `Conductor.run()` with a routed-host execution target established through the injected `childRegionLifecycle.resolveActiveChild` and real route refs in a temp git repo. Read `.pipeline/HALT`, `.pipeline/HALT.class`, the flat kickback ledger, and the route ref.
2. Verify RED.
3. Implement the `growthView`, recovery-hint `by`, and growth cap-evidence changes for an `exhausted` result carrying `round` in `settleBuildPendingRepair` (`src/conductor/src/engine/conductor.ts`), per the Technical Approach.
4. Verify GREEN and commit.

**Done when:**
- [test] For the `r8` fixture (settled 13, `effectiveGrowthCap` 14, receipt `prd_audit` 1 lap and growth 2), `Conductor.run()` dispatches no BUILD and writes a HALT. Its first line is `BUILD dispatch halted: prd_audit growth allowance exhausted.`. It contains `Plan growth: 13/14 added; 0 remaining (raised cap)` and, on the next line, `Pending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1`. It has a recovery line containing `kickback-budget raise --feature <slug> --gate prd_audit --by 1`, and `HALT.class` is `kickback-cap`.
- [test] The as-built fixture (settled 0, config-derived cap 3, receipt `architecture_review_as_built` 1 lap and growth 4) writes `Plan growth: 0/3 added; 0 remaining (config-derived cap)`, `Pending growth: 4 (architecture_review_as_built 4); would reach 4/3 when build dispatches; minimum raise 1`, and a recovery line containing `kickback-budget raise --feature <slug> --gate architecture_review_as_built --by 1`. The joined fixture (settled 6, cap 8, both gates 1 lap, growth 3) writes `Pending growth: 3 (prd_audit 3); would reach 9/8 when build dispatches; minimum raise 1`.
- [test] The reconciliation fixture (ledger added 6, unrecorded earlier receipt of growth 2, cap 10, round growth 3) writes `Plan growth: 8/10 added; 0 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 11/10 when build dispatches; minimum raise 1`, and the gate's cap evidence records `consumed` 8 and `limit` 10.
- [test] A routed `prd_audit` lap exhaustion with round growth 1 under the cap writes a HALT naming the `laps` allowance. Its `Pending growth: 1 (prd_audit 1)` line ends with `when build dispatches` and has no `minimum raise` segment, its recovery line contains `--by «N»`, and `HALT.class` is `kickback-cap`. A lap exhaustion with growth 0 and an empty allocation writes no `Pending growth:` line, and its `Plan growth:` line is identical to the no-pending rendering of the same ledger.
- [test] After the `r8` halt, setting the flat ledger's `effectiveGrowthCap` to 15 makes the next `Conductor.run()` dispatch BUILD once and write no HALT. The route receipt then carries a settlement id, and the ledger records growth added 15 and `prd_audit` laps increased by 1. Re-running with no raise instead halts with `minimum raise 1`, leaves an unsettled receipt, and leaves ledger growth and laps unchanged. Settled 0, growth 17, and cap 16 writes `Plan growth: 0/16 added; 0 remaining (raised cap)` with `minimum raise 1` and charges nothing.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts

**Dependencies:** Task 1

### Task 4: Routed cap halt names the round, its findings, and its tasks
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts` for every Done-when check below, reusing Task 3's fixtures.
2. Verify RED.
3. Implement the routed `findings`, task line, `latestReason`, and `Blocking findings:` rendering in `settleBuildPendingRepair` (`src/conductor/src/engine/conductor.ts`), per the Technical Approach.
4. Verify GREEN with `test/engine/conductor-kickback-transition.test.ts` unchanged, and commit.

**Done when:**
- [test] The `r8` HALT contains the line `Routed round r8 findings: S1.1, S3.1` immediately followed by the line `Routed round r8 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2`. It contains no `repair record is malformed` text, and the `prd_audit` cap evidence's `latestReason` is `Routed round r8 findings: S1.1, S3.1`.
- [test] The two-host as-built `r1` HALT contains `Routed round r1 remediation tasks: rem-ab-1.r1, rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4`. It also contains a `Blocking findings:` block with `AB-1 (REMEDIABLE; adr-x D2): drift`, rendered from `round.pendingAsBuiltFindings`.
- [test] The existing-task `r3` lap HALT contains `Routed round r3 findings: S2.1` and `Routed round r3 repairs existing tasks: 4, 7`. It contains no `remediation tasks` line and no `repair record is malformed` text.
- [test] Every pre-existing test in `test/engine/conductor-kickback-transition.test.ts` passes without modification. The flat growth halt it renders, whose `Findings (<gate>):`, `Also pending`, and `Pending remediation tasks:` lines those tests assert byte-for-byte, contains no `Routed round` line.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts

**Dependencies:** Task 1, Task 3

### Task 5: Routed settlement failures halt needs-human with their reason
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts` for every Done-when check below. Use a real `{not-json` ref for the first check. Its reason comes from the plan-growth budget read (`pendingRepairSettlementBudgets` → `readRoutedGrowthSnapshot`, Task 2's ref suffix), which runs before `settleRoundAtDispatch`. For the others, use a `settleRoundAtDispatch` override that defaults to the real implementation through `importOriginal` (as `conductor-routed-taskless-admission.test.ts` mocks its seams) and returns `halted` only in those tests, so Tasks 3 and 4's real-settlement fixtures in the same file are unaffected.
2. Verify RED.
3. Implement the routed-host `Pending remediation findings are unavailable: <reason>.` line in `settleBuildPendingRepair` (`src/conductor/src/engine/conductor.ts`), and keep the non-routed sentence.
4. Verify GREEN and commit.

**Done when:**
- [test] `Conductor.run()` for a routed feature whose `refs/conductor/<slug>/routes/r8` holds `{not-json` dispatches no BUILD and writes `HALT.class` `needs-human`. Its HALT contains a line starting `Pending remediation findings are unavailable: ` that contains `refs/conductor/<slug>/routes/r8`. It has no `Pending growth:` line, and its recovery line contains `--by «N»`.
- [test] With `settleRoundAtDispatch` returning `halted` with reason `route record r8 is unreadable`, the HALT has class `needs-human` and contains `Pending remediation findings are unavailable: route record r8 is unreadable.`. With reason `route record r8 is absent`, the HALT has class `needs-human` and contains `Pending remediation findings are unavailable: route record r8 is absent.`.
- [test] With `settleRoundAtDispatch` returning `halted` with reason `routing round r8 has an open restack journal`, the HALT has class `needs-human`, contains `Pending remediation findings are unavailable: routing round r8 has an open restack journal.`, and contains no `malformed` text.
- [test] The pre-existing `fails closed before BUILD for a malformed pending repair` test in `test/engine/conductor-kickback-transition.test.ts` passes unchanged, still asserting `Pending remediation findings are unavailable because the repair record is malformed.`, the `needs-human` class, and `«N»` for a non-routed feature.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts

**Dependencies:** Task 2, Task 4

### Task 6: kickback-budget inspect derives the growth cap from the main checkout's config
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-view.test.ts` for every Done-when check below. Use a real git repo with a linked worktree at `.worktrees/<slug>`, different `.ai-conductor/config.yml` files in the main checkout and the worktree, a sealed authored count of 20, and settled growth 6.
2. Verify RED.
3. Implement: pass the resolved main `root` into `planGrowthViewFor` in `src/conductor/src/engine/kickback-budget-cli.ts` and load its config with `loadConfig(root)`. Leave `defaultsFor` unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `kickback-budget inspect --feature <slug>`, with the main checkout config at `prd_audit.max_appended_tasks: 8` and `max_appended_ratio: 0.8` and the worktree config at `max_appended_tasks: 10`, prints `Plan growth: 6/8 added; 2 remaining (config-derived cap)` for each remediation gate. `--format json` reports `planGrowth.cap` 8.
- [test] With the flat ledger's `effectiveGrowthCap` at 9, inspect prints `Plan growth: 6/9 added; 3 remaining (raised cap)` regardless of either config. With no main-checkout config file and the worktree config at 10, inspect reports cap 5, equal to `prdAuditAppendCap({}, 20)`, which a conductor constructed with no project config enforces.
- [test] For the diverging-config fixture, the cap in inspect's `Plan growth:` line equals the cap in the `Plan growth:` line of a BUILD halt written by a `Conductor` constructed with `loadConfig(<main checkout>)`'s config.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts
- src/conductor/test/engine/kickback-budget-view.test.ts

**Dependencies:** none

### Task 7: daemon status derives the growth cap from the main checkout's config
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` for every Done-when check below, with Task 6's diverging-config fixture.
2. Verify RED.
3. Implement: in `src/conductor/src/engine/daemon-observe-cli.ts`, load the config passed to `readPlanGrowthBudget` with `loadConfig(repoPath)`. The lap-budget rendering keeps its feature-root config.
4. Verify GREEN and commit.

**Done when:**
- [test] `daemon status`, with the main checkout config at `max_appended_tasks: 8` and the feature worktree config at 10, prints a `PLAN GROWTH [<slug>` line containing `remaining 2/8`, because the growth budget is read with the main checkout's loaded config.
- [test] With the flat ledger's `effectiveGrowthCap` at 9, the same line contains `remaining 3/9`. Every pre-existing test in `test/engine/daemon-observe-cli.test.ts` passes without modification.

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts
- src/conductor/test/engine/daemon-observe-cli.test.ts

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──▶ Task 3 ──▶ Task 4 ──▶ Task 5
Task 2 ─────────────────────────▶ Task 5
Task 6 (independent)
Task 7 (independent)
```

## Integration Points

- After Task 3: a routed growth halt is recoverable from its own text.
- After Task 5: every routed BUILD settlement halt is either a sized cap halt or a `needs-human` halt naming its record.
- After Tasks 6 and 7: the halt, inspect, and daemon status agree on the growth cap.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a routed feature for round `r8` with settled growth 13, a raised growth cap of 14, and a receipt charging `prd_audit` 1 lap and growth 2, when BUILD dispatch settlement halts, then the HALT's first line is `BUILD dispatch halted: prd_audit growth allowance exhausted.`, it contains `Plan growth: 13/14 added; 0 remaining (raised cap)` followed on the next line by `Pending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1`, its recovery line contains `kickback-budget raise --feature <slug> --gate prd_audit --by 1`, and `.pipeline/HALT.class` is `kickback-cap`. | 3 | "`Pending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1`" | diff-local |
| Story 1 happy: Given a routed feature for round `r1` with settled growth 0, a config-derived growth cap of 3, and a receipt charging `architecture_review_as_built` 1 lap and growth 4, when settlement halts, then the HALT contains `Plan growth: 0/3 added; 0 remaining (config-derived cap)` and `Pending growth: 4 (architecture_review_as_built 4); would reach 4/3 when build dispatches; minimum raise 1`, and the recovery line names `--gate architecture_review_as_built --by 1`. | 3 | "`Pending growth: 4 (architecture_review_as_built 4); would reach 4/3 when build dispatches; minimum raise 1`" | diff-local |
| Story 1 happy: Given a routed round whose receipt charges both `prd_audit` and `architecture_review_as_built` 1 lap each and growth 3, with settled growth 6 and a config-derived cap of 8, when settlement halts, then the HALT contains `Pending growth: 3 (prd_audit 3); would reach 9/8 when build dispatches; minimum raise 1`, attributing the single growth charge to `prd_audit` as the ledger does. | 1, 3 | "`Pending growth: 3 (prd_audit 3); would reach 9/8 when build dispatches; minimum raise 1`" | diff-local |
| Story 1 negative: Given a routed feature whose flat ledger records settled growth 6 while an earlier round `r4` holds a settled receipt of growth 2 that the ledger has not yet recorded, a config-derived cap of 10, and a current round whose receipt charges `prd_audit` 1 lap and growth 3, when settlement reconciles `r4` and then refuses the current round, then the HALT contains `Plan growth: 8/10 added; 0 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 11/10 when build dispatches; minimum raise 1`, and the cap evidence records consumed 8 and limit 10. | 1, 3 | "the gate's cap evidence records `consumed` 8 and `limit` 10" | diff-local |
| Story 1 negative: Given a routed round refused because the `prd_audit` lap allowance is exhausted while its growth charge of 1 fits under the cap, when settlement halts, then the HALT names the `laps` allowance, its `Pending growth: 1 (prd_audit 1)` line ends with `when build dispatches` and has no `minimum raise` segment, the recovery line keeps the `--by «N»` placeholder, and `HALT.class` is `kickback-cap`. | 3 | "has no `minimum raise` segment, its recovery line contains `--by «N»`, and `HALT.class` is `kickback-cap`" | diff-local |
| Story 1 negative: Given a routed round whose receipt declares growth 0 and whose allocation is empty, when it is refused on laps, then the HALT carries no `Pending growth:` line and its `Plan growth:` line is identical to the one rendered for the same ledger with no pending charge. | 3 | "A lap exhaustion with growth 0 and an empty allocation writes no `Pending growth:` line" | diff-local |
| Story 2 happy: Given the `r8` halt stating `minimum raise 1` with settled growth 13 and cap 14, when the operator raises the growth allowance by 1, so the flat ledger's effective growth cap is 15, and BUILD dispatches again, then settlement returns `settled`, the route record's receipt gains a settlement id, the flat ledger records growth added 15 and `prd_audit` laps increased by 1, no HALT is written, and the BUILD step is dispatched. | 1, 3 | "makes the next `Conductor.run()` dispatch BUILD once and write no HALT" | diff-local |
| Story 2 negative: Given the same halt and no raise, when BUILD dispatches again, then settlement halts again stating `minimum raise 1`, the route record's receipt still has no settlement id, and the flat ledger's growth and gate laps are unchanged. | 1, 3 | "Re-running with no raise instead halts with `minimum raise 1`, leaves an unsettled receipt" | diff-local |
| Story 2 negative: Given a routed halt stating `minimum raise 7` for settled growth 0, cap 10, and round growth 17, when the operator raises the growth allowance by 6, so the effective growth cap is 16, and BUILD dispatches again, then settlement halts again with `Plan growth: 0/16 added; 0 remaining (raised cap)` and `minimum raise 1`, and charges nothing. | 1, 3 | "Settled 0, growth 17, and cap 16 writes `Plan growth: 0/16 added; 0 remaining (raised cap)` with `minimum raise 1` and charges nothing" | diff-local |
| Story 3 happy: Given the `r8` routed fixture whose items carry finding ids `S1.1` and `S3.1` and whose allocation gives host 1 tasks `rem-prd-audit-6.r1` and `rem-prd-audit-6.r2`, when settlement halts, then the HALT contains the line `Routed round r8 findings: S1.1, S3.1` followed by the line `Routed round r8 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2`, and contains no `repair record is malformed` text. | 4 | "immediately followed by the line `Routed round r8 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2`" | diff-local |
| Story 3 happy: Given a routed round `r1` whose allocation gives host 1 task `rem-ab-1.r1` and host 2 tasks `rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4`, and whose record carries pending as-built finding `AB-1` (class `REMEDIABLE`, governing clause `adr-x D2`, summary `drift`), when settlement halts on `architecture_review_as_built`, then the HALT contains `Routed round r1 remediation tasks: rem-ab-1.r1, rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4` in host order and a `Blocking findings:` block containing `AB-1 (REMEDIABLE; adr-x D2): drift`. | 4 | "`AB-1 (REMEDIABLE; adr-x D2): drift`, rendered from `round.pendingAsBuiltFindings`" | diff-local |
| Story 3 happy: Given the `r8` halt, when its cap evidence is recorded, then the evidence's latest reason is `Routed round r8 findings: S1.1, S3.1` and contains no `repair record is malformed` text. | 4 | "the `prd_audit` cap evidence's `latestReason` is `Routed round r8 findings: S1.1, S3.1`" | diff-local |
| Story 3 negative: Given a routed round `r3` refused on laps whose only item is an existing-task repair bound to tasks `4` and `7` under finding id `S2.1`, with an empty allocation, when settlement halts, then the HALT contains `Routed round r3 findings: S2.1` and `Routed round r3 repairs existing tasks: 4, 7`, prints no `remediation tasks` line, and contains no `repair record is malformed` text. | 4 | "`Routed round r3 repairs existing tasks: 4, 7`" | diff-local |
| Story 3 negative: Given a flat (non-routed) pending repair that is refused on growth, when settlement halts, then the HALT's `Findings (<gate>):`, `Also pending`, and `Pending remediation tasks:` lines are byte-identical to their rendering before this change and no `Routed round` line appears. | 4 | "contains no `Routed round` line" | diff-local |
| Story 4 happy: Given a routed feature whose ref `refs/conductor/<slug>/routes/r8` holds content that does not parse as a route record, when BUILD dispatch settlement runs, then the BUILD step is not dispatched, `.pipeline/HALT.class` is `needs-human`, the HALT contains `Pending remediation findings are unavailable: ` followed by a reason that names `refs/conductor/<slug>/routes/r8`, it has no `Pending growth:` line, and its recovery line keeps `--by «N»`. | 5 | "Its HALT contains a line starting `Pending remediation findings are unavailable: ` that contains `refs/conductor/<slug>/routes/r8`" | diff-local |
| Story 4 happy: Given the dispatching round's route record reads as absent or unreadable when `settleRoundAtDispatch` reads it under the ledger lease, when settlement runs, then it returns `halted` with the reason `route record r8 is absent` or `route record r8 is unreadable` rather than `exhausted`, and the conductor's HALT has class `needs-human` and contains that reason. | 2, 5 | "It never returns `exhausted` for either" | diff-local |
| Story 4 happy: Given another round's route ref `r2` is malformed when `settleRoundAtDispatch` reconciles receipts, when settlement runs for `r8`, then it returns `halted` with a reason naming `refs/conductor/<slug>/routes/r2`, charges nothing, and leaves `r8`'s receipt unsettled. | 2 | "returns `halted` with a reason containing `refs/conductor/demo/routes/r2`" | diff-local |
| Story 4 negative: Given a routed round whose settlement halts because the round has an open restack journal, when the HALT is written, then it has class `needs-human`, contains `Pending remediation findings are unavailable: routing round r8 has an open restack journal.`, and contains no `malformed` text. | 5 | "contains `Pending remediation findings are unavailable: routing round r8 has an open restack journal.`, and contains no `malformed` text" | diff-local |
| Story 4 negative: Given a non-routed feature whose flat pending repair is malformed, when settlement fails closed, then the HALT keeps `Pending remediation findings are unavailable because the repair record is malformed.`, the `needs-human` class, and the `«N»` placeholder, exactly as before this change. | 5 | "still asserting `Pending remediation findings are unavailable because the repair record is malformed.`, the `needs-human` class, and `«N»` for a non-routed feature" | diff-local |
| Story 5 happy: Given a main checkout whose project config sets `prd_audit.max_appended_tasks: 8` and `max_appended_ratio: 0.8`, a linked feature worktree whose checked-out config sets `max_appended_tasks: 10`, a sealed authored count of 20, settled growth 6, and no raised cap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then each remediation gate's human output contains `Plan growth: 6/8 added; 2 remaining (config-derived cap)` and the `--format json` output's `planGrowth.cap` is 8. | 6 | "`--format json` reports `planGrowth.cap` 8" | diff-local |
| Story 5 happy: Given the same feature, when the operator runs `ai-conductor daemon status`, then its `PLAN GROWTH [<slug>...]` line contains `remaining 2/8`. | 7 | "prints a `PLAN GROWTH [<slug>` line containing `remaining 2/8`" | diff-local |
| Story 5 happy: Given the same feature and a BUILD halt produced for it by a conductor whose config is the main checkout's, when inspect runs, then the cap in inspect's `Plan growth:` line equals the cap in the halt's `Plan growth:` line. | 6 | "the cap in inspect's `Plan growth:` line equals the cap in the `Plan growth:` line of a BUILD halt" | diff-local |
| Story 5 negative: Given the same feature with a raised growth cap of 9 in its flat ledger, when inspect and daemon status render, then both report cap 9 with `(raised cap)` on inspect, whichever config either checkout carries. | 6, 7 | "inspect prints `Plan growth: 6/9 added; 3 remaining (raised cap)` regardless of either config" | diff-local |
| Story 5 negative: Given a main checkout with no project config file while the feature worktree's config sets `max_appended_tasks: 10`, when inspect renders for an authored count of 20, then it reports the default-derived cap of 5, which is what a conductor started with no project config enforces, not 10. | 6 | "With no main-checkout config file and the worktree config at 10, inspect reports cap 5" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-R1: In src/conductor/src/engine/routing/round-receipt.ts nextLedgerForReceipt, record lap-exhaustion capEvidence.consumed from the settled ledger (ledger.gates[gate]?.laps ?? 0) rather than the projected `next` entry, for both the missing-budget and lap-cap-exceeded branches. Keep the projected value only as the cap comparison. Add a RED-first test in src/conductor/test/engine/routing/round-receipt.test.ts: with 2 settled laps, a lap cap of 2, and a receipt charging 1 lap, the result is exhausted with capEvidence.consumed 2, the flat ledger stays byte-identical, and a raise/reset recovery against that evidence is accepted by kickback-ledger's evidence-match check.
**Gate:** as-built
**Rationale:** Confirmed (99%, verified): in round-receipt.ts nextLedgerForReceipt, the lap-exhaustion branch calls exhausted(gate, 'laps', entry.laps ?? 0, lapCap), and the missing-budget branch calls it with next.gates[gate]?.laps. Both values come from the projected ledger `next`, which already includes the refused round's lap charge. The refusal returns the unchanged `ledger`, so capEvidence.consumed ends up one lap higher than the settled count. kickback-ledger.ts recovery requires evidence.consumed === entry.laps, so ordinary raise/reset recovery fails. ADR-2026-08-29 D2 stays authoritative and needs no new decision. This is clear conforming implementation drift. Approved Task 1 (Settlement's exhausted result describes the refused round; files round-receipt.ts and round-receipt.test.ts) covers the repair. The growth branch already uses settled round.settledAdded, so only the laps branches change. Siblings were checked: conductor.ts:10467–10475 just persists the evidence and is fixed once the source is fixed, so it needs no separate change.
**Governing clause:** adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class decision 2
**Done when:**
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class decision 2 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.
