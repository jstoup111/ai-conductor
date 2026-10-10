# Implementation Plan: coverage_binding lap-cap halt has a supported recovery (#2846)

**Date:** 2026-10-10
**Design:** .docs/decisions/architecture-review-2026-10-10-coverage-binding-lap-cap-halt-has-no-supported-rec.md
**Stories:** .docs/stories/coverage-binding-lap-cap-halt-has-no-supported-rec.md
**Conflict check:** Clean as of 2026-10-10 (one degrading overlap resolved by ADR amendment)

## Summary

Admit `coverage_binding` to the operator `kickback-budget` recovery family as a feature-scoped lap-budgeted gate, so its lap-cap halt is recovered through `raise`/`reset` and the next dispatch reopens the bound tasks. 10 tasks.

## Technical Approach

- **One lap-gate predicate (Task 1).** `isLapBudgetedGate` in `kickback-ledger.ts` names `prd_audit`, `architecture_review_as_built`, `coverage_binding`; it replaces the four duplicated literal checks in staging/apply evidence comparison, apply arithmetic, the budget view, and the CLI, so a gate admitted to the grammar can never be budgeted as cumulative (`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D6.2).
- **Raised cap honored at settlement (Task 2).** `settleRemediationRound` compares against `effectiveLapCap ?? lapCap` under the existing lease. The default cap (`remediationLapCapForGate`, 2) and the no-config-key rule are unchanged (D6.4).
- **CLI and halt-class admission (Tasks 3, 3.1, 3.3).** `GATES` gains `coverage_binding`; its default comes from `remediationLapCapForGate`; `RECOVERABLE_CAP_HALT_CLASS_BY_GATE.coverage_binding = 'needs-human'` (D6.1, D6.3). The daemon sweep then works unchanged (Task 3.2).
- **Evidence at the cap halt (Tasks 4, 4.1).** The coverage_binding reopen, on `capExceeded`, records D2 typed cap evidence and returns a `needs-human` refusal whose reason carries `renderKickbackRecoveryHint` and the `Kickback halt generation:` line; the conductor refusal branch writes it verbatim (D6.3).
- **Reopen eligibility survives the halt (Task 5).** On the judge-enabled path a cap-exceeded failure no longer overwrites the invalidated envelope with `failed`, so the post-grant rerun still reopens (D6.5).
- **Feature-scoped on stacked features (Task 6).** coverage_binding is resolved in the feature ledger by the CLI and the sweep; `--child` is refused for it (D6.6, `adr-2026-10-07-per-child-build-region` amendment to decisions 10 and 11).

Pattern basis (repeated in the affected tasks): the `prd_audit` lap path — evidence recorded under the lease before the halt, `effectiveLapCap ?? default` read where the cap is enforced, the shared recovery-hint renderer, the generation line in the halt body. Search hints: `settleBuildPendingRepair` in `conductor.ts`, `recordKickbackCapEvidence` in `kickback-ledger.ts`. Allowed variation: coverage_binding charges at restage time and halts `needs-human`.

Sequencing: Task 1 first (shared predicate); Tasks 2 and 3 in parallel; 3.1, 3.2, 3.3 after 3; 4 after 2; 4.1 after 3 and 4; 5 after 4.1 (same file); 6 after 3 and 3.2.

## Prerequisites

- None.

## Tasks

### Task 1: One shared lap-budgeted gate predicate drives ledger and view arithmetic
**Story:** Story 2, Story 4
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts` and `src/conductor/test/engine/kickback-budget-view.test.ts`: a coverage_binding entry with cap evidence (allowance `laps`, consumed 2, limit 2) staged and applied as a `raise` to 3 yields `effectiveLapCap` 3, `laps` 2, and no `effectiveLimit`; a `reset` yields `laps` 0 with `effectiveLapCap` unchanged; `kickbackBudgetView` for coverage_binding reports consumed from `laps` and limit from `effectiveLapCap`.
2. Verify the tests fail (RED): today coverage_binding is treated as cumulative.
3. Implement: export `isLapBudgetedGate(gate)` from `src/conductor/src/engine/kickback-ledger.ts` returning true for exactly `prd_audit`, `architecture_review_as_built`, and `coverage_binding`. Replace the literal `gate === 'prd_audit' || gate === 'architecture_review_as_built'` predicates in `capEvidenceAgreesWithAdjustment` and `applyKickbackBudgetAdjustment`, and in `kickbackBudgetView` / `renderKickbackBudgetView` in `src/conductor/src/engine/kickback-budget-view.ts`, with it. Pattern: the existing `prd_audit` lap arithmetic (laps vs effectiveLapCap) is the trait to preserve; build_review keeps cumulative vs effectiveLimit.
4. Verify GREEN, including the existing build_review, prd_audit, and as-built ledger and view tests unchanged.
5. Commit.

**Done when:**
- [test] `applyKickbackBudgetAdjustment` on a coverage_binding raise from 2 to 3 writes `effectiveLapCap` 3, keeps `laps` 2, and writes no `effectiveLimit`, as asserted in kickback-ledger.test.ts.
- [test] `applyKickbackBudgetAdjustment` on a coverage_binding reset writes `laps` 0 and leaves `effectiveLapCap` unchanged, as asserted in kickback-ledger.test.ts.
- [test] `kickbackBudgetView` for coverage_binding reports consumed from `laps` and limit from `effectiveLapCap ?? fallbackLimit`, as asserted in kickback-budget-view.test.ts.
- `isLapBudgetedGate` is the only lap-gate predicate: no literal `gate === 'prd_audit' || gate === 'architecture_review_as_built'` comparison remains in kickback-ledger.ts or kickback-budget-view.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/src/engine/kickback-budget-view.ts`
- `src/conductor/test/engine/kickback-ledger.test.ts`
- `src/conductor/test/engine/kickback-budget-view.test.ts`

**Dependencies:** none

### Task 2: coverage_binding settlement honors the feature-local raised lap cap
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/repair-restage.test.ts`, `admitAndRestageRepair` with gates `['coverage_binding']`, lapCap 2, and a ledger holding `gates.coverage_binding` laps 2 with `effectiveLapCap` 3 restages and charges laps to 3; in `src/conductor/test/engine/coverage-binding-runner.test.ts`, an invalidated envelope with a changed criterion bound to a completed task, laps 2 and `effectiveLapCap` 3, runs the coverage_binding step and reopens the task.
2. Verify RED: today settlement compares against the passed default cap only.
3. Implement: in `settleRemediationRound` (`src/conductor/src/engine/kickback-ledger.ts`), when a `lapCap` is supplied, compare each gate against `ledger.gates[gate]?.effectiveLapCap ?? lapCap`, read under the existing ledger lease. The `admitAndRestageRepair` call that passes no `lapCap` keeps its no-cap behavior. Pattern: mirror the BUILD pending-repair settlement in conductor.ts (`settleBuildPendingRepair`), which reads `effectiveLapCap ?? remediationLapCapForGate(gate, config)`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `settleRemediationRound` with lapCap 2 settles a coverage_binding round when `effectiveLapCap` is 3 and laps are 2, and refuses with `capExceeded` `coverage_binding` when `effectiveLapCap` is absent and laps are 2, as asserted in repair-restage.test.ts.
- [test] Running the coverage_binding step on a feature with laps 2 and `effectiveLapCap` 3 reopens every bound completed task, emits one `coverage_binding_task_reopened` event per task, leaves `gates.coverage_binding.laps` at 3, returns success, and writes no `.pipeline/HALT`, as asserted in coverage-binding-runner.test.ts.
- [test] Replaying `admitAndRestageRepair` for an admission whose settlement receipt is already recorded charges no second lap (laps unchanged), as asserted in repair-restage.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/test/engine/repair-restage.test.ts`
- `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Dependencies:** Task 1

### Task 3: kickback-budget raise and reset accept coverage_binding
**Story:** Story 2, Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts` against `dispatchKickbackBudgetCommand` with an interactive terminal, a resolved operator, a live HALT of class `needs-human` whose body carries `Kickback halt generation: G`, and a ledger whose `gates.coverage_binding` has laps 2 and cap evidence (gate coverage_binding, allowance laps, consumed 2, limit 2, generation G).
2. Verify RED: today the command prints `kickback-budget: invalid gate or rationale.`.
3. Implement in `src/conductor/src/engine/kickback-budget-cli.ts`: add `coverage_binding` to `GATES`; derive the coverage_binding default from `remediationLapCapForGate('coverage_binding', config)` in `defaultsFor`; replace `gate !== 'build_review'` with `isLapBudgetedGate(gate)`. In `src/conductor/src/engine/halt-classification.ts` add `coverage_binding: 'needs-human'` to `RECOVERABLE_CAP_HALT_CLASS_BY_GATE`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `raise --gate coverage_binding --by 1` with a non-empty rationale exits 0 and leaves `effectiveLapCap` 3, `laps` 2, and one adjustment `{kind raise, beforeLimit 2, afterLimit 3, operator, rationale, haltGeneration G}`, as asserted in kickback-budget.test.ts.
- [test] `reset --gate coverage_binding` with a non-empty rationale leaves `laps` 0, `effectiveLapCap` unchanged, and one adjustment `{kind reset}` carrying the rationale, as asserted in kickback-budget.test.ts.
- [test] After a coverage_binding grant, `.pipeline/events.jsonl` holds one `kickback_budget_adjustment_authorized` event with gate coverage_binding and the same adjustmentId, kind, rationale, beforeLimit, afterLimit, beforeConsumed, and afterConsumed, and `gates.coverage_binding.resumeAuthorization` is `{adjustmentId, haltGeneration G, consumed false}`, as asserted in kickback-budget.test.ts.
- [test] After a coverage_binding grant, the ledger's `build_review`, `prd_audit`, and `architecture_review_as_built` entries serialize byte-identical to their pre-grant serialization, as asserted in kickback-budget.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/src/engine/halt-classification.ts`
- `src/conductor/test/cli/kickback-budget.test.ts`

**Dependencies:** Task 1

### Task 3.1: kickback-budget refuses invalid coverage_binding requests without side effects
**Story:** Story 2, Story 5
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/cli/kickback-budget.test.ts` using the Task 3 fixture, recording calls to an injected park dispatcher and the ledger file bytes before and after each call.
2. Verify RED where behavior is new (the coverage_binding live-halt mismatch cases) and that the refusals are reached for coverage_binding rather than the gate-name refusal.
3. Implement any guard ordering needed in `src/conductor/src/engine/kickback-budget-cli.ts` so each refusal happens before staging.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] With `isInteractive` false, `raise --gate coverage_binding` prints `kickback-budget: mutations require an interactive local operator terminal.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical, as asserted in kickback-budget.test.ts.
- [test] When the live HALT is another gate's cap halt, or its `Kickback halt generation:` differs from the coverage_binding cap evidence, `raise --gate coverage_binding` exits 1 with a `kickback-budget: refused` message and leaves the coverage_binding entry and `.pipeline/HALT` bytes identical, as asserted in kickback-budget.test.ts.
- [test] With no `.pipeline/HALT`, `raise --gate coverage_binding` prints `kickback-budget: refused — feature is not currently halted` and the coverage_binding entry has no `pendingAdjustment`, as asserted in kickback-budget.test.ts.
- [test] For gate `coverage_bind` on both `raise` and `reset`, and for `raise` on coverage_binding with an empty, a whitespace-only, and a 2001-byte rationale, the command prints `kickback-budget: invalid gate or rationale.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical, as asserted in kickback-budget.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/test/cli/kickback-budget.test.ts`

**Dependencies:** Task 3

### Task 3.2: The daemon sweep consumes a coverage_binding authorization
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-rekick.test.ts` calling `consumeResumeAuthorizations` with a halted feature whose live halt class is `needs-human`, whose live generation is G, and whose ledger `gates.coverage_binding` holds cap evidence for G plus an unconsumed resume authorization for G.
2. Verify RED: today the sweep logs that `needs-human` is not coverage_binding's recoverable cap halt and retains it.
3. Implement: no sweep change beyond Task 3's `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` entry is expected; if the test exposes another gate-name assumption in `src/conductor/src/engine/daemon-rekick.ts`, route it through the map.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `consumeResumeAuthorizations` with a matching coverage_binding authorization calls `clearHalt` for the slug, emits `{type halt_cleared, cause kickback-budget}`, returns the slug in its cleared list, and leaves `gates.coverage_binding.resumeAuthorization.consumed` true, as asserted in daemon-rekick.test.ts.
- [test] With coverage_binding cap evidence but no resume authorization, `consumeResumeAuthorizations` never calls `clearHalt`, emits no `halt_cleared`, and returns an empty cleared list, as asserted in daemon-rekick.test.ts.
- [test] When `isOperatorParked` is true for the slug, `consumeResumeAuthorizations` never calls `clearHalt` and the coverage_binding authorization stays `consumed: false`, as asserted in daemon-rekick.test.ts.

**Files likely touched:**
- `src/conductor/test/engine/daemon-rekick.test.ts`
- `src/conductor/src/engine/daemon-rekick.ts`

**Dependencies:** Task 3

### Task 3.3: kickback-budget inspect lists coverage_binding
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts` for `inspect` in human and JSON formats over ledgers with and without a coverage_binding entry.
2. Verify RED: today inspect lists only three gates.
3. Implement: inspect iterates `GATES` (now including coverage_binding) with the coverage_binding default from `defaultsFor`; no other change expected in `src/conductor/src/engine/kickback-budget-cli.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] Human `inspect` over a ledger with coverage_binding laps 2 and no adjustments prints a coverage_binding block with consumed 2 and limit 2 in addition to the build_review, prd_audit, and architecture_review_as_built blocks, as asserted in kickback-budget.test.ts.
- [test] JSON `inspect` after an applied coverage_binding raise from 2 to 3 reports for gate coverage_binding consumed 2, limit 3, an `adjustments` array holding that raise with its rationale, and a `resumeAuthorization` object with a `state`, as asserted in kickback-budget.test.ts.
- [test] JSON `inspect` over a ledger with no coverage_binding entry reports gate coverage_binding with consumed 0, limit 2, and `adjustments: []`, as asserted in kickback-budget.test.ts.
- [test] With a coverage_binding entry that fails validation, `inspect` prints `coverage_binding: budget unavailable (durable entry failed validation)`, still renders the other three gates, and exits 1, as asserted in kickback-budget.test.ts.
- [test] With a coverage_binding resume authorization bound to generation A while the live HALT carries generation B, human `inspect` prints the coverage_binding `Resume authorization:` line as `stale (bound to halt generation A; live halt generation B); the daemon will not consume it`, as asserted in kickback-budget.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/test/cli/kickback-budget.test.ts`

**Dependencies:** Task 3

### Task 4: The coverage_binding cap halt records typed cap evidence and names its recovery
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`: an invalidated envelope with a changed criterion bound to a completed task and `gates.coverage_binding.laps` 2 with no `effectiveLapCap`, run once with the judge disabled and once with it enabled, and also through the conductor step dispatch in `src/conductor/test/engine/conductor-kickback-ledger.test.ts` to observe the written HALT.
2. Verify RED: today no cap evidence is recorded and the HALT carries no generation line or recovery command.
3. Implement in the coverage_binding reopen in `src/conductor/src/engine/step-runners.ts`: when `admitAndRestageRepair` returns `capExceeded`, call `recordKickbackCapEvidence(projectDir, 'coverage_binding', {consumed, limit, latestReason, allowance: 'laps'})` with consumed = current laps and limit = `effectiveLapCap ?? remediationLapCapForGate('coverage_binding', config)`, then build the refusal reason as the existing `coverage_binding could not reopen contradicted work:` text, a newline, `renderKickbackRecoveryHint({slug: featureDesc, gate: 'coverage_binding', allowance: 'laps'})`, and `Kickback halt generation: <generation>`. Share one helper between the judge-disabled and judge-enabled branches. Pattern: the BUILD pending-repair cap halt in conductor.ts (`settleBuildPendingRepair`) records evidence before the halt and appends the generation line; the variation allowed is class `needs-human` (the conductor refusal branch already writes it).
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] With the judge disabled and laps equal to the effective cap, the conductor writes `.pipeline/HALT.class` `needs-human` and `gates.coverage_binding.capEvidence` holds gate `coverage_binding`, allowance `laps`, consumed 2, limit 2, and a non-empty haltGeneration, as asserted in conductor-kickback-ledger.test.ts.
- [test] The written `.pipeline/HALT` contains the line `Kickback halt generation: <capEvidence.haltGeneration>` and the text `ai-conductor kickback-budget raise --feature <featureDesc> --gate coverage_binding --by «N» --rationale "«why»"` with the fixture slug, as asserted in conductor-kickback-ledger.test.ts.
- [test] With the judge enabled, the same cap produces a refusal of kind `needs-human` whose reason carries the same generation line and recovery command, and the same capEvidence fields are recorded, as asserted in coverage-binding-runner.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts`

**Dependencies:** Task 2

### Task 4.1: Below-cap, unreadable, conflict, and re-halt cases of the coverage_binding cap
**Story:** Story 1, Story 3
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` and `src/conductor/test/cli/kickback-budget.test.ts` for each case below.
2. Verify RED where behavior is new (the re-halt after a grant writes fresh evidence).
3. Implement any adjustment needed in `src/conductor/src/engine/step-runners.ts`: evidence is recorded only on `capExceeded`, never on a below-cap reopen, an unreadable-ledger failure, or a plan-conflict refusal.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] With laps 1 and cap 2, the coverage_binding step reopens the bound tasks, leaves laps 2, records no `capEvidence`, and writes no `.pipeline/HALT`, as asserted in coverage-binding-runner.test.ts.
- [test] With an unreadable `gates.coverage_binding` entry, the step reopens no task, charges no lap, and records no `capEvidence`, and a following `raise --gate coverage_binding` exits 1 leaving the ledger bytes identical, as asserted in coverage-binding-runner.test.ts and kickback-budget.test.ts.
- [test] When the step refuses with `coverage_binding refused: plan tasks conflict`, its reason has no `Kickback halt generation:` line, no coverage_binding `capEvidence` is recorded, and `raise --gate coverage_binding` exits 1 with `kickback-budget: refused — no current cap evidence for that gate`, as asserted in coverage-binding-runner.test.ts and kickback-budget.test.ts.
- [test] After a consumed grant raised `effectiveLapCap` to 3 and laps reached 3, a further changed criterion halts the step again with `capEvidence.limit` 3 and a haltGeneration different from the earlier one, while the earlier `resumeAuthorization` stays `consumed: true`, as asserted in coverage-binding-runner.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `src/conductor/test/cli/kickback-budget.test.ts`

**Dependencies:** Tasks 3, 4

### Task 5: A cap-exceeded reopen keeps the envelope reopen-eligible on the judge-enabled path
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/coverage-binding-runner.test.ts`: with the judge enabled, an invalidated envelope, laps 2 at cap 2, run the step (it halts), apply a raise to 3 to the ledger, and run the step again.
2. Verify RED: today the first run writes envelope status `failed`, so the second run is reopen-ineligible and does not reopen the task.
3. Implement in `src/conductor/src/engine/step-runners.ts`: on a `capExceeded` reopen failure in the judge-enabled branch, do not overwrite the invalidated envelope with status `failed`; leave the predecessor envelope in place so `previousReopenEligible` holds on the next run. A non-cap reopen failure keeps writing `failed` as today.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] With the judge enabled, after a cap halt `.pipeline/coverage-binding.json` still has status `invalidated`, as asserted in coverage-binding-runner.test.ts.
- [test] With the judge enabled, after a raise from 2 to 3 the second coverage_binding run reopens every bound completed task, emits one `coverage_binding_task_reopened` per task, and leaves laps 3, as asserted in coverage-binding-runner.test.ts.
- [test] With the judge enabled, a reopen failure without `capExceeded` (an admission persistence failure) still writes envelope status `failed`, as asserted in coverage-binding-runner.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Dependencies:** Task 4.1

### Task 6: coverage_binding is resolved in the feature ledger on stacked features
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests on a fixture with `.pipeline/children/1/` and `.pipeline/children/2/`, active child 2, a feature-ledger coverage_binding cap halt, and child 2 ledger entries: in `src/conductor/test/cli/kickback-budget.test.ts` for raise and inspect, and in `src/conductor/test/engine/daemon-rekick.test.ts` for `consumeResumeAuthorizations`.
2. Verify RED: today raise resolves the active child ledger and refuses for missing cap evidence.
3. Implement: export a feature-scoped gate set (`coverage_binding`) beside `isLapBudgetedGate` in `src/conductor/src/engine/kickback-ledger.ts`. In `src/conductor/src/engine/kickback-budget-cli.ts`, for a feature-scoped gate pass `child` undefined to every ledger read, stage, and apply, and refuse an explicit `--child` with `kickback-budget: coverage_binding is feature-scoped; omit --child.`; inspect reads feature-scoped gates from the feature ledger and the others from the selected child ledger. In `src/conductor/src/engine/daemon-rekick.ts`, when children exist, also read the feature ledger and consider only its feature-scoped gate entries as candidates; consume via `consumeKickbackResumeAuthorization` with child undefined for them.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] On the stacked fixture, `raise --gate coverage_binding --by 1` without `--child` applies `effectiveLapCap` 3 to the feature ledger's coverage_binding entry and leaves `.pipeline/children/2/kickback-ledger.json` bytes identical, as asserted in kickback-budget.test.ts.
- [test] On the stacked fixture, `consumeResumeAuthorizations` finds the feature-ledger coverage_binding authorization, calls `clearHalt`, and leaves it `consumed: true` in the feature ledger, as asserted in daemon-rekick.test.ts.
- [test] On the stacked fixture, JSON `inspect` reports coverage_binding from the feature ledger and build_review from child 2's ledger, as asserted in kickback-budget.test.ts.
- [test] `raise --gate coverage_binding --child 2` prints `kickback-budget: coverage_binding is feature-scoped; omit --child.`, exits 1, and leaves both ledgers bytes identical, as asserted in kickback-budget.test.ts.
- [test] When child 2's ledger holds an unconsumed build_review authorization bound to another generation, consuming the coverage_binding grant leaves that child authorization `consumed: false` and child 2's ledger bytes identical, as asserted in daemon-rekick.test.ts.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/cli/kickback-budget.test.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** Tasks 3, 3.2

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ──▶ Task 4 ─┐
        │                       ├─▶ Task 4.1 ──▶ Task 5
        └─▶ Task 3 ─┬───────────┘
                    ├─▶ Task 3.1
                    ├─▶ Task 3.2 ─┐
                    ├─▶ Task 3.3  ├─▶ Task 6
                    └─────────────┘
```

## Integration Points

- After Task 3: an operator `raise`/`reset` on a coverage_binding cap halt is accepted end to end through `dispatchKickbackBudgetCommand`.
- After Task 3.2: the daemon sweep clears a granted coverage_binding halt.
- After Task 4: the conductor writes a recoverable coverage_binding cap halt.
- After Task 5: halt, grant, sweep, and rerun reopen the bound tasks on both judge branches.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose `gates.coverage_binding` laps equal its effective cap, when the coverage_binding step must reopen completed tasks for a changed criterion, then the feature halts with class `needs-human` and the feature ledger's `gates.coverage_binding` holds cap evidence naming gate `coverage_binding`, allowance `laps`, the consumed laps, the effective cap as the limit, and a halt generation. | 4 | "With the judge disabled and laps equal to the effective cap, the conductor writes `.pipeline/HALT.class` `needs-human` and `gates.coverage_binding.capEvidence` holds gate `coverage_binding`, allowance `laps`, consumed 2, limit 2, and a non-empty haltGeneration" | diff-local |
| Story 1 happy: Given that halt, when the operator reads `.pipeline/HALT`, then it contains a `Kickback halt generation:` line equal to the recorded generation and the exact command `ai-conductor kickback-budget raise --feature <slug> --gate coverage_binding --by «N» --rationale "«why»"` with the feature's slug. | 4 | "The written `.pipeline/HALT` contains the line `Kickback halt generation: <capEvidence.haltGeneration>` and the text `ai-conductor kickback-budget raise --feature <featureDesc> --gate coverage_binding --by «N» --rationale "«why»"` with the fixture slug" | diff-local |
| Story 1 happy: Given the same cap is reached on the judge-enabled coverage_binding path, when the step halts, then the halt carries the same cap evidence, generation line, and recovery command as the judge-disabled path. | 4 | "With the judge enabled, the same cap produces a refusal of kind `needs-human` whose reason carries the same generation line and recovery command, and the same capEvidence fields are recorded" | diff-local |
| Story 1 negative: Given `gates.coverage_binding` laps are below the effective cap, when the step reopens bound tasks, then one lap is charged, the tasks are reopened, and no cap evidence is recorded and no HALT is written. | 4.1 | "With laps 1 and cap 2, the coverage_binding step reopens the bound tasks, leaves laps 2, records no `capEvidence`, and writes no `.pipeline/HALT`" | diff-local |
| Story 1 negative: Given the feature ledger's coverage_binding entry is unreadable, when the step must reopen bound tasks, then it reopens nothing, charges no lap, records no cap evidence, and a later `raise --gate coverage_binding` is refused with no ledger change. | 4.1 | "With an unreadable `gates.coverage_binding` entry, the step reopens no task, charges no lap, and records no `capEvidence`, and a following `raise --gate coverage_binding` exits 1 leaving the ledger bytes identical" | diff-local |
| Story 1 negative: Given the coverage_binding step refuses a plan conflict with sealed criteria or ADR decisions, when it halts, then the halt carries no coverage_binding cap evidence or generation line and `raise --gate coverage_binding` is refused because no current cap evidence exists. | 4.1 | "When the step refuses with `coverage_binding refused: plan tasks conflict`, its reason has no `Kickback halt generation:` line, no coverage_binding `capEvidence` is recorded, and `raise --gate coverage_binding` exits 1 with `kickback-budget: refused — no current cap evidence for that gate`" | diff-local |
| Story 2 happy: Given a live coverage_binding cap halt with laps 2 and effective cap 2, when the operator runs `raise --gate coverage_binding --by 1` with a non-empty rationale from an interactive terminal, then the command succeeds, the effective cap becomes 3, laps stay 2, and the gate's adjustment history gains one `raise` entry with before limit 2, after limit 3, the operator, the rationale, and the halt generation. | 3 | "`raise --gate coverage_binding --by 1` with a non-empty rationale exits 0 and leaves `effectiveLapCap` 3, `laps` 2, and one adjustment `{kind raise, beforeLimit 2, afterLimit 3, operator, rationale, haltGeneration G}`" | diff-local |
| Story 2 happy: Given the same halt, when the operator runs `reset --gate coverage_binding` with a non-empty rationale, then laps become 0, the effective cap is unchanged, and the adjustment history gains one `reset` entry carrying the rationale. | 3 | "`reset --gate coverage_binding` with a non-empty rationale leaves `laps` 0, `effectiveLapCap` unchanged, and one adjustment `{kind reset}` carrying the rationale" | diff-local |
| Story 2 happy: Given a successful grant, when the events ledger is read, then it holds one `kickback_budget_adjustment_authorized` event for gate `coverage_binding` with the same adjustment id, kind, rationale, and before and after values, and the gate holds an unconsumed resume authorization bound to the live halt generation. | 3 | "After a coverage_binding grant, `.pipeline/events.jsonl` holds one `kickback_budget_adjustment_authorized` event with gate coverage_binding and the same adjustmentId, kind, rationale, beforeLimit, afterLimit, beforeConsumed, and afterConsumed, and `gates.coverage_binding.resumeAuthorization` is `{adjustmentId, haltGeneration G, consumed false}`" | diff-local |
| Story 2 negative: Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run from a non-interactive process, then it is refused with `mutations require an interactive local operator terminal` and the ledger and park state are unchanged. | 3.1 | "With `isInteractive` false, `raise --gate coverage_binding` prints `kickback-budget: mutations require an interactive local operator terminal.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical" | diff-local |
| Story 2 negative: Given the feature's live HALT is not a coverage_binding cap halt (another gate's halt, or a halt whose generation differs from the coverage_binding cap evidence), when `raise --gate coverage_binding` is run, then it is refused and the ledger's coverage_binding entry and the HALT are unchanged. | 3.1 | "When the live HALT is another gate's cap halt, or its `Kickback halt generation:` differs from the coverage_binding cap evidence, `raise --gate coverage_binding` exits 1 with a `kickback-budget: refused` message and leaves the coverage_binding entry and `.pipeline/HALT` bytes identical" | diff-local |
| Story 2 negative: Given the feature is not halted, when `raise --gate coverage_binding` is run, then it is refused with `feature is not currently halted` and no adjustment is staged. | 3.1 | "With no `.pipeline/HALT`, `raise --gate coverage_binding` prints `kickback-budget: refused — feature is not currently halted` and the coverage_binding entry has no `pendingAdjustment`" | diff-local |
| Story 2 negative: Given a grant on coverage_binding, when the ledger is read, then the `build_review`, `prd_audit`, and `architecture_review_as_built` entries, including their counts, limits, and adjustment histories, are byte-identical to before the grant. | 3 | "After a coverage_binding grant, the ledger's `build_review`, `prd_audit`, and `architecture_review_as_built` entries serialize byte-identical to their pre-grant serialization" | diff-local |
| Story 3 happy: Given a coverage_binding cap halt and a grant that raised the effective cap from 2 to 3, when the daemon's resume-authorization sweep runs, then it clears the HALT, emits `halt_cleared` with cause `kickback-budget`, and marks the authorization consumed. | 3.2 | "`consumeResumeAuthorizations` with a matching coverage_binding authorization calls `clearHalt` for the slug, emits `{type halt_cleared, cause kickback-budget}`, returns the slug in its cleared list, and leaves `gates.coverage_binding.resumeAuthorization.consumed` true" | diff-local |
| Story 3 happy: Given that cleared feature, when coverage_binding runs again, then it reopens the bound completed tasks, emits `coverage_binding_task_reopened` for each, charges laps from 2 to 3, and does not halt. | 2 | "Running the coverage_binding step on a feature with laps 2 and `effectiveLapCap` 3 reopens every bound completed task, emits one `coverage_binding_task_reopened` event per task, leaves `gates.coverage_binding.laps` at 3, returns success, and writes no `.pipeline/HALT`" | diff-local |
| Story 3 happy: Given the halt was produced on the judge-enabled path, when coverage_binding runs again after the grant, then it still reopens the bound tasks rather than completing without reopening them. | 5 | "With the judge enabled, after a raise from 2 to 3 the second coverage_binding run reopens every bound completed task, emits one `coverage_binding_task_reopened` per task, and leaves laps 3" | diff-local |
| Story 3 negative: Given a grant raised the effective cap to 3 and laps reached 3, when a further changed criterion needs another reopen, then coverage_binding halts again with new cap evidence and a new generation, and the consumed authorization is not reused. | 4.1 | "After a consumed grant raised `effectiveLapCap` to 3 and laps reached 3, a further changed criterion halts the step again with `capEvidence.limit` 3 and a haltGeneration different from the earlier one, while the earlier `resumeAuthorization` stays `consumed: true`" | diff-local |
| Story 3 negative: Given no grant was made, when the daemon sweep runs over a coverage_binding cap halt, then the HALT is retained and coverage_binding is not re-dispatched. | 3.2 | "With coverage_binding cap evidence but no resume authorization, `consumeResumeAuthorizations` never calls `clearHalt`, emits no `halt_cleared`, and returns an empty cleared list" | diff-local |
| Story 3 negative: Given the operator parked the feature before the sweep, when the sweep runs, then the authorization is left unconsumed and the HALT is retained until the operator unparks. | 3.2 | "When `isOperatorParked` is true for the slug, `consumeResumeAuthorizations` never calls `clearHalt` and the coverage_binding authorization stays `consumed: false`" | diff-local |
| Story 3 negative: Given the rerun replays an admission already settled before the halt, when coverage_binding runs again, then that admission charges no second lap. | 2 | "Replaying `admitAndRestageRepair` for an admission whose settlement receipt is already recorded charges no second lap (laps unchanged)" | diff-local |
| Story 4 happy: Given a feature whose ledger holds `coverage_binding` laps 2 and no adjustments, when `inspect --format human` runs, then the output lists coverage_binding with consumed 2 and limit equal to the default cap alongside build_review, prd_audit, and architecture_review_as_built. | 3.3 | "Human `inspect` over a ledger with coverage_binding laps 2 and no adjustments prints a coverage_binding block with consumed 2 and limit 2 in addition to the build_review, prd_audit, and architecture_review_as_built blocks" | diff-local |
| Story 4 happy: Given a coverage_binding raise from 2 to 3 has been applied, when `inspect --format json` runs, then the coverage_binding gate object reports consumed 2, limit 3, an adjustments array holding that raise with its rationale, and a resume authorization state. | 3.3 | "JSON `inspect` after an applied coverage_binding raise from 2 to 3 reports for gate coverage_binding consumed 2, limit 3, an `adjustments` array holding that raise with its rationale, and a `resumeAuthorization` object with a `state`" | diff-local |
| Story 4 happy: Given a feature with no coverage_binding entry, when `inspect --format json` runs, then coverage_binding is listed with consumed 0, the default cap, and an empty adjustments array. | 3.3 | "JSON `inspect` over a ledger with no coverage_binding entry reports gate coverage_binding with consumed 0, limit 2, and `adjustments: []`" | diff-local |
| Story 4 negative: Given the ledger's coverage_binding entry fails validation, when `inspect` runs, then it reports `coverage_binding: budget unavailable (durable entry failed validation)`, still renders the healthy gates, and exits non-zero. | 3.3 | "With a coverage_binding entry that fails validation, `inspect` prints `coverage_binding: budget unavailable (durable entry failed validation)`, still renders the other three gates, and exits 1" | diff-local |
| Story 4 negative: Given a coverage_binding resume authorization bound to a generation other than the live halt's, when `inspect` runs, then the coverage_binding line reports the authorization as stale with both generations. | 3.3 | "With a coverage_binding resume authorization bound to generation A while the live HALT carries generation B, human `inspect` prints the coverage_binding `Resume authorization:` line as `stale (bound to halt generation A; live halt generation B); the daemon will not consume it`" | diff-local |
| Story 5 happy: Given a live coverage_binding cap halt, when `raise --gate coverage_binding --by 1` is run with a valid rationale, then it is accepted, which shows coverage_binding is now a valid gate. | 3 | "`raise --gate coverage_binding --by 1` with a non-empty rationale exits 0 and leaves `effectiveLapCap` 3, `laps` 2, and one adjustment `{kind raise, beforeLimit 2, afterLimit 3, operator, rationale, haltGeneration G}`" | diff-local |
| Story 5 negative: Given any feature, when `raise` or `reset` names an unknown gate such as `coverage_bind`, then it prints `kickback-budget: invalid gate or rationale.`, exits 2, and takes no park and changes no ledger. | 3.1 | "For gate `coverage_bind` on both `raise` and `reset`, and for `raise` on coverage_binding with an empty, a whitespace-only, and a 2001-byte rationale, the command prints `kickback-budget: invalid gate or rationale.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical" | diff-local |
| Story 5 negative: Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run with an empty or whitespace-only rationale, then it prints `kickback-budget: invalid gate or rationale.`, exits 2, and changes nothing. | 3.1 | "For gate `coverage_bind` on both `raise` and `reset`, and for `raise` on coverage_binding with an empty, a whitespace-only, and a 2001-byte rationale, the command prints `kickback-budget: invalid gate or rationale.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical" | diff-local |
| Story 5 negative: Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run with a rationale longer than 2000 bytes, then it is refused with exit 2 and changes nothing. | 3.1 | "For gate `coverage_bind` on both `raise` and `reset`, and for `raise` on coverage_binding with an empty, a whitespace-only, and a 2001-byte rationale, the command prints `kickback-budget: invalid gate or rationale.`, exits 2, never calls the park dispatcher, and leaves the ledger bytes identical" | diff-local |
| Story 6 happy: Given a feature with child state and an active child, and a coverage_binding cap halt recorded in the feature ledger, when the operator runs `raise --gate coverage_binding` without `--child`, then the grant is applied to the feature ledger and the active child's ledger is unchanged. | 6 | "On the stacked fixture, `raise --gate coverage_binding --by 1` without `--child` applies `effectiveLapCap` 3 to the feature ledger's coverage_binding entry and leaves `.pipeline/children/2/kickback-ledger.json` bytes identical" | diff-local |
| Story 6 happy: Given that grant, when the daemon sweep runs, then it finds the coverage_binding authorization in the feature ledger, clears the HALT, and consumes it. | 6 | "On the stacked fixture, `consumeResumeAuthorizations` finds the feature-ledger coverage_binding authorization, calls `clearHalt`, and leaves it `consumed: true` in the feature ledger" | diff-local |
| Story 6 happy: Given a feature with child state, when `inspect` runs, then coverage_binding is reported from the feature ledger while the child-scoped gates are reported from the active child's ledger. | 6 | "On the stacked fixture, JSON `inspect` reports coverage_binding from the feature ledger and build_review from child 2's ledger" | diff-local |
| Story 6 negative: Given a feature with child state, when `raise --gate coverage_binding --child 2` is run, then it is refused with a message that coverage_binding is feature-scoped and changes no ledger. | 6 | "`raise --gate coverage_binding --child 2` prints `kickback-budget: coverage_binding is feature-scoped; omit --child.`, exits 1, and leaves both ledgers bytes identical" | diff-local |
| Story 6 negative: Given a feature with child state whose active child's ledger holds an unconsumed authorization for a child-scoped gate bound to a different generation, when the coverage_binding grant is consumed, then that child authorization stays unconsumed and its ledger is unchanged. | 6 | "When child 2's ledger holds an unconsumed build_review authorization bound to another generation, consuming the coverage_binding grant leaves that child authorization `consumed: false` and child 2's ledger bytes identical" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | task | task-4 | With the judge disabled and laps equal to the effective cap, the conductor writes `.pipeline/HALT.class` `needs-human` and `gates.coverage_binding.capEvidence` holds gate `coverage_binding`, allowance `laps`, consumed 2, limit 2, and a non-empty haltGeneration |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | task | task-4, task-3.1 | With the judge disabled and laps equal to the effective cap, the conductor writes `.pipeline/HALT.class` `needs-human` and `gates.coverage_binding.capEvidence` holds gate `coverage_binding`, allowance `laps`, consumed 2, limit 2, and a non-empty haltGeneration |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | task | task-3.2 | `consumeResumeAuthorizations` with a matching coverage_binding authorization calls `clearHalt` for the slug, emits `{type halt_cleared, cause kickback-budget}`, returns the slug in its cleared list, and leaves `gates.coverage_binding.resumeAuthorization.consumed` true |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | task | task-3 | `reset --gate coverage_binding` with a non-empty rationale leaves `laps` 0, `effectiveLapCap` unchanged, and one adjustment `{kind reset}` carrying the rationale |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | task | task-4 | The written `.pipeline/HALT` contains the line `Kickback halt generation: <capEvidence.haltGeneration>` and the text `ai-conductor kickback-budget raise --feature <featureDesc> --gate coverage_binding --by «N» --rationale "«why»"` with the fixture slug |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D6 | task | task-1, task-2, task-3, task-4, task-5, task-6 | `applyKickbackBudgetAdjustment` on a coverage_binding raise from 2 to 3 writes `effectiveLapCap` 3, keeps `laps` 2, and writes no `effectiveLimit` |
| adr-2026-10-07-per-child-build-region#D1 | no-change | none | The child cursor derivation and closure refs are untouched; coverage_binding recovery reads no cursor beyond the existing active-child resolution |
| adr-2026-10-07-per-child-build-region#D2 | no-change | none | When a feature has children and the envelope-missing behavior are untouched by this feature |
| adr-2026-10-07-per-child-build-region#D3 | no-change | none | Child branch creation, switching and the leaf move are untouched; no git ref is written by this feature |
| adr-2026-10-07-per-child-build-region#D4 | no-change | none | coverage_binding stays at or before the region with today's behavior; its existing-task reopen keeps charging the feature ledger through `settleRemediationRound(projectRoot, …)` in src/conductor/src/engine/kickback-ledger.ts, unchanged in scope |
| adr-2026-10-07-per-child-build-region#D5 | no-change | none | Acceptance specs per child are untouched |
| adr-2026-10-07-per-child-build-region#D6 | no-change | none | Per-child build, stall detection and the commit hook are untouched |
| adr-2026-10-07-per-child-build-region#D7 | no-change | none | Per-child test_suite and the leaf aggregate are untouched |
| adr-2026-10-07-per-child-build-region#D8 | no-change | none | The base producer and its consumers are untouched |
| adr-2026-10-07-per-child-build-region#D9 | no-change | none | Child-local build_review and leaf security are untouched |
| adr-2026-10-07-per-child-build-region#D10 | task | task-6 | On the stacked fixture, `consumeResumeAuthorizations` finds the feature-ledger coverage_binding authorization, calls `clearHalt`, and leaves it `consumed: true` in the feature ledger |
| adr-2026-10-07-per-child-build-region#D11 | task | task-6 | `raise --gate coverage_binding --child 2` prints `kickback-budget: coverage_binding is feature-scoped; omit --child.`, exits 1, and leaves both ledgers bytes identical |
| adr-2026-10-07-per-child-build-region#D12 | no-change | none | Rebase guards are untouched |
| adr-2026-10-07-per-child-build-region#D13 | no-change | none | No event type is added; the existing `halt_cleared` and `kickback_budget_adjustment_authorized` events are reused unchanged |
| adr-2026-10-07-per-child-build-region#D14 | no-change | none | With no child, every kickback-budget subcommand resolves the feature ledger for coverage_binding exactly as for every gate today; only the with-children path changes |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
