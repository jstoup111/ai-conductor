# Coherence: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25
**Plan stem:** `2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936`
**Track:** Technical
**Stories:** `.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`
**Plan:** `.docs/plans/2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md`

The technical track has no PRD FR row class, and no staged or committed intake-outcome artifact is
present, so only story and task rows apply. Per operator direction, Tasks 16–18 remain mapped to
behavior but create no dedicated automated historical-backfill tests; their proof is the real report,
record diff, strict validation, and diff-free rerun.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-ST-916-1 | task-2, task-3, task-4 | covered | Strict success, identity/integrity refusals, and reachability/dependency refusals have real task blocks. |
| story | story-ST-936-2 | task-1, task-5, task-6, task-7, task-8 | covered | Existing producer verification plus recorder, predicates, daemon side effects, and merged-guard enforcement are covered. |
| story | story-ST-916-3 | task-9, task-10, task-11, task-12 | covered | Association, stable workflow result, workflow failures, and protection preservation are covered. |
| story | story-ST-916-4 | task-13, task-14, task-15 | covered | Repair resolution, human-reviewed publication/status, and race/permission failures are covered. |
| story | story-ST-916-5 | task-16, task-17, task-18 | covered | Real audit implementation, complete-history execution, exact-diff verification, and idempotency are covered. |
| story | story-ST-936-6 | task-18, task-19, task-20 | covered | Backfill durability, discovery regression, and integrated fresh-checkout verification are covered. |
| task | task-1 | story-ST-936-2 | covered | Verifies the story's #937/#943 prerequisite without duplicating production work. |
| task | task-2 | story-ST-916-1 | covered | Implements the strict valid verdict and repeated-read behavior. |
| task | task-3 | story-ST-916-1 | covered | Covers missing, malformed, mismatch, and read-only refusal behavior. |
| task | task-4 | story-ST-916-1 | covered | Covers reachability and dependency failure behavior. |
| task | task-5 | story-ST-936-2 | covered | Gates terminal recorder writes on strict evidence. |
| task | task-6 | story-ST-936-2 | covered | Gates finish and complete-state predicates. |
| task | task-7 | story-ST-936-2 | covered | Gates daemon side effects and preserves refused work. |
| task | task-8 | story-ST-936-2 | covered | Replaces synthetic merged success with verified convergence. |
| task | task-9 | story-ST-916-3 | covered | Implements exact implementation association and not-applicable classification. |
| task | task-10 | story-ST-916-3 | covered | Adds the stable always-reporting PR check. |
| task | task-11 | story-ST-916-3 | covered | Keeps workflow failures non-successful. |
| task | task-12 | story-ST-916-3 | covered | Preserves the live ruleset while adding the required context. |
| task | task-13 | story-ST-916-4 | covered | Plans deterministic aligned/repair outcomes. |
| task | task-14 | story-ST-916-4 | covered | Publishes one human-merged repair PR and exact-head status. |
| task | task-15 | story-ST-916-4 | covered | Covers repair races, invalid heads, and permission failures. |
| task | task-16 | story-ST-916-5 | covered | Implements the real audit and durable completeness report without a dedicated backfill suite. |
| task | task-17 | story-ST-916-5 | covered | Executes complete history and manually inspects every proposed record. |
| task | task-18 | story-ST-916-5, story-ST-936-6 | covered | Strictly validates generated records and proves idempotent durable backfill. |
| task | task-19 | story-ST-936-6 | covered | Pins existing fresh-checkout discovery semantics. |
| task | task-20 | story-ST-916-1, story-ST-936-2, story-ST-916-3, story-ST-916-4, story-ST-916-5, story-ST-936-6 | covered | Runs integrated verification and performs the post-observation ruleset cutover. |

## Verify-Claims Verdict

**CLEAR.** Each story and task id above was checked against the amended source artifacts. No
load-bearing assumption remains: #937/#943 are verified existing behavior, and the remaining rows
map only unresolved enforcement, recovery, and backfill work.
