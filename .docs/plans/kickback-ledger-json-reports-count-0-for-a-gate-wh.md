# Implementation Plan: Remediation-gate budget readable from one place that agrees with enforcement

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/kickback-ledger-json-reports-count-0-for-a-gate-wh.md`)
**Stories:** .docs/stories/kickback-ledger-json-reports-count-0-for-a-gate-wh.md
**Conflict check:** Not required (Tier S)

## Summary

Issue #2577: an operator read `kickback-ledger.json`'s generic `count`/`cumulative` counters (both
0) for `architecture_review_as_built`, concluded budget was unspent, and the engine then halted at
`1/1`. The engine enforces the remediation cap from the same file's `laps` field
(`src/conductor/src/engine/remediation-caps.ts:117-121`; settlement at
`src/conductor/src/engine/kickback-ledger.ts:1357`), while `count`/`cumulative` belong to the
generic re-open counter (`bumpKickbackGate`, `kickback-ledger.ts:1007-1045`) and are never advanced
by a remediation lap. The shared projection (`kickback-budget-view.ts`) already reads `laps`, but it
omits the not-yet-charged pending-repair lap, resolves its fallback cap through copies of the
engine's resolver, and `daemon status` shows remediation gates only after a cap halt. Five tasks
make that projection the one authoritative reading on both operator surfaces.

## Technical Approach

- **One fallback-cap resolver.** Add `kickbackBudgetFallbackLimit(gate: string, config: HarnessConfig): number`
  to `src/conductor/src/engine/remediation-caps.ts`: `build_review` →
  `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` (5, `kickback-ledger.ts:249`); `prd_audit` and
  `architecture_review_as_built` → `remediationLapCapForGate(gate, config)` (the resolver the engine
  enforces with, `conductor.ts:3661-3662`, `8919-8920`). `kickback-budget-cli.ts` `defaultsFor` and
  the `daemon status` section both call it, replacing their hand-copied `max_remediation_laps ?? 1`
  reads. A future change to cap resolution (e.g. #2413's tier budgets) then flows to both surfaces
  automatically.
- **Pending charge is part of the reading.** Since #2869, an appended repair's lap is held in
  `ledger.pendingRepair.charges[gate].laps` and charged into `laps` only when build dispatches
  (`settlePendingRepair`, `kickback-ledger.ts:1324-1365`, which refuses when
  `laps + charge > lapCap`). `kickbackBudgetView` gains an optional trailing `pendingLaps` argument
  (default 0). For remediation gates the view carries `pendingLaps` and computes
  `remaining = max(0, limit - consumed - pendingLaps)`; `consumed` stays the recorded `laps`. The
  human render adds `Pending charge: <n> lap(s) (charged when build dispatches)` only when
  `pendingLaps > 0` (`1 lap`, `2 laps`). `build_review` views are unchanged and carry no
  `pendingLaps`.
- **Status renders remediation gates unconditionally.** In `renderPlanGrowthSection`
  (`daemon-observe-cli.ts:582-623`), for every visible feature, always emit one
  `  KICKBACK BUDGET [<slug>]: ` line per remediation gate (`prd_audit`, then
  `architecture_review_as_built`), via the same view, resolver, and pending charge. A gate in
  `unreadableKickbackGates(ledger)`, or any gate of a wholly unreadable ledger
  (`isUnreadableKickbackLedger`), renders `<gate>: budget unavailable (durable entry failed validation)`
  — the wording `kickback-budget inspect` already uses (`kickback-budget-cli.ts:152`). `build_review`
  keeps its current condition (cap evidence or adjustment history). The existing
  `Allowance: <x>; ` prefix stays for gates with cap evidence.
- **A broken growth record must not hide the budget.** `readGrowth` throws on a malformed pending
  repair (`kickback-ledger.ts:927-931`), which today aborts the whole status section. Wrap the
  per-feature growth read: on failure print
  `  PLAN GROWTH [<slug>]: unavailable (<error message>)` and continue to the gate lines.
- **Rejected alternatives.** (a) Stamping a derived `remaining` into `kickback-ledger.json` on every
  write: the limit depends on config and later raises, so a stamped value goes stale, and it adds a
  second budget record beside the projection. (b) Renaming or dropping `count`/`cumulative` for
  remediation gates: a durable-schema migration with no enforcement benefit, overlapping #2413's
  redesign. Neither is needed once the projection is authoritative on both surfaces.
- **Out of scope (other open work).** #2894 (second raise refused; cap-evidence `limit`), #2413
  (budget redesign / tier caps), charging/settlement/raise/reset behavior, the process-local
  `remediationRounds` counter (`conductor.ts:6091`, `8212`), and child ledgers in `daemon status`.
- **Event spine.** Nothing new observes, stamps, or signals; both surfaces render existing durable
  state, so the event-spine decision procedure stops at its step 1.

## Prerequisites

- None.

## Tasks

### Task 1: Shared kickback-budget fallback-cap resolver used by inspect
**Story:** Story 1 (happy path 2)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-caps.test.ts`: `kickbackBudgetFallbackLimit('build_review', {})` is 5; `kickbackBudgetFallbackLimit('architecture_review_as_built', {})` is 1; with `{ architecture_review_as_built: { max_remediation_laps: 3 } }` it is 3; with `{ prd_audit: { max_remediation_laps: 2 } }`, `kickbackBudgetFallbackLimit('prd_audit', …)` is 2.
2. Write a failing test in `src/conductor/test/engine/kickback-budget-view.test.ts`: a feature worktree whose `.ai-conductor/config.yml` sets `architecture_review_as_built.max_remediation_laps: 3` and whose ledger has no `architecture_review_as_built` entry; `dispatchKickbackBudgetCommand` inspect (human) prints `Kickback budget (architecture_review_as_built): 0/3 consumed; 3 remaining`.
3. Verify RED (the resolver does not exist).
4. Implement `kickbackBudgetFallbackLimit` in `remediation-caps.ts` (import `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` from `kickback-ledger.ts`; delegate remediation gates to `remediationLapCapForGate`). Replace the body of `defaultsFor` in `kickback-budget-cli.ts` so each gate's default comes from `kickbackBudgetFallbackLimit(gate, loaded.ok ? loaded.config : {} as HarnessConfig)`; delete the now-unused `DEFAULTS` constant.
5. Verify GREEN; commit "refactor(kickback-budget): resolve fallback caps through the engine's resolver".

**Done when:**
- [test] `remediation-caps.test.ts` asserts `kickbackBudgetFallbackLimit` returns 5 for `build_review`, 1 for `architecture_review_as_built` with no config, 3 with `max_remediation_laps: 3`, and 2 for `prd_audit` with `max_remediation_laps: 2`.
- [test] `kickback-budget-view.test.ts` asserts `kickback-budget inspect` for a feature configured with `architecture_review_as_built.max_remediation_laps: 3` and no entry prints `Kickback budget (architecture_review_as_built): 0/3 consumed; 3 remaining`.
- `kickback-budget-cli.ts` no longer contains a `max_remediation_laps` read; its gate defaults come only from `kickbackBudgetFallbackLimit`, and the existing `test/cli/kickback-budget.test.ts` cases pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/remediation-caps.ts` — `kickbackBudgetFallbackLimit`
- `src/conductor/src/engine/kickback-budget-cli.ts` — `defaultsFor` delegates to the resolver
- `src/conductor/test/engine/remediation-caps.test.ts` — resolver cases
- `src/conductor/test/engine/kickback-budget-view.test.ts` — configured-cap inspect case

**Dependencies:** none

### Task 2: Inspect counts the pending-repair lap charge in remaining budget
**Story:** Story 1 (happy path 3; negative paths 2, 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-view.test.ts`, each through `dispatchKickbackBudgetCommand` inspect in both `human` and `json` formats:
   (a) ledger `architecture_review_as_built: { …, laps: 0 }` plus `pendingRepair: { receiptId: 'r1', charges: { architecture_review_as_built: { laps: 1, growth: 0 } }, taskIds: ['rem-as-built-1'] }`, no config: human contains `Kickback budget (architecture_review_as_built): 0/1 consumed; 0 remaining` and `Pending charge: 1 lap (charged when build dispatches)`; JSON view for that gate has `consumed: 0`, `limit: 1`, `pendingLaps: 1`, `remaining: 0`.
   (b) `pendingRepair.charges` names only `prd_audit` (`{ laps: 1, growth: 0 }`), as-built `laps: 0`: the human `architecture_review_as_built` block contains no `Pending charge:` line, its JSON view has `pendingLaps: 0` and `remaining: 1`.
   (c) as-built `laps: 1` plus a 1-lap as-built pending charge, cap 1: human contains `1/1 consumed; 0 remaining` and `Pending charge: 1 lap`; JSON `remaining` is `0`.
   Add a direct unit case: `renderKickbackBudgetView(entry, 'architecture_review_as_built', 3, undefined, undefined, 2)` contains `Pending charge: 2 laps (charged when build dispatches)` and `1 remaining` for `laps: 0`.
2. Verify RED.
3. In `kickback-budget-view.ts`, add an optional trailing `pendingLaps = 0` parameter to `kickbackBudgetView` and `renderKickbackBudgetView`; for remediation gates set `pendingLaps` on the view and compute `remaining: Math.max(0, limit - consumed - pendingLaps)`; render the `Pending charge:` line after the `Kickback budget (…)` line only when `pendingLaps > 0`. Leave `build_review` views unchanged. In `kickback-budget-cli.ts` inspect, pass `ledger.pendingRepair?.charges[gate]?.laps ?? 0` for each remediation gate to both the JSON and human calls.
4. Verify GREEN; commit "feat(kickback-budget): count pending repair laps in remaining budget".

**Done when:**
- [test] `kickback-budget-view.test.ts` asserts inspect with a 1-lap pending as-built charge and 0 recorded laps prints `0/1 consumed; 0 remaining` and `Pending charge: 1 lap (charged when build dispatches)`, and its JSON view carries `consumed: 0`, `limit: 1`, `pendingLaps: 1`, `remaining: 0`.
- [test] The same file asserts that when the pending repair charges only `prd_audit`, the `architecture_review_as_built` human block has no `Pending charge:` line and its JSON view carries `pendingLaps: 0` and `remaining: 1` (limit 1 minus 0 recorded laps).
- [test] The same file asserts that with 1 recorded lap, cap 1, and a 1-lap pending as-built charge, inspect reports `0 remaining` in human output, JSON `remaining: 0`, and the `Pending charge: 1 lap` line.
- [test] The same file asserts `renderKickbackBudgetView` with `pendingLaps` 2 renders `Pending charge: 2 laps (charged when build dispatches)`, and the existing `build_review` render case (`5/6 consumed; 1 remaining`) passes unchanged.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-view.ts` — `pendingLaps` in view and render
- `src/conductor/src/engine/kickback-budget-cli.ts` — inspect passes the pending lap charge
- `src/conductor/test/engine/kickback-budget-view.test.ts` — pending-charge cases

**Dependencies:** Task 1

### Task 3: Inspect ignores generic re-open counters for remediation gates
**Story:** Story 1 (happy path 1; negative path 1)
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/cli/kickback-budget.test.ts` (new `describe('kickback-budget inspect reports enforced remediation laps')`), each through `dispatchKickbackBudgetCommand` inspect with no config:
   (a) the #2577 reproduction: `architecture_review_as_built: { count: 0, cumulative: 0, laps: 1, … }`: human contains `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining`; JSON view has `consumed: 1`, `limit: 1`, `remaining: 0`.
   (b) `architecture_review_as_built: { count: 2, cumulative: 5, laps: 0, … }`: human contains `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining`; JSON `consumed: 0`.
2. Run them. The projection already derives remediation consumption from `laps` (`kickback-budget-view.ts:64`), so they are expected to pass immediately; if so, this task commits only the tests as a regression lock. If either fails, fix `kickbackBudgetView` so remediation `consumed` reads only `laps`.
3. Commit "test(kickback-budget): lock remediation consumption to recorded laps (#2577)".

**Done when:**
- [test] `kickback-budget.test.ts` asserts inspect of an as-built entry with `count: 0`, `cumulative: 0`, `laps: 1` prints `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` and its JSON view carries `consumed: 1`, `limit: 1`, `remaining: 0`.
- [test] The same file asserts inspect of an as-built entry with `count: 2`, `cumulative: 5`, `laps: 0` prints `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining` and its JSON view carries `consumed: 0`.

**Files likely touched:**
- `src/conductor/test/cli/kickback-budget.test.ts` — enforced-laps inspect cases

**Dependencies:** none

### Task 4: daemon status renders both remediation gates' budget for every visible feature
**Story:** Story 2 (happy paths 1–3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts`, next to the existing plan-growth `runDaemonStatus` cases and reusing `writeActivePlan`, `registry`, and `record`:
   (a) in-progress feature `laps-feature` whose ledger has `architecture_review_as_built: { count: 0, cumulative: 0, laps: 1, … }` with no `capEvidence` and no `adjustments`: output contains a line starting `  KICKBACK BUDGET [laps-feature]: ` that contains `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining`.
   (b) in-progress feature `fresh-feature` with `{ version: 1, gates: {} }` and no lap config: exactly one `KICKBACK BUDGET [fresh-feature]:` line contains `Kickback budget (prd_audit): 0/1 consumed; 1 remaining` and exactly one contains `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining`.
   (c) in-progress feature `config-feature` whose worktree `.ai-conductor/config.yml` sets `architecture_review_as_built.max_remediation_laps: 3` and whose entry records `laps: 1`: the status line contains `Kickback budget (architecture_review_as_built): 1/3 consumed; 2 remaining`, and `dispatchKickbackBudgetCommand` inspect on the same worktree prints the same `1/3 consumed; 2 remaining`.
2. Verify RED (today no line is emitted without cap evidence or adjustments).
3. In `renderPlanGrowthSection` (`src/conductor/src/engine/daemon-observe-cli.ts`): for each visible feature, after the plan-growth line, emit for `prd_audit` then `architecture_review_as_built` one `  KICKBACK BUDGET [<slug>]: ` line built from `renderKickbackBudgetView(entry, gate, kickbackBudgetFallbackLimit(gate, config), undefined, undefined, ledger.pendingRepair?.charges[gate]?.laps ?? 0)` with newlines replaced by ` | `, keeping the `Allowance: <x>; ` prefix when the entry has cap evidence. Keep `build_review` under its existing cap-evidence-or-adjustments condition, using `kickbackBudgetFallbackLimit('build_review', config)`. Remove the inline `max_remediation_laps ?? 1` limit expression.
4. Verify GREEN; commit "feat(daemon-status): show remediation gate budgets before any halt".

**Done when:**
- [test] `daemon-observe-cli.test.ts` asserts `runDaemonStatus` prints a `KICKBACK BUDGET [laps-feature]:` line containing `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` for an entry with `laps: 1` and no cap evidence or adjustments.
- [test] The same file asserts `runDaemonStatus` prints, for a feature with an empty ledger, exactly one `KICKBACK BUDGET [fresh-feature]:` line with `Kickback budget (prd_audit): 0/1 consumed; 1 remaining` and exactly one with `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining`.
- [test] The same file asserts that with `architecture_review_as_built.max_remediation_laps: 3` and `laps: 1`, both the `runDaemonStatus` line and `kickback-budget inspect` output contain `1/3 consumed; 2 remaining`.
- `daemon-observe-cli.ts` no longer reads `max_remediation_laps`; its gate limits come only from `kickbackBudgetFallbackLimit`, and the existing growth-cap status cases (`Allowance: growth`, `KICKBACK BUDGET [growth-feature]:`) pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — unconditional remediation-gate lines; shared resolver
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — pre-halt budget cases

**Dependencies:** Task 1, Task 2

### Task 5: daemon status reports an unreadable remediation budget as unavailable without aborting
**Story:** Story 2 (negative paths 1, 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts`:
   (a) in-progress feature `broken-feature` whose ledger has `prd_audit` and `architecture_review_as_built` entries with `laps: 0` plus a malformed `pendingRepair: { receiptId: '', charges: {}, taskIds: [] }` (rejected by `isPendingRepair`): `runDaemonStatus` resolves with `code: 0`; output contains `  KICKBACK BUDGET [broken-feature]: prd_audit: budget unavailable (durable entry failed validation)` and `  KICKBACK BUDGET [broken-feature]: architecture_review_as_built: budget unavailable (durable entry failed validation)`; no output line for `broken-feature` contains `Kickback budget (prd_audit):` or `Kickback budget (architecture_review_as_built):`; and the output contains a line starting `  PLAN GROWTH [broken-feature]: unavailable (`.
   (b) in-progress feature `review-feature` whose ledger has only `build_review: { count: 1, cumulative: 1, … }` with no `capEvidence` and no `adjustments`: no output line contains both `KICKBACK BUDGET [review-feature]:` and `build_review`.
2. Verify RED ((a) currently rejects because `readGrowth` throws on the malformed pending repair).
3. In `renderPlanGrowthSection`: wrap the feature's `readGrowth` calls in `try/catch`; on failure print `  PLAN GROWTH [<slug>]: unavailable (<error message>)` and continue. Before rendering a remediation gate, if `isUnreadableKickbackLedger(ledger)` or `unreadableKickbackGates(ledger).includes(gate)`, print `  KICKBACK BUDGET [<slug>]: <gate>: budget unavailable (durable entry failed validation)` instead of the view. Leave the `build_review` condition untouched.
4. Verify GREEN; commit "fix(daemon-status): render unreadable remediation budgets as unavailable".

**Done when:**
- [test] `daemon-observe-cli.test.ts` asserts that for a malformed pending repair `runDaemonStatus` resolves with `code: 0` and prints `prd_audit: budget unavailable (durable entry failed validation)` and `architecture_review_as_built: budget unavailable (durable entry failed validation)` on `KICKBACK BUDGET [broken-feature]:` lines.
- [test] The same test asserts no `broken-feature` output line contains `Kickback budget (prd_audit):` or `Kickback budget (architecture_review_as_built):`, so no `consumed;` figure is shown for either gate, and that a `PLAN GROWTH [broken-feature]: unavailable (` line is printed.
- [test] The same file asserts a `build_review` entry with no cap evidence and no adjustment history produces no `KICKBACK BUDGET [review-feature]:` line naming `build_review`.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — growth-read guard; unavailable gate lines
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — unreadable-budget and build_review cases

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 4 ──▶ Task 5
Task 1 ─────────────▶ Task 4
Task 3 (independent)
```

## Integration Points

- After Task 2: `ai-conductor kickback-budget inspect` (`dispatchKickbackBudgetCommand`) reports the pending-charge-aware remediation budget in human and JSON form.
- After Task 4: `ai-conductor daemon status` (`runDaemonStatus`) renders the same projection and cap resolver for both remediation gates of every in-progress or halted feature; Task 4's check (c) proves the two surfaces agree on one fixture.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose `architecture_review_as_built` ledger entry records 1 consumed remediation lap with `count` 0 and `cumulative` 0, and no configured or raised lap cap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the human output reports `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` and the `--format json` view for that gate carries `consumed: 1`, `limit: 1`, and `remaining: 0`. | 3 | "asserts inspect of an as-built entry with `count: 0`, `cumulative: 0`, `laps: 1` prints `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` and its JSON view carries `consumed: 1`, `limit: 1`, `remaining: 0`" | diff-local |
| Story 1 happy: Given a feature with no `architecture_review_as_built` ledger entry and a feature config setting `architecture_review_as_built.max_remediation_laps: 3`, when the operator runs inspect, then that gate reports `0/3 consumed; 3 remaining`. | 1 | "asserts `kickback-budget inspect` for a feature configured with `architecture_review_as_built.max_remediation_laps: 3` and no entry prints `Kickback budget (architecture_review_as_built): 0/3 consumed; 3 remaining`" | diff-local |
| Story 1 happy: Given a feature whose pending repair carries an uncharged 1-lap charge for `architecture_review_as_built` while that gate's recorded laps are 0 and its cap is 1, when the operator runs inspect, then the gate reports `0/1 consumed; 0 remaining`, the human output includes the line `Pending charge: 1 lap (charged when build dispatches)`, and the JSON view carries `pendingLaps: 1` and `remaining: 0`. | 2 | "prints `0/1 consumed; 0 remaining` and `Pending charge: 1 lap (charged when build dispatches)`, and its JSON view carries `consumed: 0`, `limit: 1`, `pendingLaps: 1`, `remaining: 0`" | diff-local |
| Story 1 negative: Given a feature whose `architecture_review_as_built` entry records `count` 2, `cumulative` 5, and 0 laps with cap 1, when the operator runs inspect, then the gate reports `0/1 consumed; 1 remaining` — the generic counters contribute nothing to remediation consumption. | 3 | "asserts inspect of an as-built entry with `count: 2`, `cumulative: 5`, `laps: 0` prints `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining` and its JSON view carries `consumed: 0`" | diff-local |
| Story 1 negative: Given a feature whose pending repair charges only `prd_audit`, when the operator runs inspect, then the `architecture_review_as_built` output contains no `Pending charge:` line, its JSON view carries `pendingLaps: 0`, and its remaining equals its limit minus its recorded laps. | 2 | "the `architecture_review_as_built` human block has no `Pending charge:` line and its JSON view carries `pendingLaps: 0` and `remaining: 1` (limit 1 minus 0 recorded laps)" | diff-local |
| Story 1 negative: Given a feature whose `architecture_review_as_built` entry records 1 lap with cap 1 and whose pending repair also carries a 1-lap charge for that gate, when the operator runs inspect, then the gate reports `0 remaining` (never a negative number) and the `Pending charge: 1 lap` line. | 2 | "with 1 recorded lap, cap 1, and a 1-lap pending as-built charge, inspect reports `0 remaining` in human output, JSON `remaining: 0`, and the `Pending charge: 1 lap` line" | diff-local |
| Story 2 happy: Given an in-progress feature whose `architecture_review_as_built` entry records 1 lap and has no cap evidence and no adjustment history, when the operator runs `ai-conductor daemon status`, then the output includes a `KICKBACK BUDGET [<slug>]:` line containing `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining`. | 4 | "prints a `KICKBACK BUDGET [laps-feature]:` line containing `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` for an entry with `laps: 1` and no cap evidence or adjustments" | diff-local |
| Story 2 happy: Given an in-progress feature with no ledger entry for either remediation gate and no configured lap caps, when the operator runs daemon status, then the output includes one `KICKBACK BUDGET [<slug>]:` line for `prd_audit` and one for `architecture_review_as_built`, each containing `0/1 consumed; 1 remaining`. | 4 | "exactly one `KICKBACK BUDGET [fresh-feature]:` line with `Kickback budget (prd_audit): 0/1 consumed; 1 remaining` and exactly one with `Kickback budget (architecture_review_as_built): 0/1 consumed; 1 remaining`" | diff-local |
| Story 2 happy: Given an in-progress feature whose config sets `architecture_review_as_built.max_remediation_laps: 3` and whose entry records 1 lap, when the operator runs daemon status and kickback-budget inspect, then both report `1/3 consumed; 2 remaining` for that gate. | 4 | "both the `runDaemonStatus` line and `kickback-budget inspect` output contain `1/3 consumed; 2 remaining`" | diff-local |
| Story 2 negative: Given an in-progress feature whose ledger pending repair is malformed, when the operator runs daemon status, then the command exits 0, and for each of `prd_audit` and `architecture_review_as_built` the output contains a `KICKBACK BUDGET [<slug>]:` line reading `<gate>: budget unavailable (durable entry failed validation)` and no `consumed;` figure for that gate. | 5 | "resolves with `code: 0` and prints `prd_audit: budget unavailable (durable entry failed validation)` and `architecture_review_as_built: budget unavailable (durable entry failed validation)` on `KICKBACK BUDGET [broken-feature]:` lines" | diff-local |
| Story 2 negative: Given an in-progress feature whose `build_review` entry has no cap evidence and no adjustment history, when the operator runs daemon status, then no `KICKBACK BUDGET` line names `build_review` for that feature. | 5 | "a `build_review` entry with no cap evidence and no adjustment history produces no `KICKBACK BUDGET [review-feature]:` line naming `build_review`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
