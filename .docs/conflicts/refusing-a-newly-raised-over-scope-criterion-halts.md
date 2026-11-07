# Conflict Check: Refusing a newly raised OVER_SCOPE criterion halts as malformed-history (#3548)

**Date:** 2026-10-31
**New stories:** `.docs/stories/refusing-a-newly-raised-over-scope-criterion-halts.md` (Stories 1–4)
**Result:** PASS after resolution — 1 blocking conflict found and resolved, 0 remaining, 0 degrading accepted.

## Inventory and narrowing

All 664 story files were narrowed by subject (over-scope decisions, cleared-block capture, widening history, recovery reasons). Stories compared in both directions:

- `over-scope-halt-accepts-one-criterion-per-clear-so.md`
- `reviewer-wording-drift-invalidates-an-approved-wid.md`
- `prd-audit-has-no-criterion-key-for-an-over-scope-f.md`
- `treat-re-affirmed-over-scope-decisions-as-inert.md`
- `over-scope-refusal-should-route-to-build-rework-in.md`
- `over-scope-accept-stranded-rebase-fence-re-halts-b.md`
- `prd-audit-receives-bounded-inputs-and-returns-vali.md`

Other subject-keyword matches (daemon halt, rebase, build-review and stacking stories) mention halts or the PRD audit but assert nothing about cleared-block capture or widening recovery reasons; narrowed out.

**ADRs examined:** `adr-2026-09-07-durable-prd-widening-decision-reconciliation` (as amended by #2521, #2522, #2931 and this spec), `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`, `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework`, `adr-2026-08-24-evidentiary-defects-are-not-waivable`. **Narrowed out:** every other approved ADR; none governs over-scope decision capture or PRD-widening recovery.

## Conflict: Offerless story entries could record a criterion the halt never offered

**Stories involved:** Story 1 (refusing-a-newly-raised-over-scope-criterion-halts) vs "cleared body containing an entry for a criterion the halted blocking set did not contain" (over-scope-halt-accepts-one-criterion-per-clear-so)
**Files:** [.docs/stories/refusing-a-newly-raised-over-scope-criterion-halts.md] vs [.docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The accepted story says: "Given a cleared body containing an entry for a criterion the halted blocking set did not contain, when the harvest runs, then that entry is refused, nothing is recorded for it, and the defect event names the unknown criterion". As first drafted, Story 1 recorded any decided offerless story-criterion entry by name, so an operator-added entry for an unoffered criterion would be recorded. Satisfying the draft breaks the accepted criterion. Satisfying the accepted criterion (all offerless entries rejected, as the offer path does today) breaks Story 1. (Confidence 95%, verified from both texts and `capturePrdWideningDecisions`.)

**Resolution Options:**
1. Capture an offerless story entry only when its criterion is an outside-visible OVER_SCOPE finding in the persisted `.pipeline/prd-audit.json` verdict; otherwise reject it, naming the criterion. An absent or unreadable verdict rejects it with a leave-pending recovery.
2. Check only that the criterion exists in the feature's sealed stories, and narrow the accepted story.
3. Accept the overlap as degrading and narrow the accepted story to NC criteria.

**Recommendation:** Option 1, because it honors the accepted story unchanged with an existing durable reader.

**Resolution (operator, 2026-10-31):** Option 1. Story 1 gained two negative paths and a verdict precondition on its happy paths; Story 2's happy paths gained the same precondition; Story 3's defect-kind list names the two new kinds. The architecture review (technical intent 1, feasibility, wiring surface), the complexity record and the #3548 D3 amendment note on `adr-2026-09-07` were updated to match. No ADR superseded.

## Pairs checked clean (both directions)

- **Valid sibling survives a defective row** (`reviewer-wording-drift` "one defective row and a valid sibling"; `over-scope-halt` "one valid accept entry and one defective entry"): Stories 1 and 3 strengthen this. Clean.
- **Changed offer reference is a named defect** (`reviewer-wording-drift`, `prd-audit-has-no-criterion-key`): NC entries keep full offer validation in Story 1. Clean.
- **Pending is inert / machine clear grants nothing** (`over-scope-halt` all-pending criteria, `over-scope-refusal` machine clear): Story 2 extends this to partial blocks. Clean.
- **Duplicate harvest is idempotent; an old replay never overrides a newer refusal** (`over-scope-halt`, `reviewer-wording-drift`, `prd-audit-has-no-criterion-key`, `prd-audit-receives-bounded-inputs`): Story 1's replay criterion uses the existing supersession check. Clean.
- **Criterion-keyed story decisions survive summary drift** (`prd-audit-has-no-criterion-key` S4.1): consistent with criterion-only scope. Clean.
- **Unparsable block names the defect** (`over-scope-halt` "fenced block is not parseable JSON"): Story 3 gives it its own reason. Clean.
- **invalid-decision recovery text** (`treat-re-affirmed-over-scope-decisions-as-inert`): kept as the reason for that kind. Clean.
- **Retired formats and corrupt, foreign or unknown-version stores are named, not emptied** (`over-scope-halt`, `reviewer-wording-drift`, `prd-audit-receives-bounded-inputs`): Stories 2 and 4 keep or sharpen these reasons. Clean.
- **Refusal rework routing and the rebase-fence decision note** (`over-scope-refusal-should-route-to-build-rework-in`, `over-scope-accept-stranded-rebase-fence-re-halts-b`): consume recorded decisions unchanged. Clean.

No oscillating pair: each pair was checked as "if A is fully satisfied, does B still hold?" in both directions.
