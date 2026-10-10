**Status:** Accepted

# Stories: Plan-growth budget resolves daemon feature plans

Source: jstoup111/ai-conductor#2822. Track: technical. Tier: S.

Fixture conventions used below: a "daemon feature worktree" has `.pipeline/conduct-state.json` whose `feature_desc` is `<slug>`, has no `activePlanPath` in `.pipeline/engine-state.json` (the file is absent or omits the field), and has at least two plans in the plan corpus, one of which is `<slug>.md`. "Default config" means no `prd_audit.max_appended_tasks` / `prd_audit.max_appended_ratio` keys (defaults 5 and 0.25).

## Story 1: Budget views report the authored count of a daemon feature's own plan

As an operator, I want `daemon status` and `kickback-budget inspect` to count a daemon feature's authored plan tasks so that I can judge whether it can still self-remediate.

### Acceptance Criteria

#### Happy Path
- Given a daemon feature worktree whose `<slug>.md` holds 17 task headings, no kickback growth record, and default config, when `ai-conductor daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: authored 17; added 0; remaining 4/4`.
- Given the same worktree, when `ai-conductor kickback-budget inspect --feature <slug>` runs, then it prints `Plan growth: 0/4 added; 4 remaining (config-derived cap)`, and its `--format json` output reports `planGrowth.authored` 17 and `planGrowth.cap` 4.
- Given a worktree whose `.pipeline/engine-state.json` records an `activePlanPath` naming the plan-corpus file `other.md` (5 task headings) while `<slug>.md` holds 17, when `daemon status` renders the feature, then it reports `authored 5`.

#### Negative Paths
- Given a worktree with no `activePlanPath`, several plans, none whose stem equals the conduct-state feature, no growth record, and no raised growth cap, when `daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: plan unresolved; added 0` and contains no `remaining 0/0`; and `kickback-budget inspect` prints `Plan growth: plan unresolved; 0 added` instead of a numeric config-derived cap.
- Given a daemon feature worktree with no pending budget adjustment, whose stored growth record `{authored: 0, added: 2, byGate: {prd_audit: 2}}` disagrees with its resolved plan (12 headings), when `kickback-budget inspect` runs, then it reports `planGrowth.authored` 10 and `.pipeline/kickback-ledger.json` is byte-identical before and after the command.

### Done When
- [ ] `daemon status` and `kickback-budget inspect` print the exact lines above for each fixture.
- [ ] The unresolved fixture output contains the text `plan unresolved` and no `/0` cap.
- [ ] The inspect reconciliation fixture leaves the ledger file bytes unchanged.

## Story 2: Recorded appends count as added, and the reported cap is the enforced cap

As an operator, I want the budget views to report the same cap the engine enforces at the next remediation so that a lap raise is predicted correctly.

### Acceptance Criteria

#### Happy Path
- Given a daemon feature worktree whose `<slug>.md` holds 24 `### Task <n>:` headings and 9 `### Task rem-…:` headings, a stored growth record `{authored: 0, added: 9, byGate: {prd_audit: 5, architecture_review_as_built: 4}}`, and config `prd_audit.max_appended_tasks: 30`, `prd_audit.max_appended_ratio: 0.5`, when `daemon status` renders the feature, then its line is `PLAN GROWTH [<slug>]: authored 24; added 9 (prd_audit: 5, architecture_review_as_built: 4); remaining 3/12`, and `kickback-budget inspect --format json` reports `planGrowth` authored 24, added 9, cap 12, remaining 3.
- Given the same feature and a pending repair charging `prd_audit` growth 3, when pending-repair settlement runs with the growth budget the engine computes for that feature, then the repair settles and the recorded growth becomes added 12 with `prd_audit` 8.
- Given the same feature, when the engine reads the `prd_audit` remediation append budget, then its growth cap is 12, not 16 (the cap a count of all 33 headings would produce).

#### Negative Paths
- Given the same feature and a pending repair charging `prd_audit` growth 4, when pending-repair settlement runs with the growth budget the engine computes for that feature, then settlement reports `exhausted` for `prd_audit` with allowance `growth`, and the recorded growth stays added 9.
- Given a worktree with no resolvable plan, no growth record, and no raised growth cap, and a pending repair charging growth 1, when pending-repair settlement runs with the growth budget the engine computes, then settlement still reports `exhausted` with allowance `growth` (unresolved stays fail-closed).
- Given a stored raised `effectiveGrowthCap` of 20 on the Story 2 fixture, when `daemon status`, `kickback-budget inspect`, and the engine's growth budget are read, then all three use cap 20, and inspect labels it `raised cap`.

### Done When
- [ ] `daemon status`, `kickback-budget inspect`, and the engine growth budget report authored 24, added 9, cap 12 for the Story 2 fixture.
- [ ] Settlement admits a 3-task growth charge and refuses a 4-task growth charge for that fixture.
- [ ] The remediation append budget no longer derives its cap from a raw count of every task heading.

## Story 3: Refusal-rework admission sees a daemon feature's plan

As an operator, I want an over-scope refusal on a daemon feature to reach `/remediate` when growth allowance remains, so that it is not halted by a phantom cap of 0.

### Acceptance Criteria

#### Happy Path
- Given a daemon conductor run whose worktree has no `activePlanPath`, conduct-state feature `feature`, a plan-corpus file `feature.md` with 8 authored task headings beside a second plan, default config, and a `prd_audit` verdict that is an over-scope refusal, when the validation group routes refusal rework, then `/remediate` is dispatched exactly once and no HALT is written for the refusal-rework allowance.

#### Negative Paths
- Given the same run except that no plan-corpus file has the stem `feature`, when the validation group routes refusal rework, then `/remediate` is not dispatched and `.pipeline/HALT` is written for the refusal rework, as it is today.

### Done When
- [ ] The resolvable-plan run dispatches `/remediate` once with no refusal-rework HALT.
- [ ] The unresolvable-plan run dispatches no `/remediate` and writes `.pipeline/HALT`.
