# Conflict Report: existing-task disposition vs #1874 all-findings-appended assertion

## Conflict: Non-appending disposition contradicts "each finding is appended"

**Stories involved:** Story 1 (An existing-task disposition routes without growing the plan) vs Story 3 (All-remediable reports route to BUILD through the single appender)
**Files:** [.docs/stories/plan-growth-allowance-is-spent-on-work-existing-ta.md] vs [.docs/stories/every-as-built-blocked-verdict-halts-needs-human-i.md]
**Type:** contradiction
**Severity:** blocking

**Description:**
The #1874 story asserts every admitted remediable finding is appended to the plan ("each finding
is admitted as a remediation gap and appended to the plan through the existing remediation-append
primitive"). Decision 9 (adr-2026-08-25, amended 2026-08-31 by #2119) admits `existing-task`
findings without any append. Satisfying either story's criterion fails the other for an
existing-task-dispositioned finding.

**Resolution Options:**
1. Replace the superseded assertion in the #1874 story in place — qualify "each finding" to
   "each finding whose disposition appends" — shipped as a companion main-based PR (land stem
   gate rejects foreign-stem story edits on the spec branch; precedent #2114).
2. Scope the new Story 1 to as-built only and leave #1874's text intact (leaves a false
   assertion in an accepted artifact).
3. Route back to architecture (no structural gap exists — the amendment already governs).

**Recommendation:** Option 1 — the #1874 assertion is genuinely superseded; stories replace
superseded assertions in place, and the companion-PR vehicle is the established recovery for the
stem gate.

## Scan summary

- Corpus: `change_set` (conflict_check.adr_corpus unset) — the two ADRs amended by this spec;
  reconciled by the amendments themselves.
- All `.docs/stories/*.md` scanned for growth/remediation/append surface; only the #1874 file
  shares the gate. `build-review-rubrics-…` (build_review lane, asserts no plan append — still
  holds) and `audit-trail-…` (event-bus append seam, unrelated) verified non-conflicting.
- Oscillation check both directions on Story 4 (#1874, lap/growth caps): holds — existing-task
  laps still consume the lap allowance, second lap still halts kickback-cap.

## Resolution

Option 1 selected by operator 2026-08-31. Superseded assertion replaced in place via companion
main-based PR https://github.com/jstoup111/ai-conductor/pull/2122 (spec branch carries no
foreign-stem story edit). Re-check after resolution: zero blocking conflicts remain.
