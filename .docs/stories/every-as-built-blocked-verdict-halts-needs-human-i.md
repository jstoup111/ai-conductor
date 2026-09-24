**Status:** Accepted

# Stories: every-as-built-blocked-verdict-halts-needs-human-i

Technical track (no PRD). Source: issue jstoup111/ai-conductor#1874, governed by
adr-2026-08-25-as-built-remediable-findings-bounded-build-route and the conditions in
architecture-review-2026-08-25-every-as-built-blocked-verdict-halts-needs-human-i.

## Story 1: BLOCKED reports carry a per-finding classification table

As the as-built review skill, I want every BLOCKED verdict to carry typed per-finding
classifications so that the engine can tell remediable findings from design findings.

### Acceptance Criteria

#### Happy Path
- Given the as-built review reaches a BLOCKED verdict, when it returns its structured result, then the typed verdict carries one finding per blocking issue with a finding id, a class from the closed set REMEDIABLE or DESIGN, a structural governing reference (`{kind: "adr-decision", stem, decision}` or `{kind: "plan-task", taskId}`), and a one-line summary
- Given a finding whose remedy is already required by an APPROVED artifact, when the review classifies it, then the finding's class is REMEDIABLE and its reference names that artifact and decision

#### Negative Paths
- Given a non-BLOCKED verdict (APPROVED, DRIFT NOTES, or PLAN_GAP), when the structured result is validated, then it carries no findings, a findings array on it is rejected, and the existing verdict handling is unchanged
- Given a finding requiring a decision no approved artifact has made, when the review classifies it, then the finding's class is DESIGN and the rendered report's resolution text still states the code-fix-or-superseding-ADR choice

### Done When
- [ ] The as-built output contract defines the typed finding (id, closed class set, structural reference, summary), the architecture-review skill's as-built section carries the class semantics as judgement guidance, and the skill validation suite passes
- [ ] A fixture BLOCKED typed verdict with findings validates, and contract tests accept all four verdicts with findings admitted only on BLOCKED

## Story 2: Fail-closed parsing of the classification table

As the conductor, I want mechanical validation of the typed as-built findings that treats any
defect as a rejected result so that ambiguity never becomes a verdict and always fails toward a
human.

### Acceptance Criteria

#### Happy Path
- Given a BLOCKED typed verdict whose findings all carry a valid class and resolvable reference, when the engine classifies the outcome, then the outcome is blocked-remediable when every finding is REMEDIABLE and blocked-design when any finding is DESIGN

#### Negative Paths
- Given a BLOCKED structured result with no findings, when the engine validates it, then it is rejected naming `findings`, the attempt is scored `absent`, and the step reruns in a fresh session within its existing retry budget
- Given a finding whose class is not exactly REMEDIABLE or DESIGN, when the engine validates the result, then it is rejected naming that finding's class field and the admitted values, and the attempt is scored `absent` and reruns
- Given a REMEDIABLE finding that carries no reference, when the engine validates the result, then it is rejected naming that finding's reference field, and the attempt is scored `absent` and reruns
- Given every retry in the budget ends in a rejected or missing structured result, when the budget is exhausted, then the feature halts with class needs-human and a halt body naming the as-built step and the last rejected field

### Done When
- [ ] Contract validation of the typed as-built result rejects each malformed case above with a field-named diagnostic, covered by unit tests, and a dispatch-path test proves a rejected result scores `absent`, reruns, and halts needs-human on exhaustion
- [ ] The as-built outcome type distinguishes blocked-remediable from blocked-design, and no rejected result is ever classified as a verdict

## Story 3: All-remediable reports route to BUILD through the single appender

As the daemon, I want a fully remediable BLOCKED report to append clause-bound remediation
tasks and route back to BUILD so that the feature converges without an operator.

### Acceptance Criteria

#### Happy Path
- Given a blocked-remediable outcome within allowance, when the conductor handles the gate, then each finding is admitted as a remediation gap, and each finding whose disposition appends is appended to the plan through the existing remediation-append primitive with a task id prefixed for the as-built gate source, each task carrying its governing clause and a Done when block (an existing-task-dispositioned finding is admitted without an append and charges no plan growth, per adr-2026-08-25 decision 9)
- Given tasks were appended, when routing completes, then execution navigates back to BUILD, the as-built gate is restaged stale, and after the rebuild the gate re-runs against a fresh report
- Given the re-run report is APPROVED, when the gate re-evaluates, then the SHIP tail proceeds and no halt is written

#### Negative Paths
- Given the remediation kill switch is off, when a blocked-remediable outcome is handled, then no tasks are appended and the feature halts needs-human exactly as before this feature (a test proves the revert)
- Given a blocked-remediable outcome in a validation group, when the group commits, then exactly one consolidated remediation dispatch occurs (per-gate budgets intact) and sibling refusal stamping is unchanged
- Given a REMEDIABLE finding whose structural reference cannot be resolved against the approved artifacts on disk or the active plan, when the structured result is validated, then it is rejected naming that reference field, the attempt is scored `absent` and reruns, no task is appended, and admission's own resolution check remains a defensive invariant that halts needs-human naming the unresolvable reference

### Done When
- [ ] Both halt-writer sites (serial SHIP walk and validation-group join) branch on the widened outcome; blocked-remediable reaches the remediation path in both, proven by tests at each site
- [ ] Appended tasks render with the gate source, governing clause line, parent linkage, and Done when block; the plan amendment is committed the same way prd-audit appends are
- [ ] The config kill switch exists, is validated, defaults to enabled, and its off state restores halt-always behavior in a test

## Story 4: Remediation terminates — one lap, shared growth allowance

As the operator, I want as-built remediation bounded so that a surviving finding reaches me
instead of looping.

### Acceptance Criteria

#### Happy Path
- Given no prior as-built remediation lap, when tasks within the growth allowance are appended, then the ledger records one lap under the as-built gate key and the growth record's byGate breakdown gains the as-built key

#### Negative Paths
- Given one as-built lap already recorded, when the gate returns any BLOCKED outcome again, then no tasks are appended and the feature halts with class kickback-cap, the halt body listing every finding with its class and clause
- Given the requested task count exceeds the remaining shared growth allowance, when admission runs, then no tasks are appended and the feature halts with class kickback-cap naming the allowance and the findings
- Given a remediation lap whose rebuild produced no tree movement or net resolved-task progress and whose effective review still fails unchanged, when the no-op escalation check runs for the as-built gate, then the lap escalates to a halt instead of re-dispatching; a passing effective review ends the cycle even without tree movement
- Given an as-built lap is recorded, when the ledger is inspected, then build_review's cumulative counter and prd_audit's lap counter are unchanged (isolation test)

### Done When
- [ ] The as-built gate has its own lap cap config key (default 1) resolved through the per-gate cap function, validated in config, and documented
- [ ] Ledger tests prove lap recording under the as-built gate key, growth byGate accounting, cap and allowance halts with class kickback-cap, and counter isolation
- [ ] The capture/check no-op escalation pair is armed for the as-built gate with a test for the zero-progress halt

## Story 5: Design findings and mixed reports still halt for a human

As the operator, I want any finding that needs a real decision to reach me with its
classification recorded so that only genuine design questions cost a round trip.

### Acceptance Criteria

#### Happy Path
- Given a BLOCKED report with at least one DESIGN row, when the conductor handles the gate, then the feature halts with class needs-human and the halt body records every finding with its id, class, and governing clause or open question

#### Negative Paths
- Given a report with both REMEDIABLE and DESIGN rows, when the gate is handled, then no tasks are appended for the REMEDIABLE rows (the human sees the whole report) and the halt lists all rows
- Given a design halt is cleared by the operator after resolution, when the daemon re-dispatches, then the gate re-runs freshly rather than resuming a discarded remediation route

### Done When
- [ ] Tests at both halt-writer sites prove a single DESIGN row forces the needs-human halt with the full per-finding listing and appends nothing
- [ ] The committed halt record carries the per-finding listing through the existing writeHaltMarker seam with no new halt class

## Story 6: The operator can see afterward what was remediated and why

As the operator, I want per-finding classification and remediation outcomes projected into the
durable artifacts so that I can audit convergence without reading daemon logs.

### Acceptance Criteria

#### Happy Path
- Given a feature converged after an as-built remediation lap, when the verdict artifact and shipped record are written, then they record each remediated finding with its class and governing clause via the existing recorded-findings renderer
- Given a feature halted on a DESIGN finding, when the halt record is written, then a reader can tell from the record why that finding halted rather than remediated

#### Negative Paths
- Given the projection renderer receives a finding with a missing field, when it renders, then it fails closed (the defect surfaces as an error naming the field) rather than writing a partial record
- Given a converged feature, when the shipped record is parsed by its existing consumer, then pre-existing recorded-findings consumers still parse (shape is additive, proven by a round-trip test)

### Done When
- [ ] The recorded-findings projection writes as-built remediation entries into the typed as-built verdict, re-renders the report from it, and the shipped record reads them from the typed verdict, with a test asserting both carry each finding's class, reference, and outcome
- [ ] Daemon status output surfaces the as-built plan-growth entry through the existing PLAN GROWTH rendering

## Story 7: Every new exit emits its lifecycle terminal and refusal stamp

As the timing rollup, I want every new route and halt exit to close its execution interval so
that remediation never poisons lifecycle completeness.

### Acceptance Criteria

#### Happy Path
- Given a blocked-remediable route to BUILD, when the step exits, then exactly one lifecycle terminal is emitted for the started execution

#### Negative Paths
- Given a kickback-cap halt or a design needs-human halt, when each exit fires, then each emits its terminal event and, on the validation-group commit path, the existing refusal stamp for the judging member, proven by one test per exit
- Given an as-built structured result that is still rejected or missing when the retry budget is exhausted, when the exit fires, then it emits its terminal event and, on the validation-group commit path, is handled as a no-verdict branch through the existing step-failure handling, recorded `failed` rather than `refused`, with no synthetic remediation gap
- Given the kill-switch-off halt path, when it fires, then its terminal emission matches today's behavior (no regression in the lifecycle rollup test)

### Done When
- [ ] Lifecycle tests cover all four new exits (route, cap halt, design halt, exhausted invalid-result halt) with exactly-one-terminal assertions
- [ ] Any new event member added for remediation declares its sink row in the compile-time-exhaustive sink registry
