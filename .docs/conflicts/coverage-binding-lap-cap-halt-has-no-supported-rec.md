# Conflict Check: coverage_binding lap-cap halt has no supported recovery (#2846)

**Date:** 2026-10-10
**Inventory:** all 584 story files, the prior `.docs/conflicts/` reports, scanned by keyword for `kickback-budget`, kickback budget, `coverage_binding` laps and reopen, `--child`, and gate-set assertions. 33 candidate story files matched; the 10 whose criteria touch the kickback-budget command family, the coverage_binding reopen, or child-scoped recovery were read in full: `a-halted-feature-only-re-runs-when-a-human-clears-`, `consume-kickback-raise-matching-the-live-halt-gene`, `kickback-cap-raise-replays-the-halted-lap-s-remedi`, `kickback-ledger-json-reports-count-0-for-a-gate-wh`, `clear-kickback-raise-halts-without-a-halt-record`, `plan-growth-budget-reads-authored-0-and-cap-0-for-`, `coverage-binding-retries-past-its-3-3-budget-when-`, `post-plan-decide-amendments-never-reconcile-with-t`, `build-loop-cannot-complete-a-feature-child-by-chil`, `a-change-to-one-stacked-child-cannot-be-carried-in`.
**ADR corpus:** repo-wide. All 345 `adr-*.md` files were examined by subject. Narrowed in: `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` (governing; carries forward the superseded `adr-2026-08-29-operator-authorized-kickback-budget-recovery` D1-D8, retained because its supersession is partial), `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`, `adr-2026-08-31-kickback-ledger-read-fails-closed`, `adr-2026-08-31-coverage-binding-judge-step`, `adr-2026-09-06-reopened-task-resolution`, `adr-2026-10-07-per-child-build-region`, `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-07-28-total-halt-classification-legacy-boundary`. The other 337 were narrowed out as off-subject (providers, release, intake, git guards, rubrics, plan shape, telemetry). None was excluded as fully superseded.
**Result:** **PASS. Zero blocking conflicts remain.** One degrading ADR-versus-story overlap was found and resolved by an additive ADR amendment. Every pair below was tested in both directions; no oscillation exists.

## Conflict: kickback-budget defaults to the active child, but coverage_binding is charged in the feature ledger

**Stories involved:** Story 6 "coverage_binding recovery works on a stacked feature with child state" vs ADR `adr-2026-10-07-per-child-build-region` decision 11 (and the per-child CLI story in `build-loop-cannot-complete-a-feature-child-by-chil`)
**Files:** `.docs/stories/coverage-binding-lap-cap-halt-has-no-supported-rec.md` vs `.docs/decisions/adr-2026-10-07-per-child-build-region.md`
**Type:** overlap
**Severity:** degrading
**Confidence:** 90%. The coverage_binding reopen calls `settleRemediationRound(projectRoot, …)` with no child, so its laps are in the feature ledger; the CLI resolves the active child when children exist, so a raise would find no coverage_binding cap evidence there and refuse.
**ADR filename stem:** adr-2026-10-07-per-child-build-region
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "`rewind`, `task` and `kickback-budget` default `--child` to the active child."
**Story opposing sentence (verbatim):** "Given a feature with child state and an active child, and a coverage_binding cap halt recorded in the feature ledger, when the operator runs `raise --gate coverage_binding` without `--child`, then the grant is applied to the feature ledger and the active child's ledger is unchanged."

**Description:** Both hold only if the active-child default is read as applying to child-scoped gates. The same ADR already places coverage_binding outside the region ("Targets at or before `coverage_binding` keep today's behavior.") and keeps repair budgets feature-wide ("Plan growth and repair budgets stay feature-wide."), so the default was never meant to move a feature-wide repair budget into a child ledger; it simply did not name the exception.

**Resolution Options:**
1. Additive amendment to decision 11 (and decision 10's recovery read) scoping the active-child default to child-scoped gates and naming coverage_binding as feature-scoped; mirrored by the governing recovery ADR's decision 6.6.
2. Route coverage_binding's laps into the active child's ledger when children exist, contradicting decision 10's feature-wide repair budget and decision 4's pre-region behavior.
3. Exclude stacked features from coverage_binding recovery, leaving their cap halt unrecoverable — the defect this feature exists to remove.

**Resolution (2026-10-10, under operator pre-authorization):** Option 1. `adr-2026-10-07-per-child-build-region` carries an additive `Amended 2026-10-10 by #2846` note after decision 11; `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` decision 6.6 states the same rule. The sealed `build-loop-cannot-complete-a-feature-child-by-chil` criteria name only `build_review`, so they still hold unchanged.

## Pairs examined with no conflict

- **`a-halted-feature-only-re-runs-when-a-human-clears-` Stories 4-6** (inspect renderer, raise/reset refusals including "unknown gate"). New Stories 2, 4, 5 extend the gate set; "unknown gate" stays refused (Story 5 negative paths). Both directions hold.
- **`kickback-cap-raise-replays-the-halted-lap-s-remedi`** "Given a coverage_binding existing-task reopen, when its tasks are re-staged, then its lap is charged at restage exactly as today and no pending repair is recorded for it." Story 3 still charges at restage and records no pending repair. Both directions hold.
- **`consume-kickback-raise-matching-the-live-halt-gene`** (sweep consumes only a generation-matched authorization). Story 3 relies on exactly that sweep; Story 6 adds the feature-ledger read without changing the match rule.
- **`coverage-binding-retries-past-its-3-3-budget-when-`** (a typed refusal dispatches once, no retry). The cap halt stays a typed `needs-human` refusal (Story 1); its output still equals its reason.
- **`post-plan-decide-amendments-never-reconcile-with-t`** (a reseal voids coverage_binding to `invalidated`). Story 3's judge-enabled criterion preserves that invalidated eligibility across a cap halt, which is consistent with, not opposed to, the void.
- **`a-change-to-one-stacked-child-cannot-be-carried-in`** (the `restack` pseudo-gate, `--child` validated against the cascades ref). coverage_binding refuses `--child`; restack keeps its own rule. No shared field.
- **`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D1** ("A cumulative `build_review` cap terminal writes `HALT.class = needs-human`.") and its scoping amendment: coverage_binding also halts `needs-human`, adding no class. No conflict.
- **`adr-2026-09-06-reopened-task-resolution` decision 10** ("under the engine's default per-gate lap cap (no new config key)"): the default stays the default and no config key is added; a feature-local operator raise is the recovery D2-amended-by-#2190 already grants the other lap gates. Recorded in the governing ADR's D6.4.
