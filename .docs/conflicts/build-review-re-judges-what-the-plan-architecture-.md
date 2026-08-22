# Conflict Check: One owner per review question (#1805)

**Date:** 2026-08-22
**Stories checked:** `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md` (Stories 1–16) against each other, the five `adr-2026-08-22-*` ADRs, and all 56 existing story files that mention build_review, prd_audit, the as-built review, kickbacks, or remediation.
**ADR corpus:** `repo_wide` (config). Examined: every APPROVED ADR in `.docs/decisions/` (full sweep performed during architecture review, recorded in `.docs/decisions/build-review-re-judges-what-the-plan-architecture-.md`). Narrowed out as fully superseded: `adr-2026-07-21-completeness-as-build-review-rubric`, `adr-2026-08-16-preservation-anchored-completeness-exemption`, `adr-2026-08-12-removal-anchored-tautology-exemption`, `adr-2026-08-15-verify-only-anchored-tautology-exemption`. Retained despite partial amendment: the 30 ADRs listed in the new ADRs' `Amends:` lines.
**Result:** 0 blocking, 1 degrading (resolved in place), 0 remaining.

## Oscillation pairs examined (both directions)

| Pair | If A fully holds, does B? | If B fully holds, does A? | Verdict |
|---|---|---|---|
| S3 test-quality FAIL → build vs S10 prd_audit cap | yes (build_review adds no tasks) | yes | clean |
| S5 task cannot close without Done when: evidence vs S10 prd_audit adds tasks | **no** if added tasks lack the block — they would close under the old rule, weaker than S5 intends | yes | degrading → resolved (below) |
| S7 code change invalidates prd_audit pass vs S10 one fix lap | yes — the audit after the fix is the verification run; the cap counts kickbacks, not audits | yes | clean |
| S8 FIXABLE needs an owning task vs S11 PLAN_GAP halts on happy-path | yes — grade is determined by whether a task owns the fix; a criterion cannot be both | yes | clean |
| S9 user-visible OVER_SCOPE halts vs S13 as-built never kicks back | yes | yes | clean |
| S9 operator-accepted widening vs S7 re-run on change | yes — acceptance record survives invalidation | yes | clean |
| S12 as-built runs on S-tier vs S2 empty container PASS | yes | yes | clean |
| S5 plan-gap halt at BUILD vs S11 plan-gap at prd_audit | yes — different phases; BUILD halts before SHIP is reached | yes | clean |
| S16 removal guard unchanged vs S10 appended tasks | yes | yes | clean |
| ADR one-owner "only prd_audit appends" vs S3/S4/S13 | yes — none of those append | yes | clean |

No demand-then-condemn pair exists: the only task-appending authority (prd_audit FIXABLE) requires an owning plan task, so it cannot demand work the plan does not authorize, and no remaining gate judges plan conformance.

## Conflict: Tasks added by prd_audit would escape the Done when: close rule

**Stories involved:** Story 5 (task close requires Done when: evidence) vs Story 10 (prd_audit adds tasks)
**Files:** `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md`
**Type:** overlap
**Severity:** degrading

**Description:** Story 5 exempts tasks without a Done when: block; Story 10 did not say whether added tasks carry one. Without it, every prd_audit fix task would close under the weaker legacy rule.

**Resolution Options:**
1. Added tasks carry a Done when: block that restates the criterion they fix (chosen).
2. Exempt added tasks explicitly.
3. Require the judge to author Done when: checks.

**Resolution applied:** Option 1 — Story 10 amended in place; the criterion is already required on the finding (Story 8), so the block is derived, not authored.

## Existing stories superseded by design

- `prd-audit-passes-on-a-partial-report-when-backgrou.md` asserted prd_audit is skipped on the technical track; replaced in place to reflect Story 7.
- Stories describing the scope/completeness/rootCause/tautology rubrics document shipped behavior this feature retires (Story 1); they are historical and are not contradicted by a live requirement, so they are left unchanged.

## Plan self-consistency pass (2026-08-22, after /plan)

Checked `.docs/plans/build-review-re-judges-what-the-plan-architecture-.md` task-by-task for internal contradictions and for coupling to repository state outside the plan's own surface.

| Pair / item | Finding | Resolution |
|---|---|---|
| Task 22 (prd_audit lap cap) vs existing generic `MAX_KICKBACKS_PER_GATE` count | two bounds on one gate — the generic count (2) could fire before or after the configurable lap cap | Task 22 states the lap cap replaces the generic count for `prd_audit` only; tested with the generic count lowered to 0 |
| Task 26 (no as-built → build route) vs the validation-group join that feeds prd_audit + as-built gaps into one `planRemediation` dispatch | as-built gaps would still reach remediation through the join | Task 26 excludes as-built findings from the join; a test with both gate outcomes appends only the prd_audit task |
| Task 11 reason `build_review_no_rubrics` vs Task 14 reason `test_quality_empty_scope` | distinct reasons for distinct states | clean |
| Task 5 deprecated list includes `tautology` vs Task 7 rename to `testQuality` vs Task 32 migration | consistent: old key ignored, new key configured, migration renames | clean |
| Line-number anchors (`config.ts:1093`, `steps.ts:228`, `conductor.ts:2756`, …) | couple tasks to a snapshot that other merged plans move | replaced with symbol/search hints |
| Task 14 "before preflight" / Task 15 "remove the rule" | ordering- and state-coupled wording | rewritten as end-state properties |
| Task 13 / Task 19 artifact resolution | "by slug" could match another plan if two plans share a stem prefix | resolve via the engine-recorded active plan path and its `**Stories:**` reference |
| Task 1–3 ordering | Done when: machinery was mid-plan, so earlier tasks in this build would close under the old rule | moved to Tasks 1–3 |

No blocking or oscillating pair in the plan. Result unchanged: 0 blocking, 1 degrading resolved.
