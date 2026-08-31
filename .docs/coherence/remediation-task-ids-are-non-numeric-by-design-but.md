# Coherence Mapping: Shared plan-task reference resolver (#2064)

**Plan:** .docs/plans/remediation-task-ids-are-non-numeric-by-design-but.md
**Date:** 2026-08-30

FR row class omitted: technical track, no PRD.

| Row class | Cited id / criterion | Counterpart id(s) | Verdict | Quote | Disposition / Notes |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | Verdict Table citation of engine-appended tasks parses (Story 2 happy paths) |
| outcome | outcome-2 | story-3 | covered | Absent-id citation still rejected with named diagnostic (Story 3) |
| outcome | outcome-3 | story-2 | covered | Append-never-invalidates negative path in Story 2; regression-locked by task-4 |
| outcome | outcome-4 | story-1 | covered | One resolver on TASK_ID_PATTERN; Story 4 pins the documented rule to it |
| outcome | outcome-5 | story-2 | covered | Consequence: rem- citations parsing removes the need for the hand-renumbering; no un-renumbering task exists or is needed |
| adr | adr-2026-08-30-shared-plan-task-reference-resolver | story-1, story-2 | covered | Decisions 1-3 delivered by Stories 1-3; decision 4 (producer unchanged) constrains all tasks; decision 5 out of scope by design |
| story | story-1 | task-1, task-2 | covered | Both tasks cite Story 1 |
| story | story-2 | task-3, task-4, task-5 | covered | All three cite Story 2 |
| story | story-3 | task-6 | covered | Task 6 cites Story 3 |
| story | story-4 | task-7 | covered | Task 7 cites Story 4; its negative path enforced by task-5's FIXABLE test |
| task | task-1 | story-1 | covered | Happy-path resolver |
| task | task-2 | story-1 | covered | Negative-path resolver |
| task | task-3 | story-2 | covered | Parser adoption |
| task | task-4 | story-2 | covered | Regression lock |
| task | task-5 | story-2 | covered | FIXABLE semantics |
| task | task-6 | story-3 | covered | Diagnostics |
| task | task-7 | story-4 | covered | Skill text |
| criterion | Story 1 happy: Given the active plan contains task id `rem-prd-audit-rem-s1-6-1`, when the resolver is given the raw cell `rem-prd-audit-rem-s1-6-1`, then it returns that id as resolved | task-1 | covered | `{kind:'resolved', id:'rem-prd-audit-rem-s1-6-1'}` for that raw id | diff-local |
| criterion | Story 1 happy: Given the active plan contains integer task id `4`, when the resolver is given the raw cell `4`, then it returns `4` as resolved | task-1 | covered | returns `{kind:'resolved', id:'4'}` for raw `4` with plan set | diff-local |
| criterion | Story 1 happy: Given the active plan contains task id `rem-as-built-rem-ab1-2`, when the resolver is given the raw cell `rem-as-built-rem-ab1-2 (landed)`, then the trailing parenthesized annotation is stripped and the bare id is returned as resolved | task-1 | covered | same for `rem-as-built-rem-ab1-2 (landed)` (annotation stripped) | diff-local |
| criterion | Story 1 negative: Given the active plan does not contain task id `rem-test-9-9`, when the resolver is given the raw cell `rem-test-9-9`, then it returns a diagnostic naming `rem-test-9-9` as absent from the active plan | task-2 | covered | a plan set lacking it → `{kind:'unresolvable', id:'rem-test-9-9'}` | diff-local |
| criterion | Story 1 negative: Given any active plan, when the resolver is given a raw cell containing a character outside the H9 grammar such as `task#7`, then it returns a diagnostic naming the malformed reference rather than a resolved id | task-2 | covered | raw `task#7` → `{kind:'malformed', raw:'task#7'}` | diff-local |
| criterion | Story 1 negative: Given the active plan contains task id `7`, when the resolver is given the raw cell `7 landed extra words`, then it returns a diagnostic rather than silently resolving to `7` | task-2 | covered | `7 landed extra words` with plan set `{7}` → malformed | diff-local |
| criterion | Story 2 happy: Given an active plan containing tasks `1`-`21` and `rem-prd-audit-rem-s1-6-1`, when a prd_audit report row cites Plan task `rem-prd-audit-rem-s1-6-1 (landed)` on a PASS criterion, then the row is accepted and the report parses | task-3 | covered | a PASS row citing `rem-prd-audit-rem-s1-6-1 (landed)` | diff-local |
| criterion | Story 2 happy: Given an active plan containing task `rem-as-built-rem-ab1-3`, when a FIXABLE row cites Plan task `rem-as-built-rem-ab1-3`, then the row is accepted with that task recorded as the criterion's owner | task-3 | covered | a FIXABLE row citing `rem-as-built-rem-ab1-3` | diff-local |
| criterion | Story 2 negative: Given an active plan without task id `rem-prd-audit-zz-1`, when a FIXABLE row cites Plan task `rem-prd-audit-zz-1`, then the row is rejected with a diagnostic naming the criterion and the unresolvable id | task-5 | covered | FIXABLE row citing `rem-prd-audit-zz-1` absent from the plan | diff-local |
| criterion | Story 2 negative: Given any active plan, when a FIXABLE row has Plan task `—`, then the row is rejected as FIXABLE without a Plan task (existing behavior preserved) | task-5 | covered | FIXABLE row with Plan task `—` → rejected | diff-local |
| criterion | Story 2 negative: Given a plan to which the engine appends a remediation task, when the previously-parseable report is re-parsed unchanged, then it still parses (appending never invalidates existing rows) | task-4 | covered | re-parse the unchanged report — still parses with identical accepted rows | diff-local |
| criterion | Story 3 happy: Given a report whose row S2.3 cites an id absent from the plan, when the report is parsed, then the rejected-row reason contains both `S2.3` and the cited id verbatim | task-6 | covered | names Plan task rem-x-1, which is absent from the active plan | diff-local |
| criterion | Story 3 negative: Given a report whose row S2.3 cites a malformed reference, when the report is parsed, then the reason identifies the malformed text rather than the generic `has an invalid Plan task.` wording with no id | task-6 | covered | a reason containing `S2.3` and the malformed raw text verbatim | diff-local |
| criterion | Story 4 happy: Given the resolved rule that any Verdict Table row may cite a task present in the active plan while FIXABLE rows must, when the prd-audit skill text is read, then its Plan-task cell instructions state that rule and instruct emitting the bare id without annotation | task-7 | covered | any row may cite a task present in the active plan; FIXABLE rows must; emit the bare task id with no annotation | diff-local |
| criterion | Story 4 negative: Given the updated skill text, when a FIXABLE row omits a Plan task, then the documented and enforced outcome is still rejection (the widened citation rule does not weaken the FIXABLE requirement) | task-5 | covered | FIXABLE row with Plan task `—` → rejected | diff-local |
