# Coherence: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver (#1736)

**Date:** 2026-08-19
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; the stories file carries the
requirement layer).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1736, carried into the
spec by the `.docs/intake/` marker landed with this branch.
**Waiver:** `.docs/coherence-waivers/plan-tasks-can-declare-a-protected-artifact-outcom.md` — every
`outcome-*` row below carries a `gap` verdict, deliberately and on the record. #1736's Desired
outcome section was written against the filer's diagnosis (repair the `build_review` completeness
rubric so it can see sealed-artifact outcomes). Investigation established the root cause is
upstream: the plan should never have been able to carry a task whose outcome BUILD is structurally
forbidden to deliver. This spec fixes that cause. It delivers none of the six rubric-behavior
bullets as written, and does not pretend to.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 |  | gap | "A completeness `missing-outcome` finding whose outcome is satisfied in a sealed artifact passes without operator intervention." Not delivered: this spec prevents the plan from creating such a task, rather than teaching the rubric to forgive one. Waived. |
| outcome | outcome-2 |  | gap | "The same holds when remediation emitted `remediation_sealed_artifact_redirect`." Same disposition as outcome-1 — a rubric-evidence change this spec deliberately does not make. Waived. |
| outcome | outcome-3 |  | gap | "A genuinely missing outcome still FAILs completeness." Preserved by construction (no rubric change), but preservation is not delivery; claiming coverage would overstate. Waived. |
| outcome | outcome-4 |  | gap | "A rerun after an operator reseal judges fresh evidence." Requires changing the projection digest, which deliberately excludes reseals (`build-review-inputs.ts:197`). Out of scope; belongs with the rubric work. Waived. |
| outcome | outcome-5 |  | gap | "A build kickback whose remediation concludes no build change is required does not decrement the budget." Owned by #1629, whose spec is merged and whose build is in flight as PR #1734. Waived to avoid a collision. |
| outcome | outcome-6 |  | gap | "When completeness declines a finding on sealed-artifact grounds, the reason and matching artifact are recorded." Presupposes the declining behavior of outcome-1. Waived. |
| adr | adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts | story-4 | covered | The governing decision. Its §4 already ordered mechanical enforcement at authoring and land; this spec repairs an implementation that did not match it, and its §3 directory list is corrected additively by story-4. No clause of it is contradicted or superseded. |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | The union plus its regression floor, both negative paths, and the corpus false-positive floor. |
| story | story-2 | task-5 | covered | CLI message corrected; asserts both the removed `**Files:**` advice and the unchanged clean-plan exit 0. |
| story | story-3 | task-6, task-7 | covered | `skills/plan` gains the fifth directory and the any-reference scope; `HARNESS.md` and `skills/remediate` gain the fifth directory. |
| story | story-4 |  | covered | Delivered during DECIDE and already committed on this spec branch. It carries no task deliberately: the artifact is under `.docs/decisions/`, so tasking its mutation would commit the exact violation this feature prevents (governing ADR §1 and §4). |
| story | story-5 | task-8 | covered | Runbook authored. Registration is deliberately not tasked — the gating `maintain-documentation` step owns human-facing documentation and the README runbook list. |
| task | task-1 | story-1 | covered | RED: a task with a `**Files:**` line and a foreign protected path in prose yields a violation. Fails on `main`. |
| task | task-2 | story-1 | covered | Regression floor plus the own-feature and non-protected negatives; green before and after. |
| task | task-3 | story-1 | covered | GREEN: `hasFilesLineByTaskId` either/or replaced by a union; predicate and dedup unchanged. |
| task | task-4 | story-1 | covered | Corpus floor asserting every reported violation names a real protected path in that task. |
| task | task-5 | story-2 | covered | `cli.ts:433` message replaced; no longer advises the edit that silences the prose scan. |
| task | task-6 | story-3 | covered | `skills/plan` §3 gains `.docs/decisions/` and extends beyond the `**Files:**` set, own-feature carve-out preserved. |
| task | task-7 | story-3 | covered | `HARNESS.md:123-124` and `skills/remediate/SKILL.md:101` gain the fifth directory. |
| task | task-8 | story-5 | covered | Runbook authored; the file only, with registration left to the maintain-documentation step. |
