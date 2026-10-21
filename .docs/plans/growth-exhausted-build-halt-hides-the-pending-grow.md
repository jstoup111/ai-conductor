# Implementation Plan: Growth-exhausted BUILD halt shows the pending growth charge and the halting gate's findings

**Date:** 2026-10-21
**Design:** .docs/track/growth-exhausted-build-halt-hides-the-pending-grow.md (technical track, no PRD)
**Stories:** .docs/stories/growth-exhausted-build-halt-hides-the-pending-grow.md
**Conflict check:** Not required (Tier S)

## Summary

One pure pending-growth projection over the flat `pendingRepair.charges`, used by BUILD settlement's
growth refusal and rendered by the BUILD halt, `kickback-budget inspect`, and `daemon status`; the
halt's findings line selects by halting gate. Seven tasks.

## Technical Approach

- **Projection (single source of truth).** Add `projectPendingGrowth(added, charges, cap)` to
  `src/conductor/src/engine/kickback-ledger.ts`. It walks the pending charges in their stored entry
  order (the same order `settlePendingRepair` iterates) and returns
  `{ total, byGate, projected, minimumRaise, exceedingGate }`: `total` is the sum of charge growth,
  `byGate` lists only gates whose growth is greater than 0 in charge order, `projected` is
  `added + total`, `minimumRaise` is `max(0, projected - cap)` (absent when `cap` is `null`), and
  `exceedingGate` is the first gate, in charge order, at which `added` plus the cumulative growth so
  far exceeds the cap (so a growth-0 charge still exceeds when settled growth is already over the
  cap). It returns `undefined` only when there is no pending repair. Display surfaces treat
  `total === 0` as "no pending growth" — the "unchanged" signal for every surface.
- **Settlement.** `settlePendingRepair` keeps its loop and per-gate lap check order, but replaces the
  inline `nextGrowth.added + charge.growth > cap` with "this gate is the projection's
  `exceedingGate`", computed once from the same projection. All-or-nothing, charge order, halting
  gate, and the `plan_growth` event are unchanged (architecture-review-2026-09-29 condition 1).
- **View.** `KickbackPlanGrowthView` gains an optional `pendingGrowth` of exactly
  `{ total, byGate, projected, minimumRaise }` (internal `exceedingGate` is not exposed). A helper
  `withPendingGrowth(view, pendingRepair)` in `kickback-budget-view.ts` attaches it and mirrors the
  laps precedent: `remaining = max(0, cap - added - total)`. `renderKickbackBudgetView` prints,
  directly after the `Plan growth:` line, `Pending growth: <total> (<gate> <n>, ...); would reach
  <projected>/<cap> when build dispatches` plus `; minimum raise <k>` only when `k > 0`; with a `null`
  cap it prints `Pending growth: <total> (<gate> <n>, ...)` only. `renderKickbackRecoveryHint` takes an
  optional `by` number that replaces `«N»`.
- **Halt builder** (`conductor.ts` `settleBuildPendingRepair`). Attach pending growth to `growthView`;
  pass `by: minimumRaise` to the recovery hint only for a `growth` exhaustion with a readable ledger
  and `minimumRaise > 0`. Findings: the halting gate's findings come first as
  `Findings (<gate>): ...` (as-built: `pendingAsBuiltRemediationFindings[].finding`; prd_audit:
  `prdAuditCriteria`), falling back to `Pending remediation tasks: ...` when that gate has none; the
  other gate's findings, if any, follow as `Also pending (<gate>): ...`. The malformed-record
  sentence, `Blocking findings:` detail, and the refusal-rework halt (`writeRefusalReworkAllowanceHalt`)
  are unchanged.
- **Surfaces.** `kickback-budget-cli.ts` `planGrowthViewFor` wraps both its feature and child paths
  with `withPendingGrowth`. `daemon-observe-cli.ts` appends `; pending <total> (<gate> <n>, ...)` plus
  `, minimum raise <k>` when `k > 0` to its `PLAN GROWTH` summary, with `remaining` reduced by the
  pending total, using the same projection. Routed-host receipts are never read, so they render
  unchanged.

Local test pattern: `test/engine/conductor-kickback-transition.test.ts`'s `runBuild(pendingRepair,
ledger)` drives a real `Conductor.run()` through BUILD settlement and reads `.pipeline/HALT`;
`test/engine/kickback-budget-view.test.ts` drives inspect through the CLI entry and asserts both
human and `--format json`; `test/engine/daemon-observe-cli.test.ts` asserts `PLAN GROWTH` lines.
Search hints: `runBuild(`, `Pending charge`, `PLAN GROWTH [`.

## Prerequisites

- None.

## Tasks

### Task 1: Pure pending-growth projection
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `test/engine/kickback-ledger.test.ts` for `projectPendingGrowth`: (a) added 0, charges `prd_audit` 3 then `architecture_review_as_built` 8, cap 10 → total 11, byGate `{ prd_audit: 3, architecture_review_as_built: 8 }`, projected 11, minimumRaise 1, exceedingGate `architecture_review_as_built`; (b) added 9, charges 3 and 2, cap 13 → projected 14, minimumRaise 1; (c) added 10, `prd_audit` 2, cap 10 → minimumRaise 2, exceedingGate `prd_audit`; (d) added 2, `prd_audit` 3, cap 10 → minimumRaise 0, no exceedingGate; (e) laps-only charges (growth 0) with added 2, cap 10 → total 0, byGate `{}`, no exceedingGate; (e2) laps-only `prd_audit` charge with added 11, cap 10 → total 0, exceedingGate `prd_audit`; (f) no pending repair → `undefined`; (g) cap `null` → total and byGate present, no minimumRaise.
2. Verify RED.
3. Implement `projectPendingGrowth` in `src/conductor/src/engine/kickback-ledger.ts` per the Technical Approach (walk charges in stored entry order, omit growth-0 gates from `byGate`).
4. Verify GREEN and commit.

**Done when:**
- [test] `projectPendingGrowth` returns total 11, byGate `{ prd_audit: 3, architecture_review_as_built: 8 }`, projected 11, minimumRaise 1, and exceedingGate `architecture_review_as_built` for added 0 against cap 10, as asserted by the two-gate projection test.
- [test] `projectPendingGrowth` returns minimumRaise 1 for added 9 with charges 3 and 2 against cap 13, minimumRaise 2 with exceedingGate `prd_audit` for added 10 with `prd_audit` 2 against cap 10, and minimumRaise 0 with no exceedingGate for added 2 with `prd_audit` 3 against cap 10.
- [test] `projectPendingGrowth` returns total 0 with byGate `{}` for laps-only charges under the cap, returns exceedingGate `prd_audit` for a laps-only `prd_audit` charge when added 11 exceeds cap 10, returns `undefined` for an absent pending repair, and returns no minimumRaise when the cap is `null`.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** none

### Task 2: Settlement's growth refusal reads the projection
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Write failing tests in `test/engine/kickback-ledger.test.ts` against `settlePendingRepair`: (a) growth added 0, budgets `growthCap` 11 (the stated minimum raise of 1 applied to cap 10), charges `prd_audit` {laps 1, growth 3} and `architecture_review_as_built` {laps 1, growth 8} → result `settled`, ledger growth added 11 with byGate 3 and 8, both gates' laps incremented, `pendingRepair` cleared; (b) growth added 0, cap 10 → `exhausted` on `architecture_review_as_built` growth, ledger byte-identical to before; (c) pending growth 12 over cap 10, budgets growthCap 11 (one short of the stated minimum 2) → `exhausted`, `projectPendingGrowth` on the unchanged ledger yields minimumRaise 1, and the pending repair JSON is byte-identical; (d) laps-only `prd_audit` charge {laps 1, growth 0} with growth added 11 against cap 10 → `exhausted` on `prd_audit` with `allowance: 'growth'`, exactly as the pre-change inline check returns.
2. Verify RED where the new assertions exercise the projection seam.
3. Implement: in `settlePendingRepair`, compute `projectPendingGrowth(initialGrowth.added, pendingRepair.charges, cap)` once and replace the inline `nextGrowth.added + charge.growth > cap` check with `projection?.exceedingGate === gate`; keep the per-gate lap check before it, the charge order, and the single write.
4. Verify GREEN with the existing `settlePendingRepair` tests unchanged, and commit.

**Done when:**
- [test] `settlePendingRepair` with growthCap raised to 11 for pending growth 11 returns `settled`, records growth added 11 with byGate `prd_audit` 3 and `architecture_review_as_built` 8, moves each gate's laps from 0 to exactly 1 (its charged `laps`, the same increment the pre-change settlement applies), clears `pendingRepair`, and emits exactly one `plan_growth` event through `options.events` whose payload equals the payload the pre-change settlement emits for the same fixture (added 11, byGate `prd_audit` 3 and `architecture_review_as_built` 8), as asserted by the raise-by-minimum test.
- [test] `settlePendingRepair` with growthCap 11 for pending growth 12 returns `exhausted`, leaves the pending repair JSON byte-identical, and `projectPendingGrowth` over that ledger returns minimumRaise 1, as asserted by the one-short test.
- [test] `settlePendingRepair` whose first gate fits and whose second pushes cumulative growth over the cap returns `exhausted` naming the second gate with `allowance: 'growth'` and charges neither gate's laps or growth.
- [test] `settlePendingRepair` with a laps-only `prd_audit` charge and settled growth 11 over cap 10 returns `exhausted` on `prd_audit` with `allowance: 'growth'` and charges nothing, preserving the pre-change behavior.
- [test] Every pre-existing `settlePendingRepair` test in `test/engine/kickback-ledger.test.ts` passes without modification.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** Task 1

### Task 3: Budget view renders pending growth and a concrete recovery raise
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/kickback-budget-view.test.ts`: (a) `renderKickbackBudgetView` with a plan growth view `{ authored 40, added 0, cap 10, config-derived }` passed through `withPendingGrowth` for charges 3 and 8 renders `Plan growth: 0/10 added; 0 remaining (config-derived cap)` immediately followed by `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`; (b) the same for added 2, `prd_audit` 3, cap 10 renders `Plan growth: 2/10 added; 5 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches` with no `minimum raise`; (c) laps-only charges render output identical to the view with no pending repair and no `pendingGrowth` key; (d) `renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'architecture_review_as_built', allowance: 'growth', by: 1 })` returns the exact command with `--by 1`, and without `by` keeps `«N»`.
2. Verify RED.
3. Implement `pendingGrowth` on `KickbackPlanGrowthView` carrying exactly `{ total, byGate, projected, minimumRaise }` (never `exceedingGate`), `withPendingGrowth(view, pendingRepair)` using `projectPendingGrowth` and attaching nothing when the projection is `undefined` or its total is 0, the `Pending growth:` line in `renderKickbackBudgetView`, and the optional `by` in `renderKickbackRecoveryHint`, all in `src/conductor/src/engine/kickback-budget-view.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `renderKickbackBudgetView` over `withPendingGrowth` for added 0, cap 10, charges 3 and 8 emits `Plan growth: 0/10 added; 0 remaining (config-derived cap)` followed on the next line by `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`.
- [test] `renderKickbackBudgetView` for added 2, cap 10, `prd_audit` 3 emits `5 remaining` and a `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches` line containing no `minimum raise` segment.
- [test] `withPendingGrowth` for the two-gate fixture attaches a `pendingGrowth` whose keys are exactly `total`, `byGate`, `projected`, and `minimumRaise`; with laps-only charges it returns a view with no `pendingGrowth` key whose rendering is identical to the rendering with no pending repair, with no `Pending growth:` line.
- [test] `renderKickbackRecoveryHint` with `by: 1` returns `Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature feat-x --gate architecture_review_as_built --by 1 --rationale "«why»"` and without `by` keeps `--by «N»`.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-view.ts
- src/conductor/test/engine/kickback-budget-view.test.ts

**Dependencies:** Task 1

### Task 4: BUILD growth-exhausted halt shows pending growth and the minimum raise
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/conductor-kickback-transition.test.ts` using `runBuild`, with lap caps high enough (or gate laps 0 under cap 1) that only growth can exhaust: (a) growth `{ authored 40, added 0 }`, growth cap resolving to 10, charges `prd_audit` {1, 3} and `architecture_review_as_built` {1, 8} → BUILD not called, `.pipeline/HALT` contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)`, `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`, and `--gate architecture_review_as_built --by 1`; (b) added 9, `effectiveGrowthCap` 13, charges 3 and 2 → HALT contains `Plan growth: 9/13 added; 0 remaining (raised cap)` and `would reach 14/13 when build dispatches; minimum raise 1`; (c) added 10, cap 10, `prd_audit` growth 2 → `Plan growth: 10/10 added; 0 remaining (config-derived cap)`, `Pending growth: 2 (prd_audit 2); would reach 12/10 when build dispatches; minimum raise 2`, and `BUILD dispatch halted: prd_audit growth allowance exhausted`; (d) the fixture of (a) with `effectiveGrowthCap` 11 → BUILD called once, ledger growth added 11, `pendingRepair` absent, no HALT file; (e) the fixture of (a) run a second time with no raise → HALT again states `minimum raise 1`, gates' laps and growth unchanged, pending repair JSON byte-identical to the pre-run fixture; (f) a lap exhaustion whose pending growth fits → HALT names `laps`, its `Pending growth:` line ends `when build dispatches` with no `minimum raise`, and the recovery line keeps `«N»`; (g) a malformed pending repair → HALT keeps `growth allowance unavailable`, has no `Pending growth:` line, keeps `«N»`, and `HALT.class` is `needs-human`.
2. Verify RED. If an existing assertion on a `Plan growth:` remaining figure uses a fixture that carries pending growth, update it to the pending-adjusted remaining; fixtures without pending growth keep their assertions unchanged.
3. Implement in `settleBuildPendingRepair` (`src/conductor/src/engine/conductor.ts`): wrap `growthView` with `withPendingGrowth(..., settlementLedger?.pendingRepair)`, and pass `by: minimumRaise` to `renderKickbackRecoveryHint` only when the exhaustion is `growth`, `settlementFailure` is undefined, and `minimumRaise > 0`.
4. Verify GREEN and commit.

**Done when:**
- [test] A `Conductor.run()` BUILD dispatch with added 0, cap 10, and pending growth 3 and 8 does not call BUILD and writes a HALT in which the line `Plan growth: 0/10 added; 0 remaining (config-derived cap)` is immediately followed by the line `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`, and whose recovery line is exactly `Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature transition --gate architecture_review_as_built --by 1 --rationale "«why»"`.
- [test] The raised-cap fixture (added 9, cap 13, pending 3 and 2) HALT contains `Plan growth: 9/13 added; 0 remaining (raised cap)` and `Pending growth: 5 (prd_audit 3, architecture_review_as_built 2); would reach 14/13 when build dispatches; minimum raise 1`, and the at-cap fixture (added 10, cap 10, `prd_audit` 2) HALT contains `Plan growth: 10/10 added; 0 remaining (config-derived cap)`, `Pending growth: 2 (prd_audit 2); would reach 12/10 when build dispatches; minimum raise 2`, and `prd_audit growth allowance exhausted`.
- [test] With `effectiveGrowthCap` 11 the same two-gate fixture calls BUILD once, records growth added 11, clears `pendingRepair`, and writes no HALT; with no raise a second run HALTs again with `minimum raise 1`, leaves both gates' laps and the growth record unchanged, and leaves the pending repair JSON byte-identical.
- [test] A lap-exhaustion HALT whose pending growth fits contains `laps allowance exhausted`, a `Pending growth:` line ending `would reach <n>/<cap> when build dispatches` with no `minimum raise` segment, and a recovery line with `«N»`; a lap-exhaustion HALT whose pending charges all carry growth 0 contains no `Pending growth:` line and the same `Plan growth:` line as the no-pending rendering; and a malformed pending repair HALT contains `Kickback budget (prd_audit): growth allowance unavailable (`, no `Pending growth:` line, `«N»`, and a `needs-human` `HALT.class`.
- [test] In the mixed-gate fixture where the first gate fits and the second exceeds the cap, the HALT names the second gate and that gate's cap evidence carries `allowance: 'growth'` while neither gate's laps change.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** Task 2, Task 3

### Task 5: BUILD halt Findings line names the halting gate's findings
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/conductor-kickback-transition.test.ts` with `runBuild`: (a) pending repair with `prdAuditCriteria` `S5.1, S5.2, S5.3`, `pendingAsBuiltRemediationFindings` `as-built:a:1`, `as-built:a:2` on the ledger, and an `architecture_review_as_built` exhaustion → HALT contains `Findings (architecture_review_as_built): as-built:a:1, as-built:a:2` and `Also pending (prd_audit): S5.1, S5.2, S5.3`, contains no `Findings: S5.1`, and the as-built gate's cap evidence `latestReason` begins with `Findings (architecture_review_as_built): as-built:a:1`; (b) the same findings with a `prd_audit` exhaustion → `Findings (prd_audit): S5.1, S5.2, S5.3` and `Also pending (architecture_review_as_built): as-built:a:1, as-built:a:2`; (c) `prd_audit`-only with `S1.1` → `Findings (prd_audit): S1.1` and no `Also pending`; (d) as-built exhaustion with no as-built findings and task ids `rem-1, rem-2` → `Pending remediation tasks: rem-1, rem-2` under the as-built label with no prd_audit criteria under it; (e) malformed record → `Pending remediation findings are unavailable because the repair record is malformed.` and no `Findings (` line.
2. Update the existing assertions in this file that expect the old `Findings: S1.1, S1.2` and `Findings: S2.1` BUILD-halt text to the new `Findings (prd_audit): ...` form, or to `Also pending (prd_audit): S2.1` for the mixed as-built lap case. Leave `test/prd-audit-kickback.test.ts` refusal-rework assertions untouched unless a failing one is proven to read the BUILD settlement halt.
3. Verify RED.
4. Implement the halting-gate findings selection in `settleBuildPendingRepair` (`src/conductor/src/engine/conductor.ts`) per the Technical Approach; keep the `Blocking findings:` detail block and `writeRefusalReworkAllowanceHalt` unchanged.
5. Verify GREEN and commit.

**Done when:**
- [test] An `architecture_review_as_built` BUILD exhaustion with both gates' findings pending writes a HALT with `Findings (architecture_review_as_built): as-built:a:1, as-built:a:2` and `Also pending (prd_audit): S5.1, S5.2, S5.3`, no `Findings: S5.1`, and cap evidence `latestReason` beginning with the as-built findings.
- [test] A `prd_audit` exhaustion over the same findings writes `Findings (prd_audit): S5.1, S5.2, S5.3` and `Also pending (architecture_review_as_built): as-built:a:1, as-built:a:2`, and a `prd_audit`-only repair with `S1.1` writes `Findings (prd_audit): S1.1` and no `Also pending` line.
- [test] An as-built exhaustion with no as-built findings writes `Pending remediation tasks: rem-1, rem-2` and no prd_audit criteria under the `Findings (architecture_review_as_built)` label, and a malformed record writes the existing malformed-record sentence with no `Findings (` line and no `Also pending (` line.
- [test] The `Blocking findings:` detail block renders unchanged for the as-built fixture, and the refusal-rework halt assertions in `test/prd-audit-kickback.test.ts` pass unchanged.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** Task 4

### Task 6: kickback-budget inspect shows pending growth in human and JSON output
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/kickback-budget-view.test.ts` through the inspect CLI entry: (a) a worktree with growth authored 40, added 0, cap 10, and pending charges 3 and 8 → each remediation gate's human block contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)` and `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`, and `--format json` views carry `planGrowth.remaining` 0 and `planGrowth.pendingGrowth` equal to `{ total: 11, byGate: { prd_audit: 3, architecture_review_as_built: 8 }, projected: 11, minimumRaise: 1 }`, matching `projectPendingGrowth` for the same ledger; (b) added 2, `prd_audit` 3, cap 10 → `5 remaining` and `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches`; (c) no pending repair, laps-only pending repair, and a routed-host fixture whose route receipt carries growth 4 and whose ledger has no flat `pendingRepair` → each fixture's human and JSON output byte-identical to literals captured from that fixture's own pre-change rendering, with no `pendingGrowth` key; (d) unreadable ledger → existing refusal and exit code.
2. Verify RED.
3. Implement: in `src/conductor/src/engine/kickback-budget-cli.ts` `planGrowthViewFor`, wrap both the feature and child return paths with `withPendingGrowth(view, ledger.pendingRepair)`.
4. Verify GREEN and commit.

**Done when:**
- [test] `ai-conductor kickback-budget inspect` for the two-gate fixture prints `Plan growth: 0/10 added; 0 remaining (config-derived cap)` and `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1` in each remediation gate block.
- [test] `inspect --format json` for the two-gate fixture gives every remediation gate view in its `gates` array `planGrowth.remaining: 0` and `planGrowth.pendingGrowth` equal to `{ total: 11, byGate: { prd_audit: 3, architecture_review_as_built: 8 }, projected: 11, minimumRaise: 1 }`, deep-equal to the `projectPendingGrowth` result's four public fields for the same ledger.
- [test] Inspect for added 2, cap 10, `prd_audit` 3 prints `Plan growth: 2/10 added; 5 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches` with no `minimum raise`.
- [test] Inspect with no pending repair, with a laps-only pending repair, and with a routed-host fixture whose route receipt carries growth 4 and whose ledger has no flat `pendingRepair` prints human output and `--format json` output each byte-identical to the literal expected text captured from the pre-change rendering of that same fixture, so no `Pending growth:` line and no `pendingGrowth` key appear, and an unreadable ledger keeps the existing `kickback-budget: ledger is unreadable.` refusal with exit 1.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts
- src/conductor/test/engine/kickback-budget-view.test.ts

**Dependencies:** Task 3

### Task 7: daemon status PLAN GROWTH line shows pending growth
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-observe-cli.test.ts` through `daemon status`: (a) authored 40, added 0, cap 10, pending charges 3 and 8 → line `PLAN GROWTH [<slug>]: authored 40; added 0; remaining 0/10; pending 11 (prd_audit 3, architecture_review_as_built 8), minimum raise 1`; (b) added 2 (byGate prd_audit 2), cap 10, `prd_audit` 3 → line contains `remaining 5/10; pending 3 (prd_audit 3)` and no `minimum raise`; (c) no pending repair → line byte-identical to the pre-change expected text with no `pending` segment; (d) laps-only pending repair → line byte-identical to (c)'s form; (e) unreadable growth → existing `PLAN GROWTH [<slug>]: unavailable (...)` with no pending segment; (f) unresolved plan with pending `prd_audit` growth 4 → `plan unresolved; added <n>; pending 4 (prd_audit 4)` with no cap and no `minimum raise`; (g) a routed-host fixture whose route receipt carries growth 4 and whose ledger has no flat `pendingRepair` → line unchanged.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon-observe-cli.ts`: compute `projectPendingGrowth(growth.added, ledger.pendingRepair?.charges, cap or null for unresolved)`; only when it is defined with `total > 0`, reduce the rendered remaining by `total` (floored at 0) and append the pending segment.
4. Verify GREEN and commit.

**Done when:**
- [test] `daemon status` for the two-gate fixture prints exactly `PLAN GROWTH [<slug>]: authored 40; added 0; remaining 0/10; pending 11 (prd_audit 3, architecture_review_as_built 8), minimum raise 1`, matching the total, breakdown, and minimum raise that inspect and the BUILD halt report for the same ledger.
- [test] `daemon status` for added 2, cap 10, `prd_audit` 3 prints `remaining 5/10; pending 3 (prd_audit 3)` with no `minimum raise`.
- [test] `daemon status` with no pending repair, with a laps-only pending repair, and with a routed-host fixture whose route receipt carries growth 4 and whose ledger has no flat `pendingRepair` prints a `PLAN GROWTH` line byte-identical to the pre-change expected text with no `pending` segment.
- [test] `daemon status` with unreadable growth keeps `PLAN GROWTH [<slug>]: unavailable (...)` with no pending segment, and with an unresolved plan and pending `prd_audit` growth 4 prints `plan unresolved; added <n>; pending 4 (prd_audit 4)` with no cap and no `minimum raise`.

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts
- src/conductor/test/engine/daemon-observe-cli.test.ts

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─> Task 2 ─┐
        ├─> Task 3 ─┼─> Task 4 ─> Task 5
        │           └─> Task 6
        └─> Task 7
```

## Integration Points

- After Task 4: a real BUILD dispatch halt shows pending growth and `--by <minimum>`; raising by it dispatches BUILD.
- After Tasks 6 and 7: both operator surfaces agree with the halt for the same ledger.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature with settled growth 0, a config-derived growth cap of 10, and a flat pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 8 with lap allowance to spare, when BUILD dispatch settlement halts, then the HALT contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)` followed by `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`. | 4, 3 | "writes a HALT in which the line `Plan growth: 0/10 added; 0 remaining (config-derived cap)` is immediately followed by the line `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`" | diff-local |
| Story 1 happy: Given the same halt, when the operator reads its recovery line, then it reads `Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature <slug> --gate architecture_review_as_built --by 1 --rationale "«why»"` with the computed minimum raise in place of `«N»`. | 4, 3 | "whose recovery line is exactly `Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature transition --gate architecture_review_as_built --by 1 --rationale "«why»"`" | diff-local |
| Story 1 happy: Given a feature with settled growth 9, a raised growth cap of 13, and a pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 2, when settlement halts, then the HALT contains `Plan growth: 9/13 added; 0 remaining (raised cap)` and `Pending growth: 5 (prd_audit 3, architecture_review_as_built 2); would reach 14/13 when build dispatches; minimum raise 1`. | 4 | "The raised-cap fixture (added 9, cap 13, pending 3 and 2) HALT contains `Plan growth: 9/13 added; 0 remaining (raised cap)`" | diff-local |
| Story 1 happy: Given a feature whose settled growth already equals its cap of 10 and whose pending repair charges `prd_audit` growth 2 only, when settlement halts, then the HALT contains `Plan growth: 10/10 added; 0 remaining (config-derived cap)` and `Pending growth: 2 (prd_audit 2); would reach 12/10 when build dispatches; minimum raise 2`, naming `prd_audit` as the halting gate. | 4 | "the at-cap fixture (added 10, cap 10, `prd_audit` 2) HALT contains `Plan growth: 10/10 added; 0 remaining (config-derived cap)`" | diff-local |
| Story 1 negative: Given a pending repair record that is present but malformed, when settlement fails closed, then the HALT keeps its existing `Kickback budget (prd_audit): growth allowance unavailable (...)` detail, prints no `Pending growth:` line, keeps the `needs-human` class, and the recovery line keeps the `«N»` placeholder rather than a computed number. | 4 | "a malformed pending repair HALT contains `Kickback budget (prd_audit): growth allowance unavailable (`, no `Pending growth:` line, `«N»`, and a `needs-human` `HALT.class`" | diff-local |
| Story 1 negative: Given a halt caused by an exhausted lap allowance while the pending repair's growth fits under the cap, when settlement halts, then the HALT names the `laps` allowance as today, its `Pending growth:` line ends with `would reach <n>/<cap> when build dispatches` with no `minimum raise` segment, and the lap recovery line keeps the `«N»` placeholder. | 4 | "A lap-exhaustion HALT whose pending growth fits contains `laps allowance exhausted`, a `Pending growth:` line ending `would reach <n>/<cap> when build dispatches` with no `minimum raise` segment, and a recovery line with `«N»`" | diff-local |
| Story 1 negative: Given a pending repair whose gate charges carry laps but zero growth, when any surface renders the budget, then no `Pending growth:` line is printed and the `Plan growth:` line is identical to its rendering with no pending repair. | 3, 7, 6, 4 | "with laps-only charges it returns a view with no `pendingGrowth` key whose rendering is identical to the rendering with no pending repair, with no `Pending growth:` line." | diff-local |
| Story 2 happy: Given a growth-exhausted halt stating `minimum raise 1` for settled growth 0, cap 10, and pending growth 11 split across two gates, when the operator raises the growth allowance by 1 and BUILD dispatches again with lap allowance to spare, then settlement charges both gates' laps and growth, records growth `11/11`, clears the pending repair, and writes no HALT. | 4, 2 | "With `effectiveGrowthCap` 11 the same two-gate fixture calls BUILD once, records growth added 11, clears `pendingRepair`, and writes no HALT" | diff-local |
| Story 2 happy: Given a pending repair whose total growth fits under the cap, when BUILD dispatches, then settlement charges every gate exactly as before this change: the same per-gate laps and growth increments, the same `plan_growth` event, and the pending repair cleared. | 2 | "emits exactly one `plan_growth` event through `options.events` whose payload equals the payload the pre-change settlement emits for the same fixture" | diff-local |
| Story 2 negative: Given the same halt stating `minimum raise 1` and a growth cap that has not been raised, when BUILD dispatches again, then settlement halts with `minimum raise 1` again, charges no lap or growth to either gate, and leaves the pending repair record byte-identical. | 4 | "with no raise a second run HALTs again with `minimum raise 1`, leaves both gates' laps and the growth record unchanged, and leaves the pending repair JSON byte-identical." | diff-local |
| Story 2 negative: Given a pending repair whose first gate fits and whose second gate would push the cumulative growth over the cap, when settlement halts, then the halting gate named in the HALT and in the cap evidence is the second gate, as before this change, and neither gate is charged. | 2, 4 | "In the mixed-gate fixture where the first gate fits and the second exceeds the cap, the HALT names the second gate and that gate's cap evidence carries `allowance: 'growth'` while neither gate's laps change." | diff-local |
| Story 3 happy: Given a pending repair carrying `prd_audit` criteria `S5.1, S5.2, S5.3` and as-built findings `as-built:a:1` and `as-built:a:2`, when settlement halts on `architecture_review_as_built`, then the HALT contains `Findings (architecture_review_as_built): as-built:a:1, as-built:a:2` and `Also pending (prd_audit): S5.1, S5.2, S5.3`, and the cap evidence's latest reason names the as-built findings first. | 5 | "An `architecture_review_as_built` BUILD exhaustion with both gates' findings pending writes a HALT with `Findings (architecture_review_as_built): as-built:a:1, as-built:a:2` and `Also pending (prd_audit): S5.1, S5.2, S5.3`" | diff-local |
| Story 3 happy: Given the same pending repair, when settlement halts on `prd_audit`, then the HALT contains `Findings (prd_audit): S5.1, S5.2, S5.3` and `Also pending (architecture_review_as_built): as-built:a:1, as-built:a:2`. | 5 | "A `prd_audit` exhaustion over the same findings writes `Findings (prd_audit): S5.1, S5.2, S5.3` and `Also pending (architecture_review_as_built): as-built:a:1, as-built:a:2`" | diff-local |
| Story 3 happy: Given a pending repair charging only `prd_audit` with criteria `S1.1`, when settlement halts on `prd_audit`, then the HALT contains `Findings (prd_audit): S1.1` and no `Also pending` line. | 5 | "a `prd_audit`-only repair with `S1.1` writes `Findings (prd_audit): S1.1` and no `Also pending` line." | diff-local |
| Story 3 negative: Given a halt on `architecture_review_as_built` whose pending repair records no as-built findings but lists task ids `rem-1, rem-2`, when the HALT renders, then it contains `Pending remediation tasks: rem-1, rem-2` rather than another gate's criteria under that gate's `Findings` label. | 5 | "An as-built exhaustion with no as-built findings writes `Pending remediation tasks: rem-1, rem-2` and no prd_audit criteria under the `Findings (architecture_review_as_built)` label" | diff-local |
| Story 3 negative: Given a malformed pending repair, when settlement fails closed, then the HALT keeps `Pending remediation findings are unavailable because the repair record is malformed.` and names no gate's findings. | 5 | "a malformed record writes the existing malformed-record sentence with no `Findings (` line and no `Also pending (` line." | diff-local |
| Story 4 happy: Given a feature with authored 40, settled growth 0, cap 10, and a pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 8, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the human output for each remediation gate contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)` and `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`. | 6 | "`ai-conductor kickback-budget inspect` for the two-gate fixture prints `Plan growth: 0/10 added; 0 remaining (config-derived cap)`" | diff-local |
| Story 4 happy: Given the same feature, when the operator runs inspect with `--format json`, then each view's `planGrowth` carries `remaining: 0` and `pendingGrowth` equal to `{ total: 11, byGate: { prd_audit: 3, architecture_review_as_built: 8 }, projected: 11, minimumRaise: 1 }`. | 6 | "`inspect --format json` for the two-gate fixture gives every remediation gate view in its `gates` array `planGrowth.remaining: 0`" | diff-local |
| Story 4 happy: Given the same feature, when the operator runs `ai-conductor daemon status`, then its plan growth line reads `PLAN GROWTH [<slug>]: authored 40; added 0; remaining 0/10; pending 11 (prd_audit 3, architecture_review_as_built 8), minimum raise 1`. | 7 | "`daemon status` for the two-gate fixture prints exactly `PLAN GROWTH [<slug>]: authored 40; added 0; remaining 0/10; pending 11 (prd_audit 3, architecture_review_as_built 8), minimum raise 1`" | diff-local |
| Story 4 happy: Given a feature with settled growth 2, cap 10, and pending growth 3 for `prd_audit` only, when either surface renders, then inspect shows `Plan growth: 2/10 added; 5 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches`, and daemon status shows `remaining 5/10; pending 3 (prd_audit 3)` with no minimum raise. | 6, 7 | "Inspect for added 2, cap 10, `prd_audit` 3 prints `Plan growth: 2/10 added; 5 remaining (config-derived cap)`" | diff-local |
| Story 4 negative: Given a feature with no pending repair, when either surface renders, then the output is byte-identical to its output before this change: no `Pending growth:` line, no `pending` segment, and no `pendingGrowth` JSON field. | 6, 7 | "prints human output and `--format json` output each byte-identical to the literal expected text captured from the pre-change rendering of that same fixture" | diff-local |
| Story 4 negative: Given a feature whose ledger growth record is unreadable, when daemon status renders, then the plan growth line keeps its existing `unavailable (...)` form with no pending segment, and inspect exits with its existing unreadable-ledger refusal. | 7, 6 | "`daemon status` with unreadable growth keeps `PLAN GROWTH [<slug>]: unavailable (...)` with no pending segment" | diff-local |
| Story 4 negative: Given a feature whose plan is unresolved and whose pending repair charges growth 4, when daemon status renders, then the line keeps its `plan unresolved; added <n>` form and appends `; pending 4 (<gate> 4)` without inventing a cap or minimum raise. | 7 | "with an unresolved plan and pending `prd_audit` growth 4 prints `plan unresolved; added <n>; pending 4 (prd_audit 4)` with no cap and no `minimum raise`." | diff-local |
| Story 4 negative: Given a routed-host round whose pending growth lives in a route receipt rather than a flat pending repair, when either surface renders, then the output is unchanged from before this change. | 7, 6 | "`daemon status` with no pending repair, with a laps-only pending repair, and with a routed-host fixture whose route receipt carries growth 4 and whose ledger has no flat `pendingRepair` prints a `PLAN GROWTH` line byte-identical to the pre-change expected text with no `pending` segment." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
