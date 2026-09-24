# Implementation Plan: offer-ship-or-continue-at-remediation-budget

**Date:** 2026-09-24
**Stories:** .docs/stories/offer-ship-or-continue-at-remediation-budget.md
**Conflict check:** Clean as of 2026-09-24 (1 blocking resolved, 4 degrading accepted)

## Summary

Make every `prd_audit` and `architecture_review_as_built` remediation budget halt recoverable by one `ai-conductor kickback-budget raise`, including plan-growth exhaustion, per adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D5. 10 tasks. Source: jstoup111/ai-conductor#2185 (continue-only; folds #2192).

## Technical Approach

- **Evidence names the allowance.** `KickbackCapEvidence` gains `allowance: 'laps' | 'growth'`. The three budget exits in `planRemediation` (`src/conductor/src/engine/conductor.ts`) already compute the discriminator through `remediationGateAppendBudgetExhausted`; the per-gate exits pass it through, and the shared plan-growth exit, which today writes no evidence and no generation line, starts writing both on `prd_audit` (or `architecture_review_as_built` when prd_audit does not participate). An absent allowance reads as `laps`, which is exactly what pre-change halts wrote, so they recover as they do today.
- **The growth cap is its own ledger field.** `effectiveGrowthCap` sits on `KickbackLedger` beside `growth`, not inside `PlanGrowthRecord`. `readGrowth`'s recompute branches replace only `growth`, so a count recompute (#1805 Story 14) never drops an operator grant; a malformed cap fails the ledger closed (adr-2026-08-31 decision 4). `readRemediationGateAppendBudget` resolves `effectiveGrowthCap ?? prdAuditAppendCap(...)`. It is ledger-level and not lap-counting, so rebase credit leaves it alone.
- **`raise` follows the evidence.** No new flag. `kickback-budget raise --gate G --by N` reads `capEvidence.allowance`: `laps` grows `effectiveLapCap` as today; `growth` grows `effectiveGrowthCap` from `effectiveGrowthCap ?? capEvidence.limit`. The adjustment record and the `kickback_budget_adjustment_authorized` event gain an optional `allowance` field. Park, lease, staging, reconciliation, the resume authorization, and the daemon-side clear are the #2190 machinery, unchanged. `reset` stays laps-only and refuses growth evidence outside the shared refusal helper (conflict-check C4).
- **Operator surfaces.** One renderer in `kickback-budget-view.ts` (08-29 D8) supplies the halt-body recovery hint, the `inspect` growth section, and the allowance names; `daemon-observe-cli.ts` resolves the effective cap for `PLAN GROWTH` and prints `KICKBACK BUDGET` for any gate with cap evidence. The hint text is diagnostic only; nothing parses it.
- **Sequencing.** Task 1 (ledger schema) unblocks everything; Tasks 2, 3, 4, 6, 9, 10 then run in parallel; Task 5 needs 3 and 4; Task 7 needs 6; Task 8 is the cross-boundary integration owner (CLI grant → daemon clear → conductor append) and needs 2, 4, and 6.
- **Release.** The CLI grammar is unchanged and the event field is additive, so no migration block is needed; the implementation PR declares `Release-Disposition: note`, `Release-Category: Changed`, `Release-Semver: minor`.

## Prerequisites

- none

## Tasks

### Task 1: Ledger carries the exhausted allowance and a feature-local effective growth cap
**Story:** 1
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts`: (a) `recordKickbackCapEvidence` persists `allowance: 'growth'` and it round-trips through `readKickbackLedger`; (b) a persisted `capEvidence` with no `allowance` reads back as `allowance: 'laps'` and the ledger is readable; (c) a `capEvidence.allowance` of `'tasks'` makes only that gate appear in `unreadableGates` while a sibling gate keeps its `laps`; (d) a ledger-level `effectiveGrowthCap` of 12 round-trips, and values 0, -1, 1.5, and `'12'` make the ledger `unreadable` rather than being repaired or dropped; (e) `creditKickbackGateLaps` and the rebase credit writer leave `effectiveGrowthCap` unchanged; (f) seed a growth record whose `byGate` total disagrees with `added` plus `effectiveGrowthCap: 12`, call `readGrowth`, and assert the counts are recomputed from the active plan while `effectiveGrowthCap` is still 12 afterwards
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/kickback-ledger.ts`: add `allowance?: 'laps' | 'growth'` to `KickbackCapEvidence` and `KickbackBudgetAdjustment`; normalize an absent evidence allowance to `'laps'` in the gate-entry parser and treat any other value as a malformed gate (the existing `isCapEvidence` gate-scoped path, adr-2026-08-31 decision 3); add ledger-level `effectiveGrowthCap?: number` beside `growth` (never inside `PlanGrowthRecord`, so `readGrowth`'s recompute branches, which spread `...ledger` and replace only `growth`, keep it) and validate it as a positive safe integer, failing the whole ledger closed otherwise (adr-2026-08-31 decision 4: never repaired, defaulted, or inferred)
4. Verify tests pass (GREEN)
5. Commit: "feat(kickback-ledger): typed allowance on cap evidence and a feature-local growth cap (#2185)"

**Done when:**
- `readKickbackLedger` returns `allowance: 'laps'` for persisted cap evidence that has no allowance field and keeps the ledger readable, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`
- a cap evidence allowance outside `laps` and `growth` puts only that gate in `unreadableGates` while the sibling gate's laps are unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`
- a ledger-level `effectiveGrowthCap` that is 0, negative, fractional, or a string makes `readKickbackLedger` report the ledger unreadable and the value is not repaired or recomputed, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`
- `creditKickbackGateLaps` and the rebase credit writer leave a raised `effectiveGrowthCap` unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`
- `readGrowth` on a growth record with impossible counts recomputes `authored`, `added`, and `byGate` from the active plan and the ledger's raised `effectiveGrowthCap` survives unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** none

### Task 2: Remediation budget read honors the effective growth cap
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`: with a plan whose config-derived growth cap is 10 and `added` 6, and a ledger `effectiveGrowthCap` of 12, a remediation round requesting 6 fix tasks appends all 6 with no halt; with an unreadable `effectiveGrowthCap` the same round appends no task and writes no cap evidence; a second feature worktree with no `effectiveGrowthCap` resolves the config-derived cap and the repository `.ai-conductor/config.yml` bytes are unchanged
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/conductor.ts` `readRemediationGateAppendBudget`: resolve `growthCap` as the ledger's `effectiveGrowthCap` when present, else `prdAuditAppendCap(config, authoredTaskCount)`; pass it to `readGrowth`. The existing unreadable-ledger throw path is unchanged and stays the only handling for a malformed cap
4. Verify tests pass (GREEN)
5. Commit: "feat(remediation): honor an operator-raised growth cap (#2185)"

**Done when:**
- `readRemediationGateAppendBudget` resolves `growthCap` to the ledger's `effectiveGrowthCap` of 12 in place of the config-derived 10 and the round requesting 6 tasks at 6 added appends all 6 without halting, asserted in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`
- with an unreadable `effectiveGrowthCap` the remediation round appends no task and writes no cap evidence, asserted in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`
- a second feature with no `effectiveGrowthCap` still resolves the config-derived cap and the repository config file is byte-for-byte unchanged, asserted in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-kickback-ledger.test.ts

**Dependencies:** Task 1

### Task 3: Per-gate lap and growth exits record the exhausted allowance
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/prd-audit-kickback.test.ts`, extending the existing cap-halt fixtures: (a) prd_audit laps equal to the effective lap cap → halt class `kickback-cap`, ledger `prd_audit.capEvidence` has `allowance: 'laps'`, consumed = laps, limit = effective lap cap, and the halt body contains `Kickback halt generation: <that generation>`; (b) prd_audit with laps remaining and a request exceeding growth remaining → `allowance: 'growth'`, consumed = `growth.added`, limit = effective growth cap, generation in body; (c) the same for `architecture_review_as_built`; (d) an existing-task-only remediation with laps remaining writes no `capEvidence` and leaves `growth.added` unchanged; (e) an existing-task-only remediation at exhausted laps writes `allowance: 'laps'`
2. Verify tests fail (RED): today the growth exits write lap-shaped evidence
3. Implement in `src/conductor/src/engine/conductor.ts` at the prd_audit and as-built per-gate exits: pass `allowance` and, for `growth`, `consumed: budget.growth.added` and `limit: budget.growthCap` to `recordKickbackCapEvidence`; `laps` keeps `priorLaps`/`lapCap`. `remediationGateAppendBudgetExhausted` already returns the discriminator; reuse it
4. Verify tests pass (GREEN)
5. Commit: "feat(remediation): per-gate budget exits name the exhausted allowance (#2185)"

**Done when:**
- the prd_audit lap-cap exit halts `kickback-cap` with `prd_audit.capEvidence` carrying `allowance: 'laps'`, consumed equal to laps used, limit equal to the effective lap cap, and a generation the halt body repeats on a `Kickback halt generation:` line, asserted in `src/conductor/test/prd-audit-kickback.test.ts`
- the prd_audit growth exit halts `kickback-cap` with `allowance: 'growth'`, consumed equal to `growth.added`, limit equal to the effective growth cap, and its generation in the halt body, asserted in `src/conductor/test/prd-audit-kickback.test.ts`
- the architecture_review_as_built growth exit halts `kickback-cap` with `architecture_review_as_built.capEvidence` carrying `allowance: 'growth'`, consumed equal to `growth.added`, limit equal to the effective growth cap, and its generation in the halt body, asserted in `src/conductor/test/prd-audit-kickback.test.ts`
- an existing-task-only remediation with laps remaining writes no `capEvidence` and leaves `growth.added` unchanged, and one at exhausted laps records `allowance: 'laps'`, asserted in `src/conductor/test/prd-audit-kickback.test.ts`

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** Task 1

### Task 4: Shared growth exit records evidence; policy refusal and unreadable ledger record none
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/prd-audit-kickback.test.ts`: (a) a mixed validation-group round where prd_audit and as-built each fit their own allowance but together exceed `growth.remaining` → halt `kickback-cap`, `prd_audit.capEvidence.allowance === 'growth'`, and the halt body contains `Kickback halt generation:` matching it (today: no evidence, no line); (b) a remediation request from a source with no plan-growth allowance halts with no `capEvidence` on any gate and no `kickback-budget raise` line in the body; (c) with an unreadable gate entry the round appends no task, writes no `capEvidence`, and writes no halt body containing `Kickback halt generation:`
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/conductor.ts` at the shared plan-growth exit: call `recordKickbackCapEvidence` on `prd_audit` when its budget participates, else `architecture_review_as_built`, with `allowance: 'growth'`, consumed `growth.added`, limit the effective growth cap, and append the generation line to `detail`. Leave the no-allowance policy exit writing no evidence
4. Verify tests pass (GREEN)
5. Commit: "feat(remediation): shared growth exit records recoverable cap evidence (#2185)"

**Done when:**
- the shared plan-growth exit halts `kickback-cap` with `prd_audit.capEvidence` carrying `allowance: 'growth'` and a halt body containing a `Kickback halt generation:` line equal to that evidence's generation, asserted in `src/conductor/test/prd-audit-kickback.test.ts`
- the no-plan-growth-allowance policy exit writes no `capEvidence` on any gate and its halt body contains no `kickback-budget raise` command, asserted in `src/conductor/test/prd-audit-kickback.test.ts`
- with an unreadable gate entry the remediation round appends no task, writes no `capEvidence`, and writes no halt body containing `Kickback halt generation:`, asserted in `src/conductor/test/prd-audit-kickback.test.ts`

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** Task 1

### Task 5: Budget halts name the allowance and print the recovery command
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/kickback-budget-view.test.ts`, `renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'prd_audit', allowance: 'growth' })` returns a line naming the plan-growth allowance and the exact text `ai-conductor kickback-budget raise --feature feat-x --gate prd_audit --by «N» --rationale "«why»"`; with no slug it renders `«slug»`; in `src/conductor/test/prd-audit-kickback.test.ts`, each of the four budget exits from Tasks 3 and 4 writes that hint with its own slug, gate, and allowance
2. Verify tests fail (RED)
3. Implement `renderKickbackRecoveryHint` in `src/conductor/src/engine/kickback-budget-view.ts` (the one budget renderer, 08-29 D8) and append it to the four exits' `detail` in `src/conductor/src/engine/conductor.ts`, using `this.featureSlug` with the `«slug»` placeholder when undefined. The hint is diagnostic text only; nothing reads it back
4. Verify tests pass (GREEN)
5. Commit: "feat(remediation): budget halts print the recovery command (#2185)"

**Done when:**
- `renderKickbackRecoveryHint` returns a line naming the exhausted allowance and the command `ai-conductor kickback-budget raise --feature feat-x --gate prd_audit --by «N» --rationale "«why»"` with slug and gate filled in, asserted in `src/conductor/test/engine/kickback-budget-view.test.ts`
- each of the four remediation budget exits writes a halt body that names its exhausted allowance and contains the recovery command with its own feature slug and gate, asserted in `src/conductor/test/prd-audit-kickback.test.ts`

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-view.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/kickback-budget-view.test.ts
- src/conductor/test/prd-audit-kickback.test.ts

**Dependencies:** Task 3, Task 4

### Task 6: `kickback-budget raise` grows the allowance the live evidence names
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts` using the existing fake park store, lease, TTY, and sibling event writer: (a) a feature halted by as-built on growth (evidence `allowance: 'growth'`, consumed 6, limit 10) and `raise --gate architecture_review_as_built --by 2 --rationale "one more lap"` → ledger `effectiveGrowthCap` 12, `growth.added`, `growth.byGate`, and every gate's `laps` byte-for-byte unchanged, one adjustment record and one `kickback_budget_adjustment_authorized` event both carrying `allowance: 'growth'` with before 10 and after 12, a resume authorization bound to the halt generation, exit 0; (b) a prd_audit lap-cap halt and `raise --gate prd_audit --by 1` → `effectiveLapCap` +1 and `growth` plus `effectiveGrowthCap` byte-for-byte unchanged; (c) legacy evidence with no allowance on a growth halt → `effectiveLapCap` grows, `effectiveGrowthCap` absent, and the printed budget view shows the growth allowance still exhausted; (d) an unreadable `effectiveGrowthCap` → raise refuses non-zero and the ledger bytes are unchanged
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/kickback-budget-cli.ts` and `src/conductor/src/engine/kickback-ledger.ts`: the stage callback reads `capEvidence.allowance`; for `growth` the before limit is `effectiveGrowthCap ?? capEvidence.limit` and consumed is `growth.added`; `capEvidenceAgreesWithAdjustment` compares against those values for growth; `applyKickbackBudgetAdjustment` writes `effectiveGrowthCap` for growth and `effectiveLapCap` for laps, never both; stamp `allowance` on the adjustment and the event. Add optional `allowance` to the event member in `src/conductor/src/types/events.ts`; `audit-trail.ts` and `closeout-tail.ts` pass the field through unchanged. Park, lease, staging, reconciliation, and daemon-side clear are reused as-is (08-29 D4-D6)
4. Verify tests pass (GREEN)
5. Commit: "feat(kickback-budget): raise grows plan growth when growth ran out (#2185)"

**Done when:**
- `raise --gate architecture_review_as_built --by 2` on a growth halt at 6 of 10 sets the ledger's `effectiveGrowthCap` to 12 with `growth.added`, `growth.byGate`, and every gate's laps byte-for-byte unchanged, installs a resume authorization bound to the halt generation, and exits 0, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- that raise appends exactly one adjustment record and writes exactly one `kickback_budget_adjustment_authorized` event, both carrying `allowance: 'growth'` with before limit 10 and after limit 12, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- `raise --gate prd_audit --by 1` on lap evidence grows `effectiveLapCap` by 1 and leaves the growth record and `effectiveGrowthCap` byte-for-byte unchanged, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- on a growth halt whose evidence has no allowance field, raise grows `effectiveLapCap`, leaves `effectiveGrowthCap` absent, and prints a budget view showing the growth allowance still exhausted, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- with an unreadable `effectiveGrowthCap` raise exits non-zero and the ledger file bytes are unchanged, asserted in `src/conductor/test/cli/kickback-budget.test.ts`

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/src/types/events.ts
- src/conductor/src/engine/audit-trail.ts
- src/conductor/src/engine/closeout-tail.ts
- src/conductor/test/cli/kickback-budget.test.ts

**Dependencies:** Task 1

### Task 7: `reset` refuses growth evidence; raise ignores the edited command line
**Story:** 2
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`: (a) growth evidence and `reset --gate architecture_review_as_built` → non-zero exit, output names `raise` as the growth recovery, ledger bytes unchanged, a pre-existing park still present and no park created when none existed; (b) a growth halt whose HALT body has had its recovery-command line deleted (generation line intact) → `raise` succeeds exactly as in Task 6
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/kickback-budget-cli.ts`: a reset-only refusal on `capEvidence.allowance === 'growth'`, placed outside the shared reset/raise refusal helper because raise accepts the same evidence (conflict-check C4), evaluated before the park is taken
4. Verify tests pass (GREEN)
5. Commit: "feat(kickback-budget): reset refuses plan-growth evidence (#2185)"

**Done when:**
- `reset` on growth evidence exits non-zero with output naming `raise` as the growth recovery, the ledger file bytes are unchanged, and the park state is exactly as it was before the command, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- `raise` succeeds on a growth halt whose recovery-command line was deleted from the HALT body while the generation line and ledger evidence are intact, asserted in `src/conductor/test/cli/kickback-budget.test.ts`

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts
- src/conductor/test/cli/kickback-budget.test.ts

**Dependencies:** Task 6

### Task 8: Daemon resumes a growth-raised feature and a stale authorization cannot clear a new halt
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-rekick.test.ts`: (a) a worktree whose ledger carries a growth raise (Task 6 shape) and an unconsumed resume authorization matching the live `kickback-cap` HALT generation → `consumeResumeAuthorizations` clears the halt through the existing atomic clear, marks the authorization consumed, and emits `halt_cleared` with cause `kickback-budget`; then drive the conductor's remediation round with the raised cap and assert the 6 fix tasks are appended with no new HALT; (b) a raise of 1 when 2 more tasks are needed → the resumed round halts again on growth with a new generation, and running `consumeResumeAuthorizations` again leaves the new HALT in place
2. Verify tests fail (RED): the growth case has no evidence today
3. Implement any wiring gap found; expected none beyond Tasks 2, 4, and 6, since the daemon boundary keys on gate plus generation (08-29 successor D3)
4. Verify tests pass (GREEN)
5. Commit: "test(daemon): growth raise resumes through the existing authorization boundary (#2185)"

**Done when:**
- `consumeResumeAuthorizations` clears a growth-raised feature's `kickback-cap` halt, marks its authorization consumed, and emits `halt_cleared` with cause `kickback-budget`, and the resumed remediation round appends its 6 fix tasks with no new HALT, asserted in `src/conductor/test/engine/daemon-rekick.test.ts`
- after a raise of 1 when 2 tasks are needed the resumed round halts again on growth with a new halt generation and a second `consumeResumeAuthorizations` pass leaves that HALT in place, asserted in `src/conductor/test/engine/daemon-rekick.test.ts`

**Files likely touched:**
- src/conductor/test/engine/daemon-rekick.test.ts

**Dependencies:** Task 2, Task 4, Task 6

### Task 9: `inspect` shows plan growth and the effective growth cap
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-view.test.ts` and `src/conductor/test/cli/kickback-budget.test.ts`: `inspect --feature feat-x` on a raised feature renders growth added and the effective growth cap 12 beside each gate's laps and limit, and the adjustment history lists the raise with `growth`; on a feature with no raise it renders the config-derived cap and no raised value; with no TTY it exits 0 and leaves the ledger bytes unchanged
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/kickback-budget-view.ts`: a growth section in the view (added, effective cap, raised or config-derived) and the allowance on each history item; `inspect` in `src/conductor/src/engine/kickback-budget-cli.ts` resolves the config-derived cap the same way Task 2 does. `--format json` gains the same fields additively
4. Verify tests pass (GREEN)
5. Commit: "feat(kickback-budget): inspect shows plan growth and its cap (#2185)"

**Done when:**
- `inspect` on a growth-raised feature renders growth added and the effective growth cap 12 beside each gate's laps and limit, and lists the raise in the adjustment history with allowance `growth`, asserted in `src/conductor/test/cli/kickback-budget.test.ts`
- on a feature with no raised cap the budget view shows the config-derived growth cap and renders no raised value, asserted in `src/conductor/test/engine/kickback-budget-view.test.ts`
- `inspect` with no interactive terminal on a growth-halted feature exits 0 and the ledger file bytes are unchanged, asserted in `src/conductor/test/cli/kickback-budget.test.ts`

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-view.ts
- src/conductor/src/engine/kickback-budget-cli.ts
- src/conductor/test/engine/kickback-budget-view.test.ts
- src/conductor/test/cli/kickback-budget.test.ts

**Dependencies:** Task 1

### Task 10: Daemon status reports the effective growth cap and the exhausted allowance
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts`: a halted feature with growth cap evidence and `effectiveGrowthCap` 12 prints a `PLAN GROWTH` line whose remaining is computed against 12, and a `KICKBACK BUDGET` line naming the exhausted allowance `growth` even when the gate has no adjustments yet; a feature with no raise prints remaining against the config-derived cap
2. Verify tests fail (RED)
3. Implement in `src/conductor/src/engine/daemon-observe-cli.ts`: resolve the growth cap as `effectiveGrowthCap ?? config-derived`, and print a `KICKBACK BUDGET` line for any gate carrying cap evidence (not only adjustments), naming its allowance
4. Verify tests pass (GREEN)
5. Commit: "feat(daemon-status): show the effective growth cap and exhausted allowance (#2185)"

**Done when:**
- `daemon status` prints a `PLAN GROWTH` line whose remaining is computed against a raised `effectiveGrowthCap` of 12, and against the config-derived cap when no raise exists, asserted in `src/conductor/test/engine/daemon-observe-cli.test.ts`
- `daemon status` prints a `KICKBACK BUDGET` line naming allowance `growth` for a gate carrying growth cap evidence and no adjustments, asserted in `src/conductor/test/engine/daemon-observe-cli.test.ts`

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts
- src/conductor/test/engine/daemon-observe-cli.test.ts

**Dependencies:** Task 1

## Task Dependency Graph

```text
Task 1 ──┬─> Task 2 ──────────────┐
         ├─> Task 3 ──┐           │
         ├─> Task 4 ──┼─> Task 5  ├─> Task 8
         │            └───────────┤
         ├─> Task 6 ──┬─> Task 7  │
         │            └───────────┘
         ├─> Task 9
         └─> Task 10
```

## Integration Points

- After Task 4: every remediation budget halt carries typed evidence naming its allowance.
- After Task 6: an operator can grant plan growth on a live halt from the CLI.
- After Task 8: the grant → daemon clear → conductor append path is proven end to end.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a feature whose `prd_audit` remediation laps equal its effective lap cap, **When** prd_audit asks to append fix tasks, **Then** the feature halts `kickback-cap` and the ledger's `prd_audit` entry carries cap evidence with allowance `laps`, consumed equal to laps used, limit equal to the effective lap cap, and a fresh halt generation that the halt body repeats on a `Kickback halt generation:` line. | 3, 5 | "the prd_audit lap-cap exit halts `kickback-cap` with `prd_audit.capEvidence` carrying `allowance: 'laps'`, consumed equal to laps used, limit equal to the effective lap cap, and a generation the halt body repeats on a `Kickback halt generation:` line, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 happy: **Given** a feature with prd_audit laps remaining whose fix-task request exceeds the remaining plan-growth allowance, **When** prd_audit asks to append, **Then** the feature halts `kickback-cap` and the `prd_audit` cap evidence carries allowance `growth`, consumed equal to the recorded added task count, limit equal to the effective growth cap, and a fresh halt generation repeated in the halt body. | 3 | "the prd_audit growth exit halts `kickback-cap` with `allowance: 'growth'`, consumed equal to `growth.added`, limit equal to the effective growth cap, and its generation in the halt body, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 happy: **Given** a feature with as-built laps remaining whose as-built fix-task request exceeds the remaining plan-growth allowance, **When** architecture_review_as_built asks to append, **Then** the feature halts `kickback-cap` and the `architecture_review_as_built` cap evidence carries allowance `growth` with consumed equal to added, limit equal to the effective growth cap, and a fresh halt generation repeated in the halt body. | 3 | "the architecture_review_as_built growth exit halts `kickback-cap` with `architecture_review_as_built.capEvidence` carrying `allowance: 'growth'`, consumed equal to `growth.added`, limit equal to the effective growth cap, and its generation in the halt body, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 happy: **Given** a validation-group round where prd_audit and as-built each fit their own allowance but their combined fix-task request exceeds the shared remaining plan-growth allowance, **When** the router checks the shared allowance, **Then** the feature halts `kickback-cap` and the `prd_audit` cap evidence carries allowance `growth` and a fresh halt generation repeated in the halt body, where today no evidence and no generation line are written. | 4 | "the shared plan-growth exit halts `kickback-cap` with `prd_audit.capEvidence` carrying `allowance: 'growth'` and a halt body containing a `Kickback halt generation:` line equal to that evidence's generation, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: **Given** a remediation lap that only restages existing tasks (an `existing-task` disposition with no appended tasks) and laps remaining, **When** it runs, **Then** no cap evidence is written and no plan growth is charged. | 3 | "an existing-task-only remediation with laps remaining writes no `capEvidence` and leaves `growth.added` unchanged, and one at exhausted laps records `allowance: 'laps'`, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: **Given** an `existing-task` remediation arriving when the gate's laps are exhausted, **When** the router checks the budget, **Then** the cap evidence names allowance `laps`, never `growth`. | 3 | "an existing-task-only remediation with laps remaining writes no `capEvidence` and leaves `growth.added` unchanged, and one at exhausted laps records `allowance: 'laps'`, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: **Given** a kickback ledger whose gate entry is unreadable, **When** the remediation budget is read, **Then** no remediation task is appended, no cap evidence is written, and no halt carrying a `Kickback halt generation:` line is written. | 4 | "with an unreadable gate entry the remediation round appends no task, writes no `capEvidence`, and writes no halt body containing `Kickback halt generation:`, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: **Given** a remediation request from a source that has no plan-growth allowance at all (not a validated prd_audit FIXABLE or as-built REMEDIABLE finding), **When** the router refuses it, **Then** the halt writes no cap evidence and names no recovery command, because it is a policy refusal and not a spent budget. | 4 | "the no-plan-growth-allowance policy exit writes no `capEvidence` on any gate and its halt body contains no `kickback-budget raise` command, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: **Given** a ledger written before this change whose cap evidence has no allowance field, **When** it is read, **Then** the evidence is treated as allowance `laps` and the ledger stays readable. | 1 | "`readKickbackLedger` returns `allowance: 'laps'` for persisted cap evidence that has no allowance field and keeps the ledger readable, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`" | diff-local |
| Story 1 negative: **Given** a cap evidence entry whose allowance is any value other than `laps` or `growth`, **When** the ledger is read, **Then** that gate reads unreadable and fails closed, while sibling gates keep their values. | 1 | "a cap evidence allowance outside `laps` and `growth` puts only that gate in `unreadableGates` while the sibling gate's laps are unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`" | diff-local |
| Story 2 happy: **Given** a feature halted by as-built on the plan-growth allowance at 6 of 10 appended with 6 requested and 4 remaining, **When** the operator runs `raise --gate architecture_review_as_built --by 2 --rationale "one more lap"` from an interactive terminal, **Then** the feature's effective growth cap becomes 12, `added`, `byGate`, and every gate's laps are unchanged, one adjustment record naming allowance `growth` and one `kickback_budget_adjustment_authorized` event naming allowance `growth` are written, a resume authorization bound to the halt generation is installed, and the command exits 0. | 6 | "`raise --gate architecture_review_as_built --by 2` on a growth halt at 6 of 10 sets the ledger's `effectiveGrowthCap` to 12 with `growth.added`, `growth.byGate`, and every gate's laps byte-for-byte unchanged, installs a resume authorization bound to the halt generation, and exits 0, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 2 happy: **Given** that authorization and the temporary park released, **When** the daemon reaches the halted feature, **Then** it consumes the authorization, clears the halt through the existing clear, and the re-dispatched remediation appends its 6 fix tasks within the raised allowance without halting again. | 8 | "`consumeResumeAuthorizations` clears a growth-raised feature's `kickback-cap` halt, marks its authorization consumed, and emits `halt_cleared` with cause `kickback-budget`, and the resumed remediation round appends its 6 fix tasks with no new HALT, asserted in `src/conductor/test/engine/daemon-rekick.test.ts`" | diff-local |
| Story 2 happy: **Given** a feature halted at the prd_audit lap cap with evidence naming `laps`, **When** the operator runs `raise --gate prd_audit --by 1`, **Then** the effective lap cap grows by 1 exactly as before this change and the growth record and any raised growth cap are byte-for-byte unchanged. | 6 | "`raise --gate prd_audit --by 1` on lap evidence grows `effectiveLapCap` by 1 and leaves the growth record and `effectiveGrowthCap` byte-for-byte unchanged, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 2 happy: **Given** a feature with a raised effective growth cap, **When** a rebase credit refunds lap-counting fields, **Then** the raised growth cap survives unchanged. | 1 | "`creditKickbackGateLaps` and the rebase credit writer leave a raised `effectiveGrowthCap` unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`" | diff-local |
| Story 2 happy: **Given** a feature with a raised effective growth cap whose growth counts are recomputed from the plan because the recorded counts are impossible, **When** the growth record is read, **Then** the counts are recomputed and the raised growth cap survives unchanged. | 1 | "`readGrowth` on a growth record with impossible counts recomputes `authored`, `added`, and `byGate` from the active plan and the ledger's raised `effectiveGrowthCap` survives unchanged, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`" | diff-local |
| Story 2 negative: **Given** a feature halted with evidence naming `growth`, **When** the operator runs `kickback-budget reset --gate «that gate»`, **Then** it refuses with a message naming `raise` as the growth recovery, changes nothing in the ledger, leaves the park as it found it, and exits non-zero. | 7 | "`reset` on growth evidence exits non-zero with output naming `raise` as the growth recovery, the ledger file bytes are unchanged, and the park state is exactly as it was before the command, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 2 negative: **Given** a feature raised by 1 when its remediation needs 2 more tasks, **When** the daemon resumes it, **Then** it halts again on growth with a new halt generation, and the consumed earlier authorization cannot clear the new halt. | 8 | "after a raise of 1 when 2 tasks are needed the resumed round halts again on growth with a new halt generation and a second `consumeResumeAuthorizations` pass leaves that HALT in place, asserted in `src/conductor/test/engine/daemon-rekick.test.ts`" | diff-local |
| Story 2 negative: **Given** a feature halted on growth before this change, with evidence carrying no allowance, **When** the operator runs raise, **Then** the lap cap grows as it does today, the growth cap is unchanged, and the output shows the growth allowance still exhausted. | 6 | "on a growth halt whose evidence has no allowance field, raise grows `effectiveLapCap`, leaves `effectiveGrowthCap` absent, and prints a budget view showing the growth allowance still exhausted, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 2 negative: **Given** a raised effective growth cap that is not a positive safe integer, **When** the ledger is read, **Then** the value is not repaired or recomputed, no remediation task is appended, and raise refuses. | 1, 2, 6 | "a ledger-level `effectiveGrowthCap` that is 0, negative, fractional, or a string makes `readKickbackLedger` report the ledger unreadable and the value is not repaired or recomputed, asserted in `src/conductor/test/engine/kickback-ledger.test.ts`" | diff-local |
| Story 2 negative: **Given** one feature's growth cap is raised, **When** another feature or the repository config is read, **Then** neither changes and the other feature's growth cap is still config-derived. | 2 | "a second feature with no `effectiveGrowthCap` still resolves the config-derived cap and the repository config file is byte-for-byte unchanged, asserted in `src/conductor/test/engine/conductor-kickback-ledger.test.ts`" | diff-local |
| Story 3 happy: **Given** any remediation budget halt written after this change, **When** the operator reads the HALT body, **Then** it names the exhausted allowance and prints the exact command `ai-conductor kickback-budget raise --feature «slug» --gate «gate» --by «N» --rationale "«why»"` with the feature slug and gate filled in. | 5 | "each of the four remediation budget exits writes a halt body that names its exhausted allowance and contains the recovery command with its own feature slug and gate, asserted in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 3 happy: **Given** a feature whose growth cap was raised, **When** the operator runs `kickback-budget inspect --feature «slug»`, **Then** the output shows plan growth added and the effective growth cap alongside each gate's laps and limit, and the adjustment history lists the growth raise with its allowance. | 9 | "`inspect` on a growth-raised feature renders growth added and the effective growth cap 12 beside each gate's laps and limit, and lists the raise in the adjustment history with allowance `growth`, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 3 happy: **Given** a halted feature with growth cap evidence, **When** the operator runs `ai-conductor daemon status`, **Then** the feature's PLAN GROWTH line reports remaining against the effective growth cap, raised when raised, and its KICKBACK BUDGET line names the exhausted allowance. | 10 | "`daemon status` prints a `PLAN GROWTH` line whose remaining is computed against a raised `effectiveGrowthCap` of 12, and against the config-derived cap when no raise exists, asserted in `src/conductor/test/engine/daemon-observe-cli.test.ts`" | diff-local |
| Story 3 negative: **Given** the operator edits or deletes the recovery command line in the HALT body, **When** they run raise with the generation line and ledger evidence intact, **Then** raise succeeds, because the command line is never parsed. | 7 | "`raise` succeeds on a growth halt whose recovery-command line was deleted from the HALT body while the generation line and ledger evidence are intact, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |
| Story 3 negative: **Given** a feature with no raised growth cap, **When** inspect or daemon status renders it, **Then** the growth cap shown equals the config-derived cap and no raised value is invented. | 9, 10 | "on a feature with no raised cap the budget view shows the config-derived growth cap and renders no raised value, asserted in `src/conductor/test/engine/kickback-budget-view.test.ts`" | diff-local |
| Story 3 negative: **Given** inspect run without an interactive terminal, **When** it renders a growth-halted feature, **Then** it succeeds read-only and the ledger is byte-for-byte unchanged. | 9 | "`inspect` with no interactive terminal on a growth-halted feature exits 0 and the ledger file bytes are unchanged, asserted in `src/conductor/test/cli/kickback-budget.test.ts`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | no-change | none | D1 governs only the cumulative build_review cap terminal, which this feature does not touch; the remediation-append terminals keep `kickback-cap` under the 2026-09-01 amendment. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | task | task-3, task-4 | with `prd_audit.capEvidence` carrying `allowance: 'growth'` and a halt body containing a `Kickback halt generation:` line equal to that evidence's generation |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | task | task-8 | `consumeResumeAuthorizations` clears a growth-raised feature's `kickback-cap` halt, marks its authorization consumed |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | existing | none | The carried-forward park ownership, ledger lease, staged `pendingAdjustment` journal, idempotent sibling-ledger event, command-entry reconciliation, and daemon-side clear already ship in `kickback-budget-cli.ts`, `kickback-ledger.ts`, and `daemon-rekick.ts` (#2190) and are reused unchanged. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | task | task-1, task-2, task-3, task-4, task-5, task-6, task-7 | sets the ledger's `effectiveGrowthCap` to 12 with `growth.added`, `growth.byGate`, and every gate's laps byte-for-byte unchanged |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of 2-5 single-line falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] No task targets another feature's sealed artifact
