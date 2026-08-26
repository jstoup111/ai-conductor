# Coherence Mapping: every-as-built-blocked-verdict-halts-needs-human-i

Technical track (no PRD — fr row class omitted). Outcomes from the staged intake outcomes for jstoup111/ai-conductor#1874. Stories 1–7; plan tasks 1–18; change-set ADRs: one new, two amended. Consistency pass (§4d) run over every covered row; no contradiction or oscillation found. Criterion rows quote a cited task's body verbatim; all dispositions are diff-local (each criterion is decided by this feature's own engine/skill diff and its tests).

| Row class | Cited id / criterion | Counterpart id(s) | Verdict | Notes / quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-3, story-6 | covered | Autonomous convergence + after-the-fact visibility of remediation per clause |
| outcome | outcome-2 | story-5 | covered | Design-decision findings still halt for a human |
| outcome | outcome-3 | story-5, story-6 | covered | Per-finding classification recorded in halt bodies and durable artifacts |
| outcome | outcome-4 | story-4 | covered | Termination: one lap, cap/allowance exhaustion reaches a human |
| outcome | outcome-5 | story-2 | covered | Unclear reports fail toward the human, never silent self-healing |
| adr | adr-2026-08-25-as-built-remediable-findings-bounded-build-route | story-1, story-2, story-3, story-4, story-5, story-6, story-7 | covered | All six decisions implemented across the story set |
| adr | adr-2026-08-22-as-built-review-runs-always-with-plan-gap | story-3 | covered | Decision 3 superseded via dated amendment note; decisions 1/2/4 untouched by any story |
| adr | adr-2026-08-22-one-owner-per-review-question | story-3 | covered | Appender clause amended; single-appender seam honored by the routing story |
| story | story-1 | task-1, task-2 | covered | Table contract + parser fixtures |
| story | story-2 | task-2, task-3, task-4 | covered | Parser, fail-closed negatives, widened outcome |
| story | story-3 | task-7, task-8, task-9, task-10, task-13, task-14 | covered | Admission, clause binding, append, both routing sites |
| story | story-4 | task-6, task-11, task-12, task-16 | covered | Cap resolution, ledger, exhaustion halts, escalation |
| story | story-5 | task-15 | covered | Design/mixed halts with listing |
| story | story-6 | task-17 | covered | Projection into verdict artifact + shipped record |
| story | story-7 | task-18 | covered | Lifecycle terminals + kill-switch revert |
| task | task-1 | story-1 | covered | Skill table contract |
| task | task-2 | story-1 | covered | Parser happy path (also grounds story-2) |
| task | task-3 | story-2 | covered | Parser negatives |
| task | task-4 | story-2 | covered | Outcome widening |
| task | task-5 | story-3 | covered | Infrastructure: config keys serving the routing and cap stories |
| task | task-6 | story-4 | covered | Per-gate lap cap |
| task | task-7 | story-3 | covered | Admission guard |
| task | task-8 | story-3 | covered | Clause-bound gaps |
| task | task-9 | story-3 | covered | Unresolvable clause halt |
| task | task-10 | story-3 | covered | Append rendering |
| task | task-11 | story-4 | covered | Ledger laps + isolation |
| task | task-12 | story-4 | covered | Exhaustion halts |
| task | task-13 | story-3 | covered | Serial site branch |
| task | task-14 | story-3 | covered | Group join branch |
| task | task-15 | story-5 | covered | Design/mixed halt |
| task | task-16 | story-4 | covered | Escalation re-arm |
| task | task-17 | story-6 | covered | Projection |
| task | task-18 | story-7 | covered | Terminals + revert |
| criterion | Story 1 happy: Given the as-built review reaches a BLOCKED verdict, when it writes the report, then the report contains a `## Blocking Findings` table with one row per finding carrying a finding id, a class from the closed set REMEDIABLE or DESIGN, a governing approved clause reference (ADR filename stem plus decision number, or a plan task id), and a one-line summary | task-1 | covered | "add the `## Blocking Findings` table to the BLOCKED artifact template" | diff-local |
| criterion | Story 1 happy: Given a finding whose remedy is already required by an APPROVED artifact, when the review classifies it, then the row's class is REMEDIABLE and its clause names that artifact and decision | task-1 | covered | "a REMEDIABLE row without a clause is malformed" | diff-local |
| criterion | Story 1 negative: Given a non-BLOCKED verdict (APPROVED, DRIFT NOTES, or PLAN_GAP), when the report is written, then no `## Blocking Findings` table is required and the existing verdict handling is byte-for-byte unchanged | task-4 | covered | "non-BLOCKED verdicts are byte-identical to today (no table required)" | diff-local |
| criterion | Story 1 negative: Given a finding requiring a decision no approved artifact has made, when the review classifies it, then the row's class is DESIGN and the prose `## Resolution` section still states the code-fix-or-superseding-ADR choice | task-1, task-2 | covered | "one with a DESIGN row produce the expected sets" | diff-local |
| criterion | Story 2 happy: Given a BLOCKED report whose table rows all carry a valid class and clause, when the engine classifies the outcome, then the outcome is blocked-remediable when every row is REMEDIABLE and blocked-design when any row is DESIGN | task-4 | covered | "returns `blocked-remediable` for an all-REMEDIABLE table, `blocked-design` for any DESIGN row" | diff-local |
| criterion | Story 2 negative: Given a BLOCKED report with no `## Blocking Findings` table, when the engine classifies the outcome, then the outcome is invalid and the feature halts with class needs-human and a halt body naming the missing table | task-3 | covered | "BLOCKED with no table" | diff-local |
| criterion | Story 2 negative: Given a table row whose class is not exactly REMEDIABLE or DESIGN, when the engine classifies the outcome, then the outcome is invalid and the halt body names the offending row and value | task-3 | covered | "unknown class value" | diff-local |
| criterion | Story 2 negative: Given a REMEDIABLE row that names no governing clause, when the engine classifies the outcome, then the outcome is invalid and the halt body names the clause-less finding | task-3 | covered | "REMEDIABLE row with empty clause" | diff-local |
| criterion | Story 2 negative: Given a table whose header row lacks a required column, when the engine classifies the outcome, then the outcome is invalid and the halt body names the malformed header | task-3 | covered | "header missing a required column" | diff-local |
| criterion | Story 3 happy: Given a blocked-remediable outcome within allowance, when the conductor handles the gate, then each finding is admitted as a remediation gap and appended to the plan through the existing remediation-append primitive with a task id prefixed for the as-built gate source, each task carrying its governing clause and a Done when block | task-8, task-10 | covered | "a `Governing clause:` line, parent task linkage, and a Done when block" | diff-local |
| criterion | Story 3 happy: Given tasks were appended, when routing completes, then execution navigates back to BUILD, the as-built gate is restaged stale, and after the rebuild the gate re-runs against a fresh report | task-13 | covered | "(tasks appended, navigate back to BUILD, gate restaged stale)" | diff-local |
| criterion | Story 3 happy: Given the re-run report is APPROVED, when the gate re-evaluates, then the SHIP tail proceeds and no halt is written | task-13 | covered | "the as-built step is restaged stale and re-runs after BUILD" | diff-local |
| criterion | Story 3 negative: Given the remediation kill switch is off, when a blocked-remediable outcome is handled, then no tasks are appended and the feature halts needs-human exactly as before this feature (a test proves the revert) | task-7, task-18 | covered | "with remediation disabled, a blocked-remediable outcome halts needs-human exactly as before this feature" | diff-local |
| criterion | Story 3 negative: Given a blocked-remediable outcome in a validation group, when the group commits, then exactly one consolidated remediation dispatch occurs (per-gate budgets intact) and sibling refusal stamping is unchanged | task-14 | covered | "exactly one consolidated planRemediation dispatch" | diff-local |
| criterion | Story 3 negative: Given an appended-task candidate whose governing clause cannot be resolved against the approved artifacts on disk, when admission runs, then that finding is not appended and the feature halts needs-human naming the unresolvable clause | task-9 | covered | "a needs-human halt naming the unresolvable clause" | diff-local |
| criterion | Story 4 happy: Given no prior as-built remediation lap, when tasks within the growth allowance are appended, then the ledger records one lap under the as-built gate key and the growth record's byGate breakdown gains the as-built key | task-11 | covered | "records one lap under the as-built gate key" | diff-local |
| criterion | Story 4 negative: Given one as-built lap already recorded, when the gate returns any BLOCKED outcome again, then no tasks are appended and the feature halts with class kickback-cap, the halt body listing every finding with its class and clause | task-12 | covered | "halts with class kickback-cap listing every finding with class and clause" | diff-local |
| criterion | Story 4 negative: Given the requested task count exceeds the remaining shared growth allowance, when admission runs, then no tasks are appended and the feature halts with class kickback-cap naming the allowance and the findings | task-12 | covered | "a request exceeding the remaining shared growth allowance" | diff-local |
| criterion | Story 4 negative: Given a remediation lap whose rebuild produced no tree movement, when the no-op escalation check runs for the as-built gate, then the lap escalates to a halt instead of re-dispatching | task-16 | covered | "zero tree movement and an unchanged verdict, the escalation check halts" | diff-local |
| criterion | Story 4 negative: Given an as-built lap is recorded, when the ledger is inspected, then build_review's cumulative counter and prd_audit's lap counter are unchanged (isolation test) | task-11 | covered | "build_review's cumulative counter and prd_audit's lap counter are unchanged" | diff-local |
| criterion | Story 5 happy: Given a BLOCKED report with at least one DESIGN row, when the conductor handles the gate, then the feature halts with class needs-human and the halt body records every finding with its id, class, and governing clause or open question | task-15 | covered | "halts needs-human listing all rows with id, class, and clause/open question" | diff-local |
| criterion | Story 5 negative: Given a report with both REMEDIABLE and DESIGN rows, when the gate is handled, then no tasks are appended for the REMEDIABLE rows (the human sees the whole report) and the halt lists all rows | task-15 | covered | "one DESIGN row among REMEDIABLE rows appends nothing" | diff-local |
| criterion | Story 5 negative: Given a design halt is cleared by the operator after resolution, when the daemon re-dispatches, then the gate re-runs freshly rather than resuming a discarded remediation route | task-15 | covered | "re-dispatch re-runs the gate freshly (no resumed route)" | diff-local |
| criterion | Story 6 happy: Given a feature converged after an as-built remediation lap, when the verdict artifact and shipped record are written, then they record each remediated finding with its class and governing clause via the existing recorded-findings renderer | task-17 | covered | "includes each remediated finding with class and clause in the verdict artifact and the shipped record" | diff-local |
| criterion | Story 6 happy: Given a feature halted on a DESIGN finding, when the halt record is written, then a reader can tell from the record why that finding halted rather than remediated | task-15 | covered | "The committed halt record carries the listing through the existing writeHaltMarker seam" | diff-local |
| criterion | Story 6 negative: Given the projection renderer receives a finding with a missing field, when it renders, then it fails closed (the defect surfaces as an error naming the field) rather than writing a partial record | task-17 | covered | "fails the render with an error naming the field" | diff-local |
| criterion | Story 6 negative: Given a converged feature, when the shipped record is parsed by its existing consumer, then pre-existing recorded-findings consumers still parse (shape is additive, proven by a round-trip test) | task-17 | covered | "existing recorded-findings consumers round-trip unchanged (additive shape)" | diff-local |
| criterion | Story 7 happy: Given a blocked-remediable route to BUILD, when the step exits, then exactly one lifecycle terminal is emitted for the started execution | task-18 | covered | "emits exactly one lifecycle terminal for the started execution" | diff-local |
| criterion | Story 7 negative: Given a kickback-cap halt, a design needs-human halt, or an invalid-report halt, when each exit fires, then each emits its terminal event and, on the validation-group commit path, the existing refusal stamp for the judging member, proven by one test per exit | task-18, task-14 | covered | "each of the four new exits (remediable route, kickback-cap halt, design needs-human halt, invalid needs-human halt) emits exactly one lifecycle terminal" | diff-local |
| criterion | Story 7 negative: Given the kill-switch-off halt path, when it fires, then its terminal emission matches today's behavior (no regression in the lifecycle rollup test) | task-18 | covered | "the kill-switch-off path matches today's terminal emission" | diff-local |
