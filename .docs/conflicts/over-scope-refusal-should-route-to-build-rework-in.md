# Conflict Check: Over-scope refusal routes to BUILD rework

**Date:** 2026-10-03
**Stories checked:** `.docs/stories/over-scope-refusal-should-route-to-build-rework-in.md` (Stories 1–5) against all `.docs/stories/`
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml`). Examined: adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback, adr-2026-08-24-over-scope-decision-block-and-durable-refusals, adr-2026-09-07-durable-prd-widening-decision-reconciliation, adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework. Narrowed out: ADRs not addressing prd_audit OVER_SCOPE routing, refusal or remediation admission.
**Result:** PASS after resolution. 3 blocking conflicts were resolved in stories; 0 degrading remain.

ADR-versus-story: the three older ADRs' "no repair task" clauses were amended additively during architecture-review to point at adr-2026-10-03. No ungrounded ADR conflict remains.

## Conflict: Recorded refusal never appends a plan task

**Stories involved:** Story 4 (A refusal durably blocks with a changed halt) vs new Story 1
**Files:** `.docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md` vs `.docs/stories/over-scope-refusal-should-route-to-build-rework-in.md`
**Type:** contradiction
**Severity:** blocking
**Description:** The old story said no plan task is ever appended on account of a refusal. The new story appends a bounded `rem-prd-audit-*` rework task when every blocking finding is refused.
**Resolution Options:** 1. Narrow the old assertion to permit only the ADR-bounded rework task. 2. Add an exception only in the new story.
**Resolution:** Option 1 (operator). The old negative path and the re-halt Given were narrowed in place.

## Conflict: NC refusal always re-halts and NC findings never become work

**Stories involved:** NC-key stories vs new Stories 1 and 3
**Files:** `.docs/stories/prd-audit-has-no-criterion-key-for-an-over-scope-f.md` vs the new stories file
**Type:** contradiction
**Severity:** blocking
**Description:** A refused NC finding always re-halted, and no NC finding could become work. The new stories admit bounded rework for refused NC findings, bound to the decision id.
**Resolution:** Option 1 (operator). The refused re-halt now applies when no rework is admitted. "No work" now applies to unrefused NC findings. The Done When line was narrowed to match.

## Conflict: Refused NC routing creates no plan task or BUILD work order

**Stories involved:** Wording-drift reconciliation stories vs new Story 1
**Files:** `.docs/stories/reviewer-wording-drift-invalidates-an-approved-wid.md` vs the new stories file
**Type:** contradiction
**Severity:** blocking
**Description:** The refusal branch created no plan task or BUILD work order, and replay had "no NC repair effects".
**Resolution:** Option 1 (operator). The only exception is the bounded rework task bound to the refusal decision id, never the NC ordinal. The replay Done When line allows the idempotent decision-keyed task.

## Oscillation check

The new Story 1 (rework when all are refused) and Story 2 (halt when any finding is pending) were checked in both directions against old Story 4's convergence bound. Satisfying either one leaves the other intact: pending wins, and the lap cap preserves termination. No oscillation.
