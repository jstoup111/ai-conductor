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

## Story 2: Typed prd_audit judgments accept any id present in the active plan

As an operator, I want a typed finding citing an engine-appended remediation task to parse so
that the feature does not deadlock in a regenerating mechanical halt.

### Acceptance Criteria

#### Happy Path
- Given an active plan containing tasks `1`-`21` and `rem-prd-audit-rem-s1-6-1`, when a prd_audit typed finding cites Plan task `rem-prd-audit-rem-s1-6-1 (landed)` on a PASS criterion, then the row is accepted and the finding validates
- Given an active plan containing task `rem-as-built-rem-ab1-3`, when a FIXABLE row cites Plan task `rem-as-built-rem-ab1-3`, then the row is accepted with that task recorded as the criterion's owner

#### Negative Paths
- Given an active plan without task id `rem-prd-audit-zz-1`, when a FIXABLE row cites Plan task `rem-prd-audit-zz-1`, then the row is rejected with a diagnostic naming the criterion and the unresolvable id
- Given any active plan, when a FIXABLE row has Plan task `—`, then the row is rejected as FIXABLE without a Plan task (existing behavior preserved)
- Given a plan to which the engine appends a remediation task, when the previously valid typed result is revalidated unchanged, then it still validates (appending never invalidates existing rows)

### Done When
- [ ] The typed task-reference validator calls the Story 1 resolver for every citation; FIXABLE admits exactly one existing owner
- [ ] The parsed row carries the plan task as a string id, and every downstream reader of that field compiles and behaves against string ids
- [ ] A regression test reproduces the #2064 shape (plan with `rem-` tasks, PASS row citing one with an annotation) and asserts the finding validates

## Story 3: Rejection diagnostics name the criterion and the unresolvable reference

As an operator reading a halt, I want rejected citations to say which criterion cited which
unresolvable id so that diagnosis needs no code archaeology.

### Acceptance Criteria

#### Happy Path
- Given a report whose row S2.3 cites an id absent from the plan, when the typed result is validated, then the rejected-row reason contains both `S2.3` and the cited id verbatim

#### Negative Paths
- Given a report whose row S2.3 cites a malformed reference, when the typed result is validated, then the reason identifies the malformed text rather than the generic `has an invalid Plan task.` wording with no id

### Done When
- [ ] Rejected-row reasons for unresolvable and malformed Plan-task cells include the criterion key and the offending reference text
- [ ] A test asserts the exact reason strings for both cases

## Story 4: One citation rule, enforced by the engine

As a maintainer, I want the engine-owned schema and shared resolver to keep citation semantics consistent.

### Acceptance Criteria

#### Happy Path
- Given any typed finding citing active plan tasks, when validation resolves its task references, then non-numeric remediation ids and supported annotation tolerance follow the shared resolver; FIXABLE resolves exactly one owner.

#### Negative Paths
- Given a FIXABLE entry with no owner or multiple owners, when validated, then the entry is rejected with its criterion and ownership defect named.
- Given machine Plan-task cell grammar reintroduced into the migrated skill, when the contract audit runs, then it rejects the duplicated machine contract.

### Done When
- [ ] Typed citation fixtures cover existing string ids, annotations and exactly-one FIXABLE ownership through the shared resolver.
- [ ] Contract-audit fixtures reject machine cell grammar in the skill while retaining its judgment responsibilities.
