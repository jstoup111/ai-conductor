# Conflict Check: As-built review re-raises reworded findings as new obligations

**Date:** 2026-10-28
**New stories:** `.docs/stories/as-built-review-re-raises-reworded-findings-as-new.md` (Stories 1–6)
**Result:** PASS. One blocking contradiction was resolved by amending two existing stories in place. Zero conflicts remain.

## Inventory

- **Stories:** all 650 files in `.docs/stories/` were inventoried. They were narrowed by subject to
  about 40 that touch:
  - as-built remediation;
  - `existing-task` binding;
  - gap-plan inputs and contract;
  - the remediation case store and its domains;
  - pending as-built findings;
  - lap and growth accounting.

  Each was compared in both directions against Stories 1–6. The closest were:
  - `remediation-dispositions-honor-the-engine-owned-in.md`
  - `plan-growth-allowance-is-spent-on-work-existing-ta.md`
  - `every-as-built-blocked-verdict-halts-needs-human-i.md`
  - `remediation-halts-when-the-owning-plan-task-is-alr.md`
  - `reviewer-wording-drift-invalidates-an-approved-wid.md`
  - `as-built-review-receives-bounded-inputs-and-return.md`
  - `a-recurring-concern-at-a-resolved-anchor-escapes-i.md`
  - `build-review-re-raises-already-decided-findings-ev.md`
- **ADRs examined:**
  - `adr-2026-10-28-as-built-finding-reconciliation`
  - `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` (D3, D3.1, D4, D7, D9)
  - `adr-2026-09-07-durable-prd-widening-decision-reconciliation` (D2, D6.4)
  - `adr-2026-08-29-build-review-remediate-case-adjudication` (D2, D3)
  - `adr-2026-09-06-reopened-task-resolution`
  - `adr-2026-10-21-remediation-closure-judgement`
  - `adr-2026-10-12-routed-whole-feature-repair`
- **ADRs narrowed out:** all other approved ADRs. They address no behavior, entity or gate these
  stories touch, such as daemon lifecycle, rebase, tmux, intake, or release gates.
- **Prior reports:** none for this feature area.

## Conflict: existing-task owner-only binding vs binding a prior as-built repair task (resolved)

**Stories involved:**
- Story 3 of `as-built-review-re-raises-reworded-findings-as-new.md`
- the existing `existing-task` validation stories

**Files:**
- `.docs/stories/as-built-review-re-raises-reworded-findings-as-new.md`
- `.docs/stories/remediation-dispositions-honor-the-engine-owned-in.md`
- `.docs/stories/plan-growth-allowance-is-spent-on-work-existing-ta.md`

**Type:** contradiction
**Severity:** blocking

**Description:**
- **The existing criteria** rejected any `existing-task` binding to a task other than the finding's
  owner.
- **Story 3** admits a plan-task-cited `recurrence` finding that binds its owner task plus the prior
  `as_built` case's repair task, as approved in ADR decision 4.
- Both cannot hold for that plan.

**Resolution Options:**
1. **Amend the two existing criteria in place** (selected). A non-owner id is still rejected unless
   it is a repair task of the prior as-built case named by the disposition's `same` or `recurrence`
   reconciliation.
2. **Bind only the prior repair task.** This still contradicts the owner-binding rule in D3.1.
3. **Re-open architecture** to revise decision 4.

**Recommendation and selection:** Option 1, chosen by the operator. The root is the approved
design, which ADR decision 4 already decided, so story phrasing is the right layer to fix. The two
criteria were replaced in place.

## Re-check

After the amendment:
- every pair was re-tested in both directions;
- the owner-binding rule, the plan-growth accounting for `existing-task`, the lap-only charge,
  no-op escalation and the pending-finding record all hold together with Stories 1–6;
- no oscillation was found: satisfying Story 3 leaves the amended criteria true, and the reverse
  also holds.

Zero blocking or degrading conflicts remain.
