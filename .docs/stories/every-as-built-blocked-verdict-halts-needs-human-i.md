**Status:** Accepted

# Stories: every-as-built-blocked-verdict-halts-needs-human-i

Technical track (no PRD). Source: issue jstoup111/ai-conductor#1874, governed by
adr-2026-08-25-as-built-remediable-findings-bounded-build-route and the conditions in
architecture-review-2026-08-25-every-as-built-blocked-verdict-halts-needs-human-i.

## Story 1: BLOCKED reports carry a per-finding classification table

As the as-built review skill, I want every BLOCKED report to carry a machine-read
`## Blocking Findings` table so that the engine can tell remediable findings from design
findings.

### Acceptance Criteria

#### Happy Path
- Given the as-built review reaches a BLOCKED verdict, when it writes the report, then the report contains a `## Blocking Findings` table with one row per finding carrying a finding id, a class from the closed set REMEDIABLE or DESIGN, a governing approved clause reference (ADR filename stem plus decision number, or a plan task id), and a one-line summary
- Given a finding whose remedy is already required by an APPROVED artifact, when the review classifies it, then the row's class is REMEDIABLE and its clause names that artifact and decision

#### Negative Paths
- Given a non-BLOCKED verdict (APPROVED, DRIFT NOTES, or PLAN_GAP), when the report is written, then no `## Blocking Findings` table is required and the existing verdict handling is byte-for-byte unchanged
- Given a finding requiring a decision no approved artifact has made, when the review classifies it, then the row's class is DESIGN and the prose `## Resolution` section still states the code-fix-or-superseding-ADR choice

### Done When
- [ ] The architecture-review skill's as-built section specifies the table contract (columns, closed class set, clause grammar) and the skill validation suite passes
- [ ] A fixture BLOCKED report with the table parses; the table is additive so existing verdict parsing of all four verdicts is unchanged in the test suite

## Story 2: Fail-closed parsing of the classification table

As the conductor, I want a mechanical parser for the `## Blocking Findings` table that treats
any defect as invalid so that ambiguity always fails toward a human.

### Acceptance Criteria

#### Happy Path
- Given a BLOCKED report whose table rows all carry a valid class and clause, when the engine classifies the outcome, then the outcome is blocked-remediable when every row is REMEDIABLE and blocked-design when any row is DESIGN

#### Negative Paths
- Given a BLOCKED report with no `## Blocking Findings` table, when the engine classifies the outcome, then the outcome is invalid and the feature halts with class needs-human and a halt body naming the missing table
- Given a table row whose class is not exactly REMEDIABLE or DESIGN, when the engine classifies the outcome, then the outcome is invalid and the halt body names the offending row and value
- Given a REMEDIABLE row that names no governing clause, when the engine classifies the outcome, then the outcome is invalid and the halt body names the clause-less finding
- Given a table whose header row lacks a required column, when the engine classifies the outcome, then the outcome is invalid and the halt body names the malformed header

### Done When
- [ ] A parser for the table exists in the engine's artifact module, section-scoped and header-validated in the same shape as the prd-audit report parser, with unit tests covering each malformed case above
- [ ] The as-built outcome type distinguishes blocked-remediable from blocked-design, and invalid is returned for every malformed-table case

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
- Given an appended-task candidate whose governing clause cannot be resolved against the approved artifacts on disk, when admission runs, then that finding is not appended and the feature halts needs-human naming the unresolvable clause

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
- [ ] The recorded-findings projection includes as-built remediation entries in both the verdict artifact and the shipped record, with a round-trip parse test
- [ ] Daemon status output surfaces the as-built plan-growth entry through the existing PLAN GROWTH rendering

## Story 7: Every new exit emits its lifecycle terminal and refusal stamp

As the timing rollup, I want every new route and halt exit to close its execution interval so
that remediation never poisons lifecycle completeness.

### Acceptance Criteria

#### Happy Path
- Given a blocked-remediable route to BUILD, when the step exits, then exactly one lifecycle terminal is emitted for the started execution

#### Negative Paths
- Given a kickback-cap halt, a design needs-human halt, or an invalid-report halt, when each exit fires, then each emits its terminal event and, on the validation-group commit path, the existing refusal stamp for the judging member, proven by one test per exit
- Given the kill-switch-off halt path, when it fires, then its terminal emission matches today's behavior (no regression in the lifecycle rollup test)

### Done When
- [ ] Lifecycle tests cover all four new exits (route, cap halt, design halt, invalid halt) with exactly-one-terminal assertions
- [ ] Any new event member added for remediation declares its sink row in the compile-time-exhaustive sink registry
