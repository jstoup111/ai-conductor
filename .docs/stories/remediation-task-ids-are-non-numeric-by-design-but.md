**Status:** Accepted

# Stories: Shared plan-task reference resolver (#2064)

Technical track — criteria derive from issue #2064's desired outcomes and
adr-2026-08-30-shared-plan-task-reference-resolver.

## Story 1: Cited plan-task references resolve through the shared resolver

As the engine, I want one resolver for cited plan-task references so that consumers cannot
independently narrow the id grammar.

### Acceptance Criteria

#### Happy Path
- Given the active plan contains task id `rem-prd-audit-rem-s1-6-1`, when the resolver is given the raw cell `rem-prd-audit-rem-s1-6-1`, then it returns that id as resolved
- Given the active plan contains integer task id `4`, when the resolver is given the raw cell `4`, then it returns `4` as resolved
- Given the active plan contains task id `rem-as-built-rem-ab1-2`, when the resolver is given the raw cell `rem-as-built-rem-ab1-2 (landed)`, then the trailing parenthesized annotation is stripped and the bare id is returned as resolved

#### Negative Paths
- Given the active plan does not contain task id `rem-test-9-9`, when the resolver is given the raw cell `rem-test-9-9`, then it returns a diagnostic naming `rem-test-9-9` as absent from the active plan
- Given any active plan, when the resolver is given a raw cell containing a character outside the H9 grammar such as `task#7`, then it returns a diagnostic naming the malformed reference rather than a resolved id
- Given the active plan contains task id `7`, when the resolver is given the raw cell `7 landed extra words`, then it returns a diagnostic rather than silently resolving to `7`

### Done When
- [ ] A resolver function is exported from the module that owns `TASK_ID_PATTERN` (or a sibling module beside it), taking a raw reference plus a plan id set and returning a resolved id or a diagnostic value
- [ ] Unit tests cover integer id, `rem-` id, annotated id, absent id, malformed id, and trailing-garbage cases with exact expected outputs

## Story 2: prd_audit Verdict Table accepts any id present in the active plan

As an operator, I want a Verdict Table row citing an engine-appended remediation task to parse so
that the feature does not deadlock in a regenerating mechanical halt.

### Acceptance Criteria

#### Happy Path
- Given an active plan containing tasks `1`-`21` and `rem-prd-audit-rem-s1-6-1`, when a prd_audit report row cites Plan task `rem-prd-audit-rem-s1-6-1 (landed)` on a PASS criterion, then the row is accepted and the report parses
- Given an active plan containing task `rem-as-built-rem-ab1-3`, when a FIXABLE row cites Plan task `rem-as-built-rem-ab1-3`, then the row is accepted with that task recorded as the criterion's owner

#### Negative Paths
- Given an active plan without task id `rem-prd-audit-zz-1`, when a FIXABLE row cites Plan task `rem-prd-audit-zz-1`, then the row is rejected with a diagnostic naming the criterion and the unresolvable id
- Given any active plan, when a FIXABLE row has Plan task `—`, then the row is rejected as FIXABLE without a Plan task (existing behavior preserved)
- Given a plan to which the engine appends a remediation task, when the previously-parseable report is re-parsed unchanged, then it still parses (appending never invalidates existing rows)

### Done When
- [ ] The `Number()` pre-parse at the Verdict Table Plan-task cell is replaced by a call to the Story 1 resolver
- [ ] The parsed row carries the plan task as a string id, and every downstream reader of that field compiles and behaves against string ids
- [ ] A regression test reproduces the #2064 shape (plan with `rem-` tasks, PASS row citing one with an annotation) and asserts the report parses

## Story 3: Rejection diagnostics name the criterion and the unresolvable reference

As an operator reading a halt, I want rejected citations to say which criterion cited which
unresolvable id so that diagnosis needs no code archaeology.

### Acceptance Criteria

#### Happy Path
- Given a report whose row S2.3 cites an id absent from the plan, when the report is parsed, then the rejected-row reason contains both `S2.3` and the cited id verbatim

#### Negative Paths
- Given a report whose row S2.3 cites a malformed reference, when the report is parsed, then the reason identifies the malformed text rather than the generic `has an invalid Plan task.` wording with no id

### Done When
- [ ] Rejected-row reasons for unresolvable and malformed Plan-task cells include the criterion key and the offending reference text
- [ ] A test asserts the exact reason strings for both cases

## Story 4: One citation rule, stated once

As a harness maintainer, I want the skill contract and the parser to state the same citation rule
so that a future consumer cannot narrow it again independently.

### Acceptance Criteria

#### Happy Path
- Given the resolved rule that any Verdict Table row may cite a task present in the active plan while FIXABLE rows must, when the prd-audit skill text is read, then its Plan-task cell instructions state that rule and instruct emitting the bare id without annotation

#### Negative Paths
- Given the updated skill text, when a FIXABLE row omits a Plan task, then the documented and enforced outcome is still rejection (the widened citation rule does not weaken the FIXABLE requirement)

### Done When
- [ ] `skills/prd-audit/SKILL.md` Plan-task cell text matches the enforced rule (any row may cite an existing plan task; FIXABLE must; emit the bare id)
- [ ] `test/test_harness_integrity.sh` passes after the skill edit
