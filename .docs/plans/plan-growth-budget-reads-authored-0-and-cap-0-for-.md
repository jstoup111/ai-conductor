# Implementation Plan: Plan-growth budget resolves daemon feature plans

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/plan-growth-budget-reads-authored-0-and-cap-0-for-.md`)
**Stories:** .docs/stories/plan-growth-budget-reads-authored-0-and-cap-0-for-.md
**Conflict check:** Not required (Tier S)

## Summary

Make every plan-growth reading — `ai-conductor daemon status`, `ai-conductor kickback-budget inspect`,
refusal-rework admission, build-boundary pending-repair settlement, and the remediation append
budget — resolve a daemon feature's plan through the shared plan identity ladder and compute its cap
in one function, so the views report the cap the engine enforces. Eight tasks.

## Technical Approach

- **Resolve the plan through the existing ladder.** `deriveGrowthFromActivePlan` in
  `src/conductor/src/engine/kickback-ledger.ts` today reads only `.pipeline/engine-state.json`
  `activePlanPath` and returns `{ authored: 0, resolved: false }` without it. Daemon-dispatched,
  spec-landed features record no `activePlanPath` until their first remediation, so every view reads
  authored 0. It will instead call `selectFeaturePlan(projectRoot, featureDesc)` from `artifacts.ts`.
  That function is the recorded path first, then a singleton corpus, then the plan whose stem equals
  the feature. `featureDesc` is read from `.pipeline/conduct-state.json` with `readState`, exactly as
  `resolveRepairPlanBinding` (`repair-plan-binding.ts`) does. Do not re-derive either half of the
  ladder at the call site. Only a `resolved` selection counts as resolved. `empty` and `unresolvable`
  stay unresolved. The heading regex and the pending-task exclusion are unchanged.
- **Expose where the authored count came from, and allow a non-persisting read.** A new
  `readGrowthAccounting(projectRoot, cap, { persist })` returns
  `{ growth: PlanGrowth; authoredSource: 'plan' | 'ledger' | 'unresolved' }`:
  - `plan`: the plan resolved.
  - `ledger`: the plan did not resolve, but a stored growth record supplied the numbers.
  - `unresolved`: neither.

  With `persist: false`, the two existing ledger rewrites (the reconciliation and the
  impossible-record recompute) return the same values without writing. `readGrowth` becomes a thin
  delegate with `persist: true`, so its contract and existing tests are unchanged.
- **One budget computation.** A new `readPlanGrowthBudget(projectRoot, config, { persist })` in
  `remediation-caps.ts` does three things:
  1. Reads the ledger.
  2. Computes the unbounded authored count.
  3. Sets `cap = ledger.effectiveGrowthCap ?? prdAuditAppendCap(config, authored)`.

  It returns `{ growth, cap, capSource: 'raised' | 'config-derived', authoredSource }`. It replaces
  five inline computations:
  - `daemon-observe-cli.ts` `renderPlanGrowthSection`.
  - `kickback-budget-cli.ts` `planGrowthViewFor`.
  - The conductor's refusal-rework `refusalReworkAllowanceAvailable`.
  - The conductor's build-boundary `settleBuildPendingRepair`.
  - `readRemediationGateAppendBudget`, which drops its `authoredTaskCount` parameter. The
    conductor's raw `activePlanText.match(/^#{1,6}\s+Task\s+/gim)` count is deleted. That count
    included recorded `rem-*` appends in the denominator.

  After this, `prdAuditAppendCap` has exactly one production caller. The cap formula, config keys,
  and the unresolved fail-closed number (cap 0 with no raised cap) are unchanged.
- **Recorded appends are added, not authored.** This already holds whenever a growth record exists.
  `readGrowth` reconciles `authored = planHeadings − stored.added`. It held only in `readGrowth`,
  though, and the append budget's raw count did not apply it. Routing every consumer through
  `readPlanGrowthBudget` makes it hold everywhere. The legacy rule stays: with no growth record,
  every heading (including an unattributed `rem-*`) is authored, because no `byGate` attribution
  exists to charge it to.
- **Views render the shared result.**
  - `daemon status` prints `authored <a>; added <n>[ (<byGate>)]; remaining <r>/<cap>`. When
    `authoredSource` is `unresolved` it prints `plan unresolved; added <n>` instead, and appends
    `; remaining <r>/<cap>` only when the cap is raised.
  - `kickback-budget inspect` (no `--child`) renders `Plan growth: plan unresolved; <n> added` for
    an unresolved, unraised budget, with JSON `planGrowth.cap: null` and `authoredSource:
    'unresolved'`.
  - Both views read with `persist: false`. Inspect's existing "does not reconcile or persist growth"
    contract holds, and status stops writing the ledger.
  - `--child` inspect keeps its current child-ledger path. Child scope is out of bounds.
- **Local test patterns.**
  - Ledger tests: the `readGrowth` cases in `src/conductor/test/engine/kickback-ledger.test.ts`.
    These are a temp dir with plan-corpus files, `.pipeline/engine-state.json`, and
    `writeKickbackLedger`.
  - Status: the `writeActivePlan` + `runDaemonStatus` cases in
    `src/conductor/test/engine/daemon-observe-cli.test.ts`. Search `PLAN GROWTH [`.
  - Inspect: the `makeFeature` + `dispatchKickbackBudgetCommand` cases in
    `src/conductor/test/cli/kickback-budget.test.ts`. Search `Plan growth:`.
  - Conductor run: `runRefusalReworkRun({ beforeRun })` in
    `src/conductor/test/prd-audit-kickback.test.ts`. That fixture writes `activePlanPath` and
    `feature_desc: 'feature'`, so the task's `beforeRun` removes the engine-state file and adds a
    second plan.

  Daemon fixtures must omit `activePlanPath` and set conduct-state `feature_desc` to the slug, and
  they need at least two plans, so the singleton rung does not mask the slug rung.

## Prerequisites

- None.

## Tasks

### Task 1: Growth derivation resolves the plan through the feature plan ladder
**Story:** Story 1 (happy paths 1 and 3; negative path 1 — ledger layer)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts`, following the existing `readGrowth` temp-dir fixtures. (a) No `engine-state.json`, `.pipeline/conduct-state.json` with `feature_desc: 'slug-feature'`, plan-corpus file `slug-feature.md` with 17 `### Task <n>:` headings, and plan-corpus file `other.md` with 5: `readGrowth(dir, 4)` resolves to `{ authored: 17, added: 0, byGate: {}, remaining: 4 }`. (b) `engine-state.json` records an `activePlanPath` naming plan-corpus file `other.md` with the same plans: `readGrowth` reports `authored: 5`. (c) No `activePlanPath`, two plans, neither stem `slug-feature`: `readGrowth(dir, 4)` reports `authored: 0`.
2. Verify RED for (a).
3. In `deriveGrowthFromActivePlan`, replace the direct `engine-state.json` read with `selectFeaturePlan(projectRoot, featureDesc)`. Read `featureDesc` via `readState(join(projectRoot, '.pipeline', 'conduct-state.json'))`, mirroring `resolveRepairPlanBinding`. Treat only `kind: 'resolved'` as resolved, and keep the existing heading regex, pending-id exclusion, and read-failure warning. Do not add a second resolver.
4. Verify GREEN; commit "fix(kickback-ledger): resolve growth plan through the feature plan ladder".

**Done when:**
- [test] `kickback-ledger.test.ts` asserts `readGrowth` returns authored 17 for a worktree with no `activePlanPath` whose conduct-state feature names the 17-heading plan among two plans.
- [test] `kickback-ledger.test.ts` asserts a recorded `activePlanPath` naming the 5-heading plan wins over the slug-matched 17-heading plan (authored 5).
- [test] `kickback-ledger.test.ts` asserts that with no `activePlanPath` and no plan stem matching the feature among several plans, `readGrowth` reports authored 0.
- `deriveGrowthFromActivePlan` obtains its plan path only from `selectFeaturePlan`, and the existing test "derives authored count from only the recorded active plan, including pre-existing rem tasks" passes unchanged.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — ladder resolution in `deriveGrowthFromActivePlan`
- `src/conductor/test/engine/kickback-ledger.test.ts` — ladder cases

**Dependencies:** none

### Task 2: Growth accounting reports its authored source and supports a non-persisting read
**Story:** Story 1 (negative paths 1 and 2 — ledger layer)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `kickback-ledger.test.ts` for a new export `readGrowthAccounting(projectRoot, cap, { persist })`:
   - `authoredSource` is `'plan'` for the Task 1 (a) fixture.
   - It is `'ledger'` when no plan resolves but a stored record `{ authored: 3, added: 1, byGate: { prd_audit: 1 } }` exists, and the growth equals that record.
   - It is `'unresolved'` when no plan resolves and no record exists.
   - With `persist: false`, a daemon fixture whose plan has 12 headings and whose stored record is `{ authored: 0, added: 2, byGate: { prd_audit: 2 } }` returns authored 10, and `.pipeline/kickback-ledger.json` bytes are identical before and after.
   - With the same fixture, `readGrowth` still persists `authored: 10`.
2. Verify RED.
3. Move `readGrowth`'s body into `readGrowthAccounting`. Return `authoredSource` from the derivation's `resolved` flag and the presence of `ledger.growth`, and skip both `writeKickbackLedgerUnsafe` calls when `persist === false`. `readGrowth(projectRoot, cap)` returns `(await readGrowthAccounting(projectRoot, cap, { persist: true })).growth`.
4. Verify GREEN; commit "feat(kickback-ledger): report growth authored source with an optional non-persisting read".

**Done when:**
- [test] `kickback-ledger.test.ts` asserts `readGrowthAccounting` returns `authoredSource` `'plan'`, `'ledger'`, and `'unresolved'` for the three fixtures named in Steps.
- [test] `kickback-ledger.test.ts` asserts `readGrowthAccounting(..., { persist: false })` returns authored 10 for the 12-heading/added-2 fixture and leaves the ledger file byte-identical.
- [test] `kickback-ledger.test.ts` asserts `readGrowth` on that same fixture persists `growth.authored` 10, and every pre-existing `readGrowth` test passes unchanged.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — `readGrowthAccounting`, `readGrowth` delegate
- `src/conductor/test/engine/kickback-ledger.test.ts` — accounting cases

**Dependencies:** Task 1

### Task 3: One shared plan-growth budget computation
**Story:** Story 2 (happy path 1, negative path 3 — budget layer); Story 1 (happy path 1 — budget layer)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-caps.test.ts` for `readPlanGrowthBudget(projectRoot, config, { persist })`, each fixture with no `activePlanPath` and conduct-state `feature_desc` set to the slug:
   - **Story 2 fixture:** the slug plan has 24 `### Task <n>:` headings and 9 `### Task rem-<x>:` headings, beside another plan. The stored growth is `{ authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } }`, and the config is `{ prd_audit: { max_appended_tasks: 30, max_appended_ratio: 0.5 } }`. The result is `{ growth: { authored: 24, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 }, remaining: 3 }, cap: 12, capSource: 'config-derived', authoredSource: 'plan' }`.
   - **Same fixture with `effectiveGrowthCap: 20`:** `cap` 20, `capSource` `'raised'`, `growth.remaining` 11.
   - **17-heading slug plan with default config:** `growth.authored` 17, `cap` 4, `growth.remaining` 4.
   - **No resolvable plan, no record, no raised cap:** `authoredSource` `'unresolved'`, `cap` 0.
2. Verify RED.
3. Implement `readPlanGrowthBudget`. Read the ledger, compute `unbounded = readGrowthAccounting(root, Number.MAX_SAFE_INTEGER, { persist })` and `cap = ledger.effectiveGrowthCap ?? prdAuditAppendCap(config, unbounded.growth.authored)`, then return `readGrowthAccounting(root, cap, { persist })` with `cap`, `capSource`, and `authoredSource`. Unreadable-ledger errors propagate as from `readGrowth`.
4. Verify GREEN; commit "feat(remediation-caps): one shared plan-growth budget computation".

**Done when:**
- [test] `remediation-caps.test.ts` asserts `readPlanGrowthBudget` on the Story 2 fixture returns growth authored 24, added 9, byGate `{ prd_audit: 5, architecture_review_as_built: 4 }`, remaining 3, cap 12, capSource `'config-derived'`.
- [test] `remediation-caps.test.ts` asserts the same fixture with `effectiveGrowthCap: 20` returns cap 20, capSource `'raised'`, remaining 11.
- [test] `remediation-caps.test.ts` asserts the 17-heading default-config fixture returns authored 17, cap 4, remaining 4.
- [test] `remediation-caps.test.ts` asserts the unresolvable fixture returns `authoredSource` `'unresolved'` and cap 0.

**Files likely touched:**
- `src/conductor/src/engine/remediation-caps.ts` — `readPlanGrowthBudget`, `PlanGrowthBudget` type
- `src/conductor/test/engine/remediation-caps.test.ts` — budget cases

**Dependencies:** Task 2

### Task 4: Remediation append budget takes its growth cap from the shared budget
**Story:** Story 2 (happy path 3)
**Type:** refactor

**Steps:**
1. Write a failing test in `remediation-caps.test.ts`. `readRemediationGateAppendBudget(root, config, 'prd_audit', lapCap, taskCount, growthTaskCount)` on the Story 2 fixture returns `growthCap: 12` and `growth.authored: 24`. Today the conductor passes 33, the count of every heading, which yields 16.
2. Verify RED (the call site no longer takes an authored count).
3. Remove the `authoredTaskCount` parameter. Derive `growthCap` and `growth` from `readPlanGrowthBudget(projectRoot, config)`, keeping the unreadable-ledger and unreadable-gate branches in their current order. In `conductor.ts`'s `planRemediation`, delete the `activePlanText.match(/^#{1,6}\s+Task\s+/gim)` count and drop the argument from both calls. Update the existing `readRemediationGateAppendBudget` callers in `src/conductor/test/prd-audit-kickback.test.ts` and `src/conductor/test/engine/kickback-ledger.test.ts` to the new arity.
4. Verify GREEN; commit "refactor(remediation-caps): append budget reads the shared growth budget".

**Done when:**
- [test] `remediation-caps.test.ts` asserts `readRemediationGateAppendBudget` for `prd_audit` on the Story 2 fixture returns growthCap 12, not 16, and growth authored 24.
- `readRemediationGateAppendBudget` has no `authoredTaskCount` parameter, and `src/conductor/src/engine/conductor.ts` contains no `Task\s+/gim` heading count.
- [test] The existing growth-cap tests in `conductor-kickback-ledger.test.ts` (raised cap appends all 6; config-derived cap appends 6 with pending charge growth 6) and `prd-audit-kickback.test.ts` pass.

**Files likely touched:**
- `src/conductor/src/engine/remediation-caps.ts` — `readRemediationGateAppendBudget` signature
- `src/conductor/src/engine/conductor.ts` — remove raw heading count and argument
- `src/conductor/test/engine/remediation-caps.test.ts` — append-budget case
- `src/conductor/test/prd-audit-kickback.test.ts` — call arity
- `src/conductor/test/engine/kickback-ledger.test.ts` — call arity

**Dependencies:** Task 3

### Task 5: Build-boundary settlement uses the shared growth budget
**Story:** Story 2 (happy path 2; negative paths 1 and 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `remediation-caps.test.ts` for a new export, `pendingRepairSettlementBudgets(projectRoot, config, ledger)`. It returns the per-gate `PendingRepairSettlementBudget[]` that `settlePendingRepair` consumes: `prd_audit` and `architecture_review_as_built`, lap caps from `effectiveLapCap ?? remediationLapCapForGate`, and growth cap and growth from `readPlanGrowthBudget`. The tests feed its result to `settlePendingRepair`.
   - The Story 2 fixture with a pending repair charging `prd_audit` `{ laps: 1, growth: 3 }` returns `{ kind: 'settled' }`, and the ledger's growth becomes added 12 with `byGate.prd_audit` 8.
   - The same fixture charging growth 4 returns `{ kind: 'exhausted', gate: 'prd_audit', allowance: 'growth' }`, and the ledger's growth stays added 9.
   - An unresolvable fixture with no record and no raised cap, charging growth 1, returns `exhausted` with allowance `growth`.
2. Verify RED.
3. Implement `pendingRepairSettlementBudgets` and replace the inline `readGrowth`/`prdAuditAppendCap` budget assembly in the conductor's `settleBuildPendingRepair` with it. Keep the surrounding failure handling, events, and growth-view rendering, sourcing `growthCap` and `settlementGrowth` from the returned budget.
4. Verify GREEN; commit "fix(conductor): settle pending repairs against the shared growth budget".

**Done when:**
- [test] `remediation-caps.test.ts` asserts `settlePendingRepair` with `pendingRepairSettlementBudgets` on the Story 2 fixture settles a growth-3 charge and persists growth added 12 with `prd_audit` 8.
- [test] `remediation-caps.test.ts` asserts the same composition refuses a growth-4 charge as `exhausted`/`growth` for `prd_audit` and leaves recorded growth added 9.
- [test] `remediation-caps.test.ts` asserts the unresolvable, unraised fixture refuses a growth-1 charge as `exhausted`/`growth`.
- `settleBuildPendingRepair` in `conductor.ts` builds its settlement budgets only through `pendingRepairSettlementBudgets`, with no direct `prdAuditAppendCap` call.

**Files likely touched:**
- `src/conductor/src/engine/remediation-caps.ts` — `pendingRepairSettlementBudgets`
- `src/conductor/src/engine/conductor.ts` — settlement wiring
- `src/conductor/test/engine/remediation-caps.test.ts` — settlement composition cases

**Dependencies:** Task 3

### Task 6: Refusal-rework admission reads the shared growth budget (engine integration)
**Story:** Story 3 (happy path 1; negative path 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/prd-audit-kickback.test.ts` using `runRefusalReworkRun` with `reports: [overScopeReport('S2.1', 'outside-visible')]`, `mode: 'auto'`, and a `beforeRun` that deletes `.pipeline/engine-state.json` and writes a second plan-corpus file `unrelated.md` with 3 task headings. The fixture keeps `feature_desc: 'feature'` and the 8-heading plan-corpus file `feature.md`.
   - **Resolvable plan:** `calls` contains `remediate` exactly once, and `.pipeline/HALT`, if present, does not contain `Refused — rework required`.
   - **Unresolvable plan:** `beforeRun` also renames `feature.md` to `other-feature.md`. `calls` contains no `remediate`, and `.pipeline/HALT` contains `Refused — rework required: S2.1.` (the refusal-rework halt written by `writeRefusalReworkHalt`).
2. Verify RED for the resolvable case (inferred, ~80%: today the allowance reads authored 0, computes cap 0, and halts). If it is already GREEN because an earlier step records `activePlanPath`, keep the test as the integration guard and record that observation in the commit body.
3. Replace the body of `refusalReworkAllowanceAvailable` in `conductor.ts` after the lap check with `(await readPlanGrowthBudget(this.projectRoot, this.config)).growth.remaining > 0`, keeping the unreadable-ledger/gate/growth guards and the catch-to-false.
4. Verify GREEN; commit "fix(conductor): refusal-rework admission resolves daemon feature plans".

**Done when:**
- [test] `prd-audit-kickback.test.ts` asserts a daemon `Conductor.run` with no `activePlanPath` and a slug-matched 8-task plan beside a second plan dispatches `remediate` exactly once for an over-scope refusal.
- [test] The same test asserts that run writes no HALT containing `Refused — rework required`.
- [test] `prd-audit-kickback.test.ts` asserts the same run with no plan whose stem is `feature` dispatches no `remediate` and writes a `.pipeline/HALT` containing `Refused — rework required: S2.1.`
- `refusalReworkAllowanceAvailable` computes remaining growth only through `readPlanGrowthBudget`, with no direct `prdAuditAppendCap` call in `conductor.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — refusal-rework allowance
- `src/conductor/test/prd-audit-kickback.test.ts` — daemon-plan refusal-rework runs

**Dependencies:** Task 3

### Task 7: `daemon status` renders the shared growth budget
**Story:** Story 1 (happy paths 1 and 3; negative path 1); Story 2 (happy path 1; negative path 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` using `runDaemonStatus`. Use a variant of `writeActivePlan` that omits `engine-state.json`, writes conduct-state `{ build: 'in_progress', feature_desc: <slug> }`, and adds a second plan. Assert these lines:
   - **17-heading slug plan, default config, empty ledger:** exactly `  PLAN GROWTH [<slug>]: authored 17; added 0; remaining 4/4`.
   - **Recorded `activePlanPath` naming a 5-heading plan:** contains `authored 5;`.
   - **No matching plan, empty ledger:** exactly `  PLAN GROWTH [<slug>]: plan unresolved; added 0`, and no output line contains `remaining 0/0`.
   - **Story 2 fixture:** exactly `  PLAN GROWTH [<slug>]: authored 24; added 9 (prd_audit: 5, architecture_review_as_built: 4); remaining 3/12`.
   - **Story 2 fixture with `effectiveGrowthCap: 20`:** ends `remaining 11/20`.
2. Verify RED.
3. In `renderPlanGrowthSection`, replace the `readGrowth`/`prdAuditAppendCap`/second-`readGrowth` sequence with `readPlanGrowthBudget(featureRoot, config, { persist: false })`. Render the unresolved form when `authoredSource === 'unresolved'`, appending `; remaining <r>/<cap>` only when `capSource === 'raised'`. Remove the `prdAuditAppendCap` import. Keep the KICKBACK BUDGET lines unchanged.
4. Verify GREEN; commit "fix(daemon-status): plan growth reports the enforced budget for daemon features".

**Done when:**
- [test] `daemon-observe-cli.test.ts` asserts `runDaemonStatus` prints `PLAN GROWTH [<slug>]: authored 17; added 0; remaining 4/4` for the no-`activePlanPath` 17-heading fixture.
- [test] `daemon-observe-cli.test.ts` asserts the recorded-`activePlanPath` fixture prints `authored 5;`, and the unmatched fixture prints `PLAN GROWTH [<slug>]: plan unresolved; added 0` with no `remaining 0/0`.
- [test] `daemon-observe-cli.test.ts` asserts the Story 2 fixture prints `authored 24; added 9 (prd_audit: 5, architecture_review_as_built: 4); remaining 3/12` and its raised-cap variant ends `remaining 11/20`.
- [test] The existing `PLAN GROWTH [growth-feature]` and `PLAN GROWTH [legacy-feature]` assertions in `daemon-observe-cli.test.ts` pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — `renderPlanGrowthSection`
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — daemon-feature growth cases

**Dependencies:** Task 3

### Task 8: `kickback-budget inspect` renders the shared growth budget without persisting
**Story:** Story 1 (happy path 2; negative paths 1 and 2); Story 2 (happy path 1; negative path 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts` using `dispatchKickbackBudgetCommand({ action: 'inspect', feature })`. The feature worktree has no `activePlanPath`, conduct-state `feature_desc` set to the slug, and a second plan. Assert:
   - **17-heading default-config fixture:** the human output contains `Plan growth: 0/4 added; 4 remaining (config-derived cap)`, and `--format json` reports `planGrowth.authored` 17 and `planGrowth.cap` 4.
   - **No-match fixture:** human output contains `Plan growth: plan unresolved; 0 added` and no `(config-derived cap)`. JSON reports `planGrowth.cap` `null` and `planGrowth.authoredSource` `'unresolved'`.
   - **Story 2 fixture:** JSON `planGrowth` has authored 24, added 9, cap 12, remaining 3. With `effectiveGrowthCap: 20`, the human output contains `(raised cap)` and JSON cap 20.
   - **Reconciliation fixture** (12 headings, stored `{ authored: 0, added: 2, byGate: { prd_audit: 2 } }`, no pending adjustment): JSON `planGrowth.authored` 10, and `.pipeline/kickback-ledger.json` bytes are identical before and after.
2. Verify RED.
3. In `kickback-budget-cli.ts`, `planGrowthViewFor` (non-child inspect and the post-mutation print) uses `readPlanGrowthBudget(worktree, config, { persist: false })`, and the `--child` path keeps its current computation. Remove the `prdAuditAppendCap` import. In `kickback-budget-view.ts`, `KickbackPlanGrowthView` gains `authoredSource` and `cap: number | null` (null only for unresolved and unraised), and `renderKickbackBudgetView` prints `Plan growth: plan unresolved; <n> added` for that case. Update `src/conductor/test/engine/kickback-budget-view.test.ts` fixtures for the new field.
4. Verify GREEN; commit "fix(kickback-budget): inspect reports the enforced growth budget for daemon features".

**Done when:**
- [test] `kickback-budget.test.ts` asserts inspect prints `Plan growth: 0/4 added; 4 remaining (config-derived cap)` and JSON `planGrowth.authored` 17, `planGrowth.cap` 4 for the 17-heading daemon fixture.
- [test] `kickback-budget.test.ts` asserts the unmatched fixture prints `Plan growth: plan unresolved; 0 added` with no `(config-derived cap)`, and JSON `planGrowth.cap` null with `authoredSource` `'unresolved'`.
- [test] `kickback-budget.test.ts` asserts the Story 2 fixture's JSON `planGrowth` is authored 24, added 9, cap 12, remaining 3, and the raised variant prints `(raised cap)` with cap 20.
- [test] `kickback-budget.test.ts` asserts inspect on the reconciliation fixture reports `planGrowth.authored` 10 and leaves `.pipeline/kickback-ledger.json` byte-identical.
- [test] The existing `Plan growth: 6/2 added; 0 remaining (config-derived cap)` assertion and the other `kickback-budget.test.ts` and `kickback-budget-view.test.ts` cases pass.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — `planGrowthViewFor`
- `src/conductor/src/engine/kickback-budget-view.ts` — view type and unresolved rendering
- `src/conductor/test/cli/kickback-budget.test.ts` — daemon-feature inspect cases
- `src/conductor/test/engine/kickback-budget-view.test.ts` — fixture field

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 ─┬→ Task 4
                          ├→ Task 5
                          ├→ Task 6
                          ├→ Task 7
                          └→ Task 8
```

Tasks 4 and 5 and 6 all edit `conductor.ts` in distinct functions (`planRemediation`, `settleBuildPendingRepair`, `refusalReworkAllowanceAvailable`); Tasks 4 and 5 also share `remediation-caps.ts` and its test file.

## Integration Points

- After Task 3: the shared budget is callable and unit-proven.
- After Task 6: a daemon `Conductor.run` reaches the shared budget through refusal-rework admission (engine entry point).
- After Tasks 7 and 8: both operator CLIs render the shared budget.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon feature worktree whose `<slug>.md` holds 17 task headings, no kickback growth record, and default config, when `ai-conductor daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: authored 17; added 0; remaining 4/4`. | 7 | "asserts `runDaemonStatus` prints `PLAN GROWTH [<slug>]: authored 17; added 0; remaining 4/4` for the no-`activePlanPath` 17-heading fixture" | diff-local |
| Story 1 happy: Given the same worktree, when `ai-conductor kickback-budget inspect --feature <slug>` runs, then it prints `Plan growth: 0/4 added; 4 remaining (config-derived cap)`, and its `--format json` output reports `planGrowth.authored` 17 and `planGrowth.cap` 4. | 8 | "asserts inspect prints `Plan growth: 0/4 added; 4 remaining (config-derived cap)` and JSON `planGrowth.authored` 17, `planGrowth.cap` 4 for the 17-heading daemon fixture" | diff-local |
| Story 1 happy: Given a worktree whose `.pipeline/engine-state.json` records an `activePlanPath` naming the plan-corpus file `other.md` (5 task headings) while `<slug>.md` holds 17, when `daemon status` renders the feature, then it reports `authored 5`. | 7 | "asserts the recorded-`activePlanPath` fixture prints `authored 5;`" | diff-local |
| Story 1 negative: Given a worktree with no `activePlanPath`, several plans, none whose stem equals the conduct-state feature, no growth record, and no raised growth cap, when `daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: plan unresolved; added 0` and contains no `remaining 0/0`; and `kickback-budget inspect` prints `Plan growth: plan unresolved; 0 added` instead of a numeric config-derived cap. | 7, 8 | "the unmatched fixture prints `PLAN GROWTH [<slug>]: plan unresolved; added 0` with no `remaining 0/0`" | diff-local |
| Story 1 negative: Given a daemon feature worktree with no pending budget adjustment, whose stored growth record `{authored: 0, added: 2, byGate: {prd_audit: 2}}` disagrees with its resolved plan (12 headings), when `kickback-budget inspect` runs, then it reports `planGrowth.authored` 10 and `.pipeline/kickback-ledger.json` is byte-identical before and after the command. | 8 | "asserts inspect on the reconciliation fixture reports `planGrowth.authored` 10 and leaves `.pipeline/kickback-ledger.json` byte-identical" | diff-local |
| Story 2 happy: Given a daemon feature worktree whose `<slug>.md` holds 24 `### Task <n>:` headings and 9 `### Task rem-…:` headings, a stored growth record `{authored: 0, added: 9, byGate: {prd_audit: 5, architecture_review_as_built: 4}}`, and config `prd_audit.max_appended_tasks: 30`, `prd_audit.max_appended_ratio: 0.5`, when `daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: authored 24; added 9 (prd_audit: 5, architecture_review_as_built: 4); remaining 3/12`, and `kickback-budget inspect --format json` reports `planGrowth` authored 24, added 9, cap 12, remaining 3. | 7, 8 | "asserts the Story 2 fixture prints `authored 24; added 9 (prd_audit: 5, architecture_review_as_built: 4); remaining 3/12`" | diff-local |
| Story 2 happy: Given the same feature and a pending repair charging `prd_audit` growth 3, when pending-repair settlement runs with the growth budget the engine computes for that feature, then the repair settles and the recorded growth becomes added 12 with `prd_audit` 8. | 5 | "asserts `settlePendingRepair` with `pendingRepairSettlementBudgets` on the Story 2 fixture settles a growth-3 charge and persists growth added 12 with `prd_audit` 8" | diff-local |
| Story 2 happy: Given the same feature, when the engine reads the `prd_audit` remediation append budget, then its growth cap is 12, not 16 (the cap a count of all 33 headings would produce). | 4 | "asserts `readRemediationGateAppendBudget` for `prd_audit` on the Story 2 fixture returns growthCap 12, not 16, and growth authored 24" | diff-local |
| Story 2 negative: Given the same feature and a pending repair charging `prd_audit` growth 4, when pending-repair settlement runs with the growth budget the engine computes for that feature, then settlement reports `exhausted` for `prd_audit` with allowance `growth`, and the recorded growth stays added 9. | 5 | "asserts the same composition refuses a growth-4 charge as `exhausted`/`growth` for `prd_audit` and leaves recorded growth added 9" | diff-local |
| Story 2 negative: Given a worktree with no resolvable plan, no growth record, and no raised growth cap, and a pending repair charging growth 1, when pending-repair settlement runs with the growth budget the engine computes, then settlement still reports `exhausted` with allowance `growth` (unresolved stays fail-closed). | 5 | "asserts the unresolvable, unraised fixture refuses a growth-1 charge as `exhausted`/`growth`" | diff-local |
| Story 2 negative: Given a stored raised `effectiveGrowthCap` of 20 on the Story 2 fixture, when `daemon status`, `kickback-budget inspect`, and the engine's growth budget are read, then all three use cap 20, and inspect labels it `raised cap`. | 3, 7, 8 | "the raised variant prints `(raised cap)` with cap 20" | diff-local |
| Story 3 happy: Given a daemon conductor run whose worktree has no `activePlanPath`, conduct-state feature `feature`, a plan-corpus file `feature.md` with 8 authored task headings beside a second plan, default config, and a `prd_audit` verdict that is an over-scope refusal, when the validation group routes refusal rework, then `/remediate` is dispatched exactly once and no HALT is written for the refusal-rework allowance. | 6 | "asserts a daemon `Conductor.run` with no `activePlanPath` and a slug-matched 8-task plan beside a second plan dispatches `remediate` exactly once for an over-scope refusal" | diff-local |
| Story 3 negative: Given the same run except that no plan-corpus file has the stem `feature`, when the validation group routes refusal rework, then `/remediate` is not dispatched and `.pipeline/HALT` is written for the refusal rework, as it is today. | 6 | "asserts the same run with no plan whose stem is `feature` dispatches no `remediate` and writes a `.pipeline/HALT` containing `Refused — rework required: S2.1.`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
